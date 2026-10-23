import { getClient, query } from '../db';
import { parseDocument } from '../parsers';
import { DocumentMetadata, ParsedDocument } from '../types/document';
import { chunkingService, GeneratedChunk } from './chunkingService';
import { embeddingService, EMBEDDING_DIMENSION } from './embeddingService';

export class IngestionError extends Error {
  code: string;
  statusCode: number;
  jobId?: string;

  constructor(message: string, code = 'INGESTION_ERROR', statusCode = 400, jobId?: string) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
    this.statusCode = statusCode;
    this.jobId = jobId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface IngestDocumentInput {
  filename: string;
  buffer: Buffer;
  overrideMetadata?: Partial<DocumentMetadata>;
  simulateProcessingFailure?: boolean;
}

export interface IngestDocumentOutput {
  job_id: string;
  document_id: string;
  doc_uuid: string;
  version: number;
  version_uuid: string;
  status: 'completed' | 'failed' | 'processing';
  content_hash: string;
  chunks_count: number;
  embeddings_reused_count: number;
  is_new_version: boolean;
  is_reused: boolean;
  message: string;
  completed_at: string;
}

export interface DocumentRecord {
  id: string;
  document_id: string;
  title: string;
  filename: string;
  format: string;
  current_version: number;
  status: string;
  error_message: string | null;
  metadata: DocumentMetadata;
  created_at: string;
  updated_at: string;
}

export interface DocumentVersionRecord {
  id: string;
  document_id: string;
  version: number;
  content_hash: string;
  status: 'pending' | 'processing' | 'active' | 'archived' | 'failed';
  error_message: string | null;
  metadata: DocumentMetadata;
  created_at: string;
  published_at: string | null;
}

export interface IngestionJobRecord {
  id: string;
  document_id: string;
  version_id: string | null;
  status: 'pending' | 'parsing' | 'chunking' | 'embedding' | 'processing' | 'completed' | 'failed';
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export class IngestionService {
  /**
   * Primary ingestion workflow:
   * 1. Parses and validates input buffer and metadata.
   * 2. Checks if document exists.
   * 3. Prevents duplicate versions if content hash is identical to current active version.
   * 4. Stages new version in 'processing' status.
   * 5. Tracks status and errors in ingestion_jobs (chunking -> embedding -> completed).
   * 6. Splits content into chunks with section headers and character offsets.
   * 7. Reuses existing embeddings for unchanged chunks to avoid redundant inference.
   * 8. Generates 768-dim embeddings via Ollama nomic-embed-text.
   * 9. Atomically publishes the new version and its chunks only after processing succeeds.
   * 10. Preserves previous active version and chunks if update fails.
   */
  async ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentOutput> {
    const { filename, buffer, overrideMetadata, simulateProcessingFailure } = input;

    // 1. Parse and validate document
    const parsed: ParsedDocument = await parseDocument({
      filename,
      buffer,
      overrideMetadata,
    });

    const docId = parsed.document_id;

    // 2. Lookup existing logical document
    const existingDocRes = await query<DocumentRecord>(
      'SELECT id, document_id, title, filename, format, current_version, status, metadata FROM documents WHERE document_id = $1',
      [docId]
    );

    let docUuid: string;
    let targetVersion: number;
    let isNewDoc = false;

    if (existingDocRes.rows.length === 0) {
      // Create new logical document record in pending status
      isNewDoc = true;
      targetVersion = 1;

      const createDocRes = await query<{ id: string }>(
        `INSERT INTO documents (
          document_id, title, filename, format, current_version, status, metadata
        ) VALUES ($1, $2, $3, $4, $5, 'pending', $6)
        RETURNING id`,
        [
          docId,
          parsed.title,
          parsed.filename,
          parsed.format,
          targetVersion,
          JSON.stringify(parsed.metadata),
        ]
      );
      docUuid = createDocRes.rows[0].id;
    } else {
      const existingDoc = existingDocRes.rows[0];
      docUuid = existingDoc.id;

      // Check current active version for identical content hash
      const activeVerRes = await query<{ id: string; version: number; content_hash: string }>(
        'SELECT id, version, content_hash FROM document_versions WHERE document_id = $1 AND status = \'active\'',
        [docUuid]
      );

      const activeVer = activeVerRes.rows[0];
      if (activeVer && activeVer.content_hash === parsed.content_hash) {
        // Content hash matches active version. Short-circuit safely without creating duplicate version.
        const chunkCountRes = await query<{ count: string }>(
          'SELECT count(*) FROM document_chunks WHERE version_id = $1 AND is_active = true',
          [activeVer.id]
        );
        const activeChunksCount = parseInt(chunkCountRes.rows[0]?.count || '0', 10);

        const jobRes = await query<{ id: string }>(
          `INSERT INTO ingestion_jobs (
            document_id, version_id, status, error_message, started_at, completed_at
          ) VALUES ($1, $2, 'completed', NULL, NOW(), NOW())
          RETURNING id`,
          [docUuid, activeVer.id]
        );

        return {
          job_id: jobRes.rows[0].id,
          document_id: docId,
          doc_uuid: docUuid,
          version: activeVer.version,
          version_uuid: activeVer.id,
          status: 'completed',
          content_hash: parsed.content_hash,
          chunks_count: activeChunksCount,
          embeddings_reused_count: activeChunksCount,
          is_new_version: false,
          is_reused: true,
          message: `Document content is unchanged. Version ${activeVer.version} remains active.`,
          completed_at: new Date().toISOString(),
        };
      }

      // If document was previously completed, increment version
      targetVersion = existingDoc.current_version + 1;
    }

    // 3. Create ingestion job
    const jobRes = await query<{ id: string }>(
      `INSERT INTO ingestion_jobs (document_id, status, started_at)
       VALUES ($1, 'processing', NOW())
       RETURNING id`,
      [docUuid]
    );
    const jobId = jobRes.rows[0].id;

    // 4. Stage new version in 'processing' status
    const versionRes = await query<{ id: string }>(
      `INSERT INTO document_versions (
        document_id, version, content_hash, status, metadata
      ) VALUES ($1, $2, $3, 'processing', $4)
      RETURNING id`,
      [docUuid, targetVersion, parsed.content_hash, JSON.stringify(parsed.metadata)]
    );
    const versionUuid = versionRes.rows[0].id;

    // Associate version with job
    await query('UPDATE ingestion_jobs SET version_id = $1 WHERE id = $2', [
      versionUuid,
      jobId,
    ]);

    // 5. Safe Processing with Failure Protection
    try {
      if (simulateProcessingFailure) {
        throw new Error('Simulated processing failure during document pipeline execution.');
      }

      // 5a. Chunking step
      await query("UPDATE ingestion_jobs SET status = 'chunking' WHERE id = $1", [jobId]);
      const chunks: GeneratedChunk[] = await chunkingService.splitDocument(parsed);

      if (chunks.length === 0) {
        throw new Error('Chunking resulted in 0 chunks for document.');
      }

      // 5b. Embedding Cache Check (Reuse existing chunk vectors from active version if unchanged)
      const cachedVectorsRes = await query<{ chunk_hash: string; embedding: string }>(
        `SELECT metadata->>'chunk_hash' AS chunk_hash, embedding::text
         FROM document_chunks
         WHERE document_id = $1 AND is_active = true`,
        [docUuid]
      );

      const cachedEmbeddingMap = new Map<string, number[]>();
      for (const row of cachedVectorsRes.rows) {
        if (row.chunk_hash && row.embedding) {
          try {
            const vec = JSON.parse(row.embedding) as number[];
            if (Array.isArray(vec) && vec.length === EMBEDDING_DIMENSION) {
              cachedEmbeddingMap.set(row.chunk_hash, vec);
            }
          } catch {
            // Ignore vector deserialization errors
          }
        }
      }

      // 5c. Embedding step
      await query("UPDATE ingestion_jobs SET status = 'embedding' WHERE id = $1", [jobId]);

      const chunksToEmbed: { index: number; text: string }[] = [];
      const chunkEmbeddings: (number[] | null)[] = new Array(chunks.length).fill(null);
      let reusedCount = 0;

      chunks.forEach((chunk, i) => {
        const cached = cachedEmbeddingMap.get(chunk.chunk_hash);
        if (cached) {
          chunkEmbeddings[i] = cached;
          reusedCount++;
        } else {
          chunksToEmbed.push({ index: i, text: chunk.content });
        }
      });

      // Generate missing embeddings via Ollama nomic-embed-text
      if (chunksToEmbed.length > 0) {
        const newEmbeddings = await embeddingService.generateBatchEmbeddings(
          chunksToEmbed.map((c) => c.text),
          4
        );
        chunksToEmbed.forEach((item, idx) => {
          chunkEmbeddings[item.index] = newEmbeddings[idx];
        });
      }

      // 5d. Persist staged chunks to PostgreSQL (inactive until atomic publication)
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const embedding = chunkEmbeddings[i]!;
        const vectorLiteral = `[${embedding.join(',')}]`;

        await query(
          `INSERT INTO document_chunks (
            document_id, version_id, chunk_index, content, embedding, metadata, is_active
          ) VALUES ($1, $2, $3, $4, $5::vector, $6, false)`,
          [
            docUuid,
            versionUuid,
            chunk.chunk_index,
            chunk.content,
            vectorLiteral,
            JSON.stringify(chunk.metadata),
          ]
        );
      }

      // 6. Atomic Publication Transaction
      // Keeps database transaction minimal (milliseconds), isolated from model inference
      const client = await getClient();
      try {
        await client.query('BEGIN');

        // 6a. Archive previously active versions for this document
        await client.query(
          `UPDATE document_versions 
           SET status = 'archived' 
           WHERE document_id = $1 AND id != $2 AND status = 'active'`,
          [docUuid, versionUuid]
        );

        // 6b. Deactivate previous chunks
        await client.query(
          `UPDATE document_chunks 
           SET is_active = false 
           WHERE document_id = $1 AND version_id != $2`,
          [docUuid, versionUuid]
        );

        // 6c. Activate the newly verified version
        await client.query(
          `UPDATE document_versions 
           SET status = 'active', published_at = NOW() 
           WHERE id = $1`,
          [versionUuid]
        );

        // 6d. Activate the new chunks
        await client.query(
          `UPDATE document_chunks 
           SET is_active = true 
           WHERE version_id = $1`,
          [versionUuid]
        );

        // 6e. Update parent document logical record
        await client.query(
          `UPDATE documents 
           SET current_version = $2, 
               title = $3, 
               filename = $4, 
               format = $5, 
               status = 'completed', 
               error_message = NULL, 
               metadata = $6, 
               updated_at = NOW() 
           WHERE id = $1`,
          [
            docUuid,
            targetVersion,
            parsed.title,
            parsed.filename,
            parsed.format,
            JSON.stringify(parsed.metadata),
          ]
        );

        // 6f. Mark ingestion job completed
        await client.query(
          `UPDATE ingestion_jobs 
           SET status = 'completed', completed_at = NOW() 
           WHERE id = $1`,
          [jobId]
        );

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }

      return {
        job_id: jobId,
        document_id: docId,
        doc_uuid: docUuid,
        version: targetVersion,
        version_uuid: versionUuid,
        status: 'completed',
        content_hash: parsed.content_hash,
        chunks_count: chunks.length,
        embeddings_reused_count: reusedCount,
        is_new_version: isNewDoc || targetVersion > 1,
        is_reused: false,
        message: `Successfully ingested ${docId} as version ${targetVersion} with ${chunks.length} chunks.`,
        completed_at: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Mark the staged version as failed
      await query(
        `UPDATE document_versions 
         SET status = 'failed', error_message = $1 
         WHERE id = $2`,
        [errorMsg, versionUuid]
      );

      // Mark the ingestion job as failed
      await query(
        `UPDATE ingestion_jobs 
         SET status = 'failed', error_message = $1, completed_at = NOW() 
         WHERE id = $2`,
        [errorMsg, jobId]
      );

      // Clean up uncommitted staged chunks for this failed version
      await query('DELETE FROM document_chunks WHERE version_id = $1', [versionUuid]);

      // If this was an initial creation attempt (v1), mark document failed
      if (isNewDoc) {
        await query(
          `UPDATE documents 
           SET status = 'failed', error_message = $1, updated_at = NOW() 
           WHERE id = $2`,
          [errorMsg, docUuid]
        );
      }
      // If it was an update to an existing document, the previous active version and its chunks remain untouched!

      throw new IngestionError(
        `Ingestion failed for '${filename}': ${errorMsg}`,
        'INGESTION_FAILED',
        500,
        jobId
      );
    }
  }

  /**
   * List all documents in the repository with active version info.
   */
  async listDocuments(filters?: {
    tenantId?: string;
    sensitivity?: string;
  }): Promise<DocumentRecord[]> {
    let sql = `
      SELECT id, document_id, title, filename, format, current_version, status, error_message, metadata, created_at, updated_at
      FROM documents
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters?.tenantId) {
      params.push(filters.tenantId);
      sql += ` AND metadata->>'tenant_id' = $${params.length}`;
    }

    if (filters?.sensitivity) {
      params.push(filters.sensitivity);
      sql += ` AND metadata->>'sensitivity' = $${params.length}`;
    }

    sql += ' ORDER BY created_at DESC';

    const res = await query<DocumentRecord>(sql, params);
    return res.rows;
  }

  /**
   * Get full details for a single document including all versions and active chunk count.
   */
  async getDocumentById(documentId: string): Promise<{
    document: DocumentRecord;
    versions: DocumentVersionRecord[];
    active_chunks_count: number;
  } | null> {
    const docRes = await query<DocumentRecord>(
      'SELECT id, document_id, title, filename, format, current_version, status, error_message, metadata, created_at, updated_at FROM documents WHERE document_id = $1',
      [documentId]
    );

    if (docRes.rows.length === 0) {
      return null;
    }

    const doc = docRes.rows[0];

    const verRes = await query<DocumentVersionRecord>(
      `SELECT id, document_id, version, content_hash, status, error_message, metadata, created_at, published_at
       FROM document_versions 
       WHERE document_id = $1 
       ORDER BY version DESC`,
      [doc.id]
    );

    const chunkCountRes = await query<{ count: string }>(
      'SELECT count(*) FROM document_chunks WHERE document_id = $1 AND is_active = true',
      [doc.id]
    );

    return {
      document: doc,
      versions: verRes.rows,
      active_chunks_count: parseInt(chunkCountRes.rows[0]?.count || '0', 10),
    };
  }

  /**
   * Check status of a specific ingestion job.
   */
  async getIngestionJob(jobId: string): Promise<IngestionJobRecord | null> {
    const res = await query<IngestionJobRecord>(
      'SELECT id, document_id, version_id, status, error_message, started_at, completed_at FROM ingestion_jobs WHERE id = $1',
      [jobId]
    );

    return res.rows[0] || null;
  }
}

export const ingestionService = new IngestionService();
