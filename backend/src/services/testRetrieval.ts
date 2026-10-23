import { closePool, query } from '../db';
import { retrievalService } from './retrievalService';
import { AppError } from '../middleware/errorHandler';

async function runRetrievalTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 1.8 - Vector Retrieval Test Suite            ');
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

  try {
    // --------------------------------------------------------------------------
    // TEST GROUP 1: Semantic Retrieval on Known CloudDesk Domain Questions
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Semantic Retrieval Accuracy on Sample Dataset ---');

    // 1.1 Webhook troubleshooting & CD-WHK-504
    const q1 = 'What does webhook error CD-WHK-504 mean and how do you troubleshoot it?';
    console.log(`\nQuery 1: "${q1}"`);
    const r1 = await retrievalService.retrieveChunks({ query: q1, top_k: 3 });

    assert(r1.chunks.length === 3, 'Query 1 returned top 3 chunks');
    assert(r1.latency_ms > 0, `Query 1 completed in ${r1.latency_ms}ms`);
    assert(
      r1.chunks[0].document_id === 'PDOC-0001' || r1.chunks[0].document_id === 'PDOC-0002',
      `Query 1 top chunk is from webhook product docs (got ${r1.chunks[0].document_id})`
    );
    assert(r1.chunks[0].similarity > 0.60, `Query 1 top similarity is high (${r1.chunks[0].similarity.toFixed(4)})`);
    assert(
      r1.chunks[0].content.includes('504') || r1.chunks[0].content.includes('Webhook'),
      'Query 1 chunk content contains webhook/504 context'
    );
    assert(r1.chunks[0].metadata.section_heading !== undefined, 'Query 1 chunk captured section_heading citation metadata');
    assert(r1.chunks[0].metadata.sensitivity === 'internal' || r1.chunks[0].metadata.sensitivity === 'public', 'Query 1 has valid sensitivity');

    // 1.2 API Rate Limits
    const q2 = 'What is the rate limit quota for Enterprise tier API requests?';
    console.log(`\nQuery 2: "${q2}"`);
    const r2 = await retrievalService.retrieveChunks({ query: q2, top_k: 3 });

    assert(r2.chunks.length === 3, 'Query 2 returned top 3 chunks');
    assert(r2.chunks[0].document_id === 'PDOC-0003', `Query 2 top chunk is PDOC-0003 (got ${r2.chunks[0].document_id})`);
    assert(r2.chunks[0].similarity > 0.60, `Query 2 similarity is high (${r2.chunks[0].similarity.toFixed(4)})`);
    assert(
      r2.chunks[0].content.toLowerCase().includes('rate limit') || r2.chunks[0].content.toLowerCase().includes('quota'),
      'Query 2 content contains rate limit information'
    );

    // 1.3 Brightwave Webhook Support Ticket
    const q3 = 'What issue did Brightwave customer Hannah Brooks report regarding webhook timeouts?';
    console.log(`\nQuery 3: "${q3}"`);
    const r3 = await retrievalService.retrieveChunks({ query: q3, top_k: 3 });

    assert(r3.chunks[0].document_id === 'TKT-10421', `Query 3 top chunk is TKT-10421 (got ${r3.chunks[0].document_id})`);
    assert(r3.chunks[0].metadata.tenant_id === 'ten_brightwave', 'Query 3 chunk metadata preserved tenant_id ten_brightwave');
    assert(
      r3.chunks[0].content.includes('Brightwave') || r3.chunks[0].content.includes('Hannah Brooks'),
      'Query 3 content mentions Brightwave or Hannah Brooks'
    );

    // 1.4 Harborpine SAML Authentication Failure
    const q4 = 'Why did Harborpine users experience SAML sign-in authentication failure?';
    console.log(`\nQuery 4: "${q4}"`);
    const r4 = await retrievalService.retrieveChunks({ query: q4, top_k: 3 });

    assert(r4.chunks[0].document_id === 'TKT-10533', `Query 4 top chunk is TKT-10533 (got ${r4.chunks[0].document_id})`);
    assert(r4.chunks[0].metadata.tenant_id === 'ten_harborpine', 'Query 4 chunk metadata preserved tenant_id ten_harborpine');
    assert(r4.chunks[0].content.includes('Harborpine') || r4.chunks[0].content.includes('SAML'), 'Query 4 content mentions SAML failure');

    // 1.5 Flow Loop Limits
    const q5 = 'What are the maximum nesting levels and loop iteration limits for flows?';
    console.log(`\nQuery 5: "${q5}"`);
    const r5 = await retrievalService.retrieveChunks({ query: q5, top_k: 3 });

    assert(r5.chunks[0].document_id === 'PDOC-0004', `Query 5 top chunk is PDOC-0004 (got ${r5.chunks[0].document_id})`);
    assert(r5.chunks[0].content.toLowerCase().includes('loop') || r5.chunks[0].content.toLowerCase().includes('flow'), 'Query 5 content mentions flow loops');

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Top-K and Similarity Threshold Parameter Testing
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Parameter Boundaries (Top-K & Thresholds) ---');

    const topK2 = await retrievalService.retrieveChunks({ query: 'Webhook error codes', top_k: 2 });
    assert(topK2.chunks.length === 2, 'top_k: 2 returns exactly 2 chunks');

    const topK1 = await retrievalService.retrieveChunks({ query: 'Webhook error codes', top_k: 1 });
    assert(topK1.chunks.length === 1, 'top_k: 1 returns exactly 1 chunk');

    const highThreshold = await retrievalService.retrieveChunks({
      query: 'Random irrelevant query that should not meet high threshold',
      min_similarity: 0.95,
    });
    assert(highThreshold.chunks.length === 0, 'min_similarity: 0.95 filtered out all sub-threshold chunks');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Inactive and Failed Version Exclusion
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Inactive / Failed Version Exclusion Guard ---');

    // Inject a synthetic inactive chunk with a unique secret keyword into DB
    const dummyDocRes = await query<{ id: string }>(
      `INSERT INTO documents (
        document_id, title, filename, format, current_version, status, metadata
      ) VALUES ('TEST-INACTIVE', 'Inactive Test Doc', 'inactive.md', 'markdown', 1, 'failed', '{}'::jsonb)
      RETURNING id`
    );
    const dummyDocId = dummyDocRes.rows[0].id;

    const dummyVerRes = await query<{ id: string }>(
      `INSERT INTO document_versions (
        document_id, version, content_hash, status, metadata
      ) VALUES ($1, 1, 'fakehash', 'failed', '{}'::jsonb)
      RETURNING id`,
      [dummyDocId]
    );
    const dummyVerId = dummyVerRes.rows[0].id;

    const { embeddingService } = await import('./embeddingService');
    const secretText = 'CONFIDENTIAL_SECRET_TOKEN_INACTIVE_DOC_987654';
    const dummyVec = await embeddingService.generateEmbedding(secretText);
    const dummyVecLiteral = `[${dummyVec.join(',')}]`;

    await query(
      `INSERT INTO document_chunks (
        document_id, version_id, chunk_index, content, embedding, metadata, is_active
      ) VALUES ($1, $2, 0, $3, $4::vector, '{"document_id":"TEST-INACTIVE"}'::jsonb, false)`,
      [dummyDocId, dummyVerId, secretText, dummyVecLiteral]
    );

    // Search specifically for the secret token
    const inactiveSearch = await retrievalService.retrieveChunks({
      query: secretText,
      top_k: 5,
    });

    const foundInactive = inactiveSearch.chunks.some((c) => c.content.includes(secretText));
    assert(!foundInactive, 'Inactive/failed document version chunk was strictly EXCLUDED from retrieval');

    // Cleanup synthetic test doc
    await query('DELETE FROM documents WHERE id = $1', [dummyDocId]);
    assert(true, 'Cleaned up synthetic test document');

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Validation & Error Handling
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Validation & Error Handling ---');

    let threwEmpty = false;
    try {
      await retrievalService.retrieveChunks({ query: '   ' });
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_QUERY' && err.statusCode === 400) {
        threwEmpty = true;
      }
    }
    assert(threwEmpty, 'Empty query rejected with 400 INVALID_QUERY');

    let threwLong = false;
    try {
      await retrievalService.retrieveChunks({ query: 'a'.repeat(2001) });
    } catch (err) {
      if (err instanceof AppError && err.code === 'QUERY_TOO_LONG' && err.statusCode === 400) {
        threwLong = true;
      }
    }
    assert(threwLong, 'Query exceeding 2000 chars rejected with 400 QUERY_TOO_LONG');

    console.log('\n==================================================================');
    console.log(` ALL ${passedTests}/${totalTests} RETRIEVAL TESTS PASSED SUCCESSFULLY! `);
    console.log(' Subphase 1.8 Acceptance Criteria Fully Met.                      ');
    console.log('==================================================================\n');
  } finally {
    await closePool();
  }
}

runRetrievalTestSuite().catch((err) => {
  console.error('\nFatal Retrieval test runner error:', err);
  process.exit(1);
});
