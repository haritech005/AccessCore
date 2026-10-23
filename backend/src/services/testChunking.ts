import fs from 'fs';
import path from 'path';
import { closePool, query } from '../db';
import { chunkingService } from './chunkingService';
import { embeddingService, EMBEDDING_DIMENSION, EmbeddingError } from './embeddingService';
import { ingestionService } from './ingestionService';

async function runChunkingTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 1.7 - Chunking & Embeddings Test Suite       ');
  console.log('==================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, failureDetail?: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passedTests++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}: ${failureDetail || 'Assertion failed'}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  const assetsDir = path.resolve(__dirname, '../../../assets');
  const productDocsDir = path.join(assetsDir, 'product-documents');
  const supportTicketsDir = path.join(assetsDir, 'support-tickets');

  try {
    // --------------------------------------------------------------------------
    // TEST GROUP 1: Embedding Service & Ollama nomic-embed-text Verification
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Ollama nomic-embed-text Embeddings ---');
    const health = await embeddingService.checkHealth();
    assert(health.available === true, `Ollama embedding model '${health.model}' is reachable`);
    assert(health.dimension === EMBEDDING_DIMENSION, `Embedding dimension is exactly ${EMBEDDING_DIMENSION}`);

    const singleVec = await embeddingService.generateEmbedding('Webhook timeout diagnosis for CloudDesk');
    assert(singleVec.length === 768, 'Single text embedding generated 768 dimensions');
    assert(singleVec.some((v) => v !== 0), 'Embedding vector contains non-zero numerical floats');

    const batchVecs = await embeddingService.generateBatchEmbeddings([
      'First sample chunk about webhook retry logic',
      'Second sample chunk about rate limit quotas',
      'Third sample chunk about tenant isolation',
    ]);
    assert(batchVecs.length === 3, 'Batch embedding returned 3 vectors');
    assert(batchVecs[0].length === 768 && batchVecs[1].length === 768, 'All batch vectors have 768 dimensions');

    let threwEmpty = false;
    try {
      await embeddingService.generateEmbedding('   ');
    } catch (err) {
      if (err instanceof EmbeddingError && err.code === 'EMPTY_TEXT_ERROR') {
        threwEmpty = true;
      }
    }
    assert(threwEmpty, 'Empty string rejected with EmbeddingError (EMPTY_TEXT_ERROR)');

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Chunking Service & Metadata Preservation
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Text Chunking & Metadata Preservation ---');
    const pdoc1Filename = 'PDOC-0001-webhook-delivery-troubleshooting.md';
    const pdoc1Buffer = fs.readFileSync(path.join(productDocsDir, pdoc1Filename));

    // Parse first using our subphase 1.5 parser
    const { parseMarkdown } = await import('../parsers/markdown');
    const parsedDoc = parseMarkdown(pdoc1Buffer, pdoc1Filename);

    const chunks = await chunkingService.splitDocument(parsedDoc, {
      chunkSize: 800,
      chunkOverlap: 150,
    });

    assert(chunks.length > 3, `Document split into ${chunks.length} chunks`);
    assert(chunks[0].chunk_index === 0, 'First chunk has chunk_index 0');
    assert(chunks[1].chunk_index === 1, 'Chunk ordering preserved (index 1)');
    assert(chunks[0].chunk_hash.length === 64, 'SHA-256 chunk_hash computed for chunk');
    assert(chunks[0].start_char <= chunks[0].end_char, 'Character offsets tracked [start_char <= end_char]');

    // Verify section heading detection
    const chunksWithHeadings = chunks.filter((c) => c.section_heading !== undefined);
    assert(chunksWithHeadings.length > 0, `Section headings detected on ${chunksWithHeadings.length} chunks`);

    // Verify metadata propagation from parent document
    assert(chunks[0].metadata.document_id === 'PDOC-0001', 'Chunk preserved document_id PDOC-0001');
    assert(chunks[0].metadata.tenant_id === 'global', 'Chunk preserved tenant_id global');
    assert(chunks[0].metadata.sensitivity === 'internal', 'Chunk preserved sensitivity internal');
    assert(chunks[0].metadata.disclosure_policy === 'internal_only', 'Chunk preserved disclosure_policy internal_only');
    assert(chunks[0].metadata.allowed_groups.includes('grp_support'), 'Chunk preserved allowed_groups');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Ingestion with pgvector Storage & Similarity Search
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Database Ingestion with pgvector Persistence ---');
    await query("DELETE FROM documents WHERE document_id LIKE 'PDOC-%' OR document_id LIKE 'TKT-%'");

    const ingestRes1 = await ingestionService.ingestDocument({
      filename: pdoc1Filename,
      buffer: pdoc1Buffer,
    });

    assert(ingestRes1.status === 'completed', 'PDOC-0001 ingested successfully');
    assert(ingestRes1.chunks_count > 0, `Generated and stored ${ingestRes1.chunks_count} chunks`);

    // Verify chunks exist in PostgreSQL document_chunks table
    const dbChunksRes = await query<{ count: string }>(
      'SELECT count(*) FROM document_chunks WHERE document_id = $1 AND is_active = true',
      [ingestRes1.doc_uuid]
    );
    const activeChunks = parseInt(dbChunksRes.rows[0].count, 10);
    assert(activeChunks === ingestRes1.chunks_count, `Database has ${activeChunks} active chunks with embeddings`);

    // Perform Vector Similarity Query via pgvector Cosine Distance (<=>)
    const queryVec = await embeddingService.generateEmbedding('How to troubleshoot webhook 504 gateway timeout error?');
    const queryVecLiteral = `[${queryVec.join(',')}]`;

    const simRes = await query<{
      chunk_index: number;
      content: string;
      similarity: number;
    }>(
      `SELECT chunk_index, content, 1 - (embedding <=> $1::vector) AS similarity
       FROM document_chunks
       WHERE document_id = $2 AND is_active = true
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 3`,
      [queryVecLiteral, ingestRes1.doc_uuid]
    );

    assert(simRes.rows.length === 3, 'Vector similarity query returned top 3 matches');
    assert(simRes.rows[0].similarity > 0.6, `Top chunk similarity is high (${simRes.rows[0].similarity.toFixed(4)})`);
    assert(
      simRes.rows[0].content.includes('504') || simRes.rows[0].content.includes('Webhook'),
      'Top chunk content is semantically relevant to 504 webhook troubleshooting'
    );

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Embedding Reuse on Document Update
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Incremental Update & Embedding Cache Reuse ---');
    // Modify only the very end of PDOC-0001
    const pdoc1Text = pdoc1Buffer.toString('utf-8');
    const modifiedPdoc1Text = pdoc1Text + '\n\n## 9. Appendix: Minor Note on Log Retention\nAdded a single note here.';
    const modifiedPdoc1Buffer = Buffer.from(modifiedPdoc1Text, 'utf-8');

    const updateRes = await ingestionService.ingestDocument({
      filename: pdoc1Filename,
      buffer: modifiedPdoc1Buffer,
    });

    assert(updateRes.version === 2, 'Version incremented to 2');
    assert(updateRes.embeddings_reused_count > 0, `Reused ${updateRes.embeddings_reused_count} existing chunk embeddings without re-embedding!`);

    // Verify that old version chunks are deactivated and new version chunks are active
    const v1ActiveChunks = await query<{ count: string }>(
      'SELECT count(*) FROM document_chunks WHERE version_id = $1 AND is_active = true',
      [ingestRes1.version_uuid]
    );
    assert(parseInt(v1ActiveChunks.rows[0].count, 10) === 0, 'Version 1 chunks are now is_active = false');

    const v2ActiveChunks = await query<{ count: string }>(
      'SELECT count(*) FROM document_chunks WHERE version_id = $1 AND is_active = true',
      [updateRes.version_uuid]
    );
    assert(parseInt(v2ActiveChunks.rows[0].count, 10) === updateRes.chunks_count, 'Version 2 chunks are active');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Full CloudDesk Dataset Ingestion & Chunks Verification
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Full Dataset Ingestion (4 Docs + 3 Tickets) ---');
    const remainingMd = [
      'PDOC-0002-webhooks-overview.md',
      'PDOC-0003-api-rate-limits.md',
      'PDOC-0004-flow-loop-limits.md',
    ];
    for (const file of remainingMd) {
      const buffer = fs.readFileSync(path.join(productDocsDir, file));
      const res = await ingestionService.ingestDocument({ filename: file, buffer });
      assert(res.status === 'completed' && res.chunks_count > 0, `Ingested ${file} (${res.chunks_count} chunks)`);
    }

    const tickets = [
      'TKT-10421-brightwave-webhook-timeouts.json',
      'TKT-10467-lumenfield-api-rate-limit.json',
      'TKT-10533-harborpine-saml-failure.json',
    ];
    for (const file of tickets) {
      const buffer = fs.readFileSync(path.join(supportTicketsDir, file));
      const res = await ingestionService.ingestDocument({ filename: file, buffer });
      assert(res.status === 'completed' && res.chunks_count > 0, `Ingested ${file} (${res.chunks_count} chunks)`);
    }

    // Overall database chunk statistics
    const totalChunksRes = await query<{ total_chunks: string; active_chunks: string }>(
      `SELECT 
         count(*) AS total_chunks,
         count(*) FILTER (WHERE is_active = true) AS active_chunks
       FROM document_chunks`
    );

    const totalActive = parseInt(totalChunksRes.rows[0].active_chunks, 10);
    assert(totalActive >= 25, `Total active chunks across all 7 dataset records is ${totalActive} (expected >= 25)`);

    console.log('\n--- Chunk Distribution Summary ---');
    const summaryRes = await query<{
      document_id: string;
      title: string;
      tenant_id: string;
      chunk_count: string;
    }>(
      `SELECT 
         d.document_id,
         d.title,
         d.metadata->>'tenant_id' as tenant_id,
         count(c.id) as chunk_count
       FROM documents d
       JOIN document_chunks c ON c.document_id = d.id AND c.is_active = true
       GROUP BY d.document_id, d.title, d.metadata->>'tenant_id'
       ORDER BY d.document_id ASC`
    );

    console.table(
      summaryRes.rows.map((r) => ({
        ID: r.document_id,
        Title: r.title.length > 35 ? r.title.slice(0, 32) + '...' : r.title,
        Tenant: r.tenant_id,
        ActiveChunks: r.chunk_count,
        EmbeddingModel: 'nomic-embed-text (768)',
        Status: 'Ready for Retrieval',
      }))
    );

    console.log('\n==================================================================');
    console.log(` ALL ${passedTests}/${totalTests} CHUNKING & EMBEDDING TESTS PASSED! `);
    console.log(' Subphase 1.7 Acceptance Criteria Fully Met.                      ');
    console.log('==================================================================\n');
  } finally {
    await closePool();
  }
}

runChunkingTestSuite().catch((err) => {
  console.error('\nFatal Chunking test runner error:', err);
  process.exit(1);
});
