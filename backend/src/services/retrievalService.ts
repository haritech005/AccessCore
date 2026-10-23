import { query } from '../db';
import { embeddingService } from './embeddingService';
import { RetrievalQuery, RetrievedChunk } from '../types/rag';
import { AppError } from '../middleware/errorHandler';

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  total_retrieved: number;
  latency_ms: number;
}

export class RetrievalService {
  /**
   * Retrieves the most semantically relevant document chunks using pgvector similarity search.
   * - Embeds query using Ollama nomic-embed-text (768 dimensions).
   * - Leverages PostgreSQL HNSW cosine distance index.
   * - Excludes inactive, archived, or failed document versions.
   * - Returns complete metadata needed for citations and authorization checks.
   */
  async retrieveChunks(options: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const { query: userQuery, top_k = 5, min_similarity = 0.0, tenant_scope, user_groups } = options;

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
      throw new AppError('Retrieval query must be a non-empty string.', 400, 'INVALID_QUERY');
    }

    const cleanQuery = userQuery.trim();
    if (cleanQuery.length > 2000) {
      throw new AppError('Retrieval query exceeds maximum allowed length of 2000 characters.', 400, 'QUERY_TOO_LONG');
    }

    const effectiveTopK = Math.min(Math.max(1, top_k), 50);

    // 1. Generate 768-dimensional query vector using local embedding model
    const queryEmbedding = await embeddingService.generateEmbedding(cleanQuery);
    const queryVectorLiteral = `[${queryEmbedding.join(',')}]`;

    // 2. Build pgvector cosine similarity search query
    // Cosine distance <=> range is [0, 2], cosine similarity is 1 - distance
    let sql = `
      SELECT 
        c.id,
        d.document_id,
        c.version_id,
        c.chunk_index,
        c.content,
        c.metadata,
        c.is_active,
        (c.embedding <=> $1::vector) AS cosine_distance,
        (1 - (c.embedding <=> $1::vector)) AS similarity
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      JOIN document_versions v ON c.version_id = v.id
      WHERE c.is_active = true
        AND d.status = 'completed'
        AND v.status = 'active'
    `;

    const params: unknown[] = [queryVectorLiteral];

    // Optional minimum similarity threshold
    if (min_similarity > 0) {
      params.push(min_similarity);
      sql += ` AND (1 - (c.embedding <=> $1::vector)) >= $${params.length}`;
    }

    // Optional tenant scope filter (e.g. global + user's tenant)
    if (tenant_scope && tenant_scope.length > 0) {
      params.push(tenant_scope);
      sql += ` AND (c.metadata->>'tenant_id' = ANY($${params.length}) OR c.metadata->>'tenant_id' = 'global')`;
    }

    // Optional user groups filter
    if (user_groups && user_groups.length > 0) {
      params.push(user_groups);
      sql += ` AND (c.metadata->'allowed_groups' ?| $${params.length})`;
    }

    params.push(effectiveTopK);
    sql += `
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $${params.length}
    `;

    // 3. Execute query
    const res = await query<{
      id: string;
      document_id: string;
      version_id: string;
      chunk_index: number;
      content: string;
      metadata: Record<string, unknown>;
      is_active: boolean;
      cosine_distance: string | number;
      similarity: string | number;
    }>(sql, params);

    const retrievedChunks: RetrievedChunk[] = res.rows.map((row) => {
      const cosineDistance = typeof row.cosine_distance === 'string' ? parseFloat(row.cosine_distance) : row.cosine_distance;
      const similarity = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity;

      return {
        id: row.id,
        document_id: row.document_id,
        version_id: row.version_id,
        chunk_index: row.chunk_index,
        content: row.content,
        similarity: Math.max(0, Math.min(1, similarity)),
        cosine_distance: Math.max(0, cosineDistance),
        metadata: {
          document_id: String(row.metadata?.document_id || row.document_id),
          title: String(row.metadata?.title || 'Untitled'),
          tenant_id: String(row.metadata?.tenant_id || 'global'),
          allowed_groups: Array.isArray(row.metadata?.allowed_groups) ? (row.metadata.allowed_groups as string[]) : [],
          sensitivity: (row.metadata?.sensitivity as any) || 'internal',
          disclosure_policy: (row.metadata?.disclosure_policy as any) || 'internal_only',
          section_heading: row.metadata?.section_heading ? String(row.metadata.section_heading) : undefined,
          start_char: typeof row.metadata?.start_char === 'number' ? row.metadata.start_char : undefined,
          end_char: typeof row.metadata?.end_char === 'number' ? row.metadata.end_char : undefined,
          page_number: typeof row.metadata?.page_number === 'number' ? row.metadata.page_number : undefined,
        },
        is_active: row.is_active,
      };
    });

    const latencyMs = Date.now() - startTime;

    return {
      query: cleanQuery,
      chunks: retrievedChunks,
      total_retrieved: retrievedChunks.length,
      latency_ms: latencyMs,
    };
  }
}

export const retrievalService = new RetrievalService();
