import assert from 'assert';
import { hybridRetrievalService } from './hybridRetrievalService';
import { ragService } from './ragService';
import { authService } from './authService';
import { closePool } from '../db';
import { RetrievedChunk, FullTextChunk } from '../types/rag';

async function runHybridRetrievalTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.3 — Hybrid Retrieval & RRF Test Suite     ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  // Resolve test users
  const priya = await authService.resolveAuthenticatedUser('emp_001'); // Support agent (Brightwave, Lumenfield)
  const marcus = await authService.resolveAuthenticatedUser('emp_002'); // Support agent (Harborpine, Lumenfield)
  const elena = await authService.resolveAuthenticatedUser('emp_003'); // Support lead (wildcard *)
  const hannah = await authService.resolveAuthenticatedUser('cu_001'); // Customer user (Brightwave)

  assert(priya, 'Priya must exist');
  assert(marcus, 'Marcus must exist');
  assert(elena, 'Elena must exist');
  assert(hannah, 'Hannah must exist');

  // --- GROUP 1: Reciprocal Rank Fusion Unit Tests ---
  console.log('--- TEST GROUP 1: Reciprocal Rank Fusion (RRF) Logic ---');

  await test('RRF assigns highest score to chunk appearing in both vector and FTS results', () => {
    const mockVector: RetrievedChunk[] = [
      {
        id: 'chunk-1',
        document_id: 'DOC-A',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Content A',
        similarity: 0.9,
        cosine_distance: 0.1,
        is_active: true,
        metadata: {
          document_id: 'DOC-A',
          title: 'Doc A',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
      {
        id: 'chunk-2',
        document_id: 'DOC-B',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Content B',
        similarity: 0.8,
        cosine_distance: 0.2,
        is_active: true,
        metadata: {
          document_id: 'DOC-B',
          title: 'Doc B',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
    ];

    const mockFts: FullTextChunk[] = [
      {
        id: 'chunk-1', // Chunk 1 is in BOTH (#1 in vector, #1 in FTS)
        document_id: 'DOC-A',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Content A',
        rank: 2.5,
        is_active: true,
        metadata: {
          document_id: 'DOC-A',
          title: 'Doc A',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
      {
        id: 'chunk-3', // Chunk 3 is in FTS only (#2 in FTS)
        document_id: 'DOC-C',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Content C',
        rank: 1.0,
        is_active: true,
        metadata: {
          document_id: 'DOC-C',
          title: 'Doc C',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
    ];

    const fused = hybridRetrievalService.fuseCandidates(mockVector, mockFts, 60, 4);

    assert.strictEqual(fused.length, 3, 'All 3 unique chunks must be fused');
    assert.strictEqual(fused[0].id, 'chunk-1', 'Chunk-1 (both) must rank #1');
    assert.strictEqual(fused[0].matched_by, 'both');
    assert.strictEqual(fused[0].vector_rank, 1);
    assert.strictEqual(fused[0].fts_rank, 1);

    // Score for chunk 1: 1/(60+1) + 1/(60+1) = 2/61 ~ 0.03278
    // Score for chunk 2: 1/(60+2) = 1/62 ~ 0.01612
    // Score for chunk 3: 1/(60+2) = 1/62 ~ 0.01612
    const expectedScore = (1 / 61) + (1 / 61);
    assert(Math.abs(fused[0].rrf_score - expectedScore) < 0.0001, 'RRF score matches theoretical expectation');
    assert(fused[0].rrf_score > fused[1].rrf_score, 'Chunk-1 score must exceed single-source chunks');
  });

  await test('Candidate deduplication eliminates duplicate IDs without losing metadata', () => {
    const mockVector: RetrievedChunk[] = [
      {
        id: 'chunk-duplicate',
        document_id: 'DOC-DUP',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Duplicate text',
        similarity: 0.95,
        cosine_distance: 0.05,
        is_active: true,
        metadata: {
          document_id: 'DOC-DUP',
          title: 'Doc Dup',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
    ];

    const mockFts: FullTextChunk[] = [
      {
        id: 'chunk-duplicate',
        document_id: 'DOC-DUP',
        version_id: 'ver-1',
        chunk_index: 0,
        content: 'Duplicate text',
        rank: 3.0,
        headline: '<b>Duplicate</b> text',
        is_active: true,
        metadata: {
          document_id: 'DOC-DUP',
          title: 'Doc Dup',
          tenant_id: 'global',
          allowed_groups: ['grp_public'],
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
        },
      },
    ];

    const fused = hybridRetrievalService.fuseCandidates(mockVector, mockFts, 60, 4);
    assert.strictEqual(fused.length, 1, 'Duplicate ID must be collapsed into a single chunk');
    assert.strictEqual(fused[0].headline, '<b>Duplicate</b> text', 'FTS headline is preserved');
    assert.strictEqual(fused[0].similarity, 0.95, 'Vector similarity is preserved');
  });

  // --- GROUP 2: Live Hybrid Retrieval Integration ---
  console.log('\n--- TEST GROUP 2: Live Hybrid Retrieval against PostgreSQL ---');

  await test('Live hybrid retrieval for CD-API-429 returns PDOC-0003 at rank #1 with matched_by: both', async () => {
    const res = await hybridRetrievalService.retrieveHybridChunks({
      query: 'What does error CD-API-429 mean on Starter plan?',
      top_k: 4,
      user: priya!,
    });

    assert(res.chunks.length > 0, 'Must retrieve chunks');
    assert.strictEqual(res.chunks[0].document_id, 'PDOC-0003', 'Top chunk must be PDOC-0003');
    assert.strictEqual(res.chunks[0].matched_by, 'both', 'Should be found by both vector and full-text search');
    assert(res.vector_count > 0, 'Vector search must contribute candidates');
    assert(res.fts_count > 0, 'Full-text search must contribute candidates');
    assert(res.latency_ms.total < 10000, 'Hybrid retrieval completes within acceptable latency');
  });

  await test('Multi-Document Synthesis (EVAL-005 Fix): Both TKT-10421 and PDOC-0002 are retrieved in top-4', async () => {
    // In baseline vector search, TKT-10421 monopolized top slots, pushing PDOC-0002 out of top-4.
    // In hybrid retrieval with candidate expansion (20 candidates) + diversity protection, both docs appear in top-4!
    const res = await hybridRetrievalService.retrieveHybridChunks({
      query: 'Why did Brightwave encounter webhook delivery issues during their catalog synchronization in TKT-10421 and what standard CloudDesk timeout limits apply?',
      top_k: 4,
      user: elena!,
    });

    const retrievedDocIds = Array.from(new Set(res.chunks.map((c) => c.document_id)));
    console.log(`    Retrieved unique docs in top-4: [${retrievedDocIds.join(', ')}]`);
    assert(retrievedDocIds.includes('TKT-10421'), 'Must retrieve ticket TKT-10421');
    assert(retrievedDocIds.includes('PDOC-0002'), 'Must retrieve product doc PDOC-0002 (Fixes EVAL-005 limitation!)');
  });

  // --- GROUP 3: Security & Authorization Preservation ---
  console.log('\n--- TEST GROUP 3: Security & Authorization Boundary Checks ---');

  await test('Marcus Webb querying Brightwave ticket TKT-10421 returns 0 chunks in hybrid search', async () => {
    const res = await hybridRetrievalService.retrieveHybridChunks({
      query: 'What issue was reported in ticket TKT-10421?',
      top_k: 4,
      user: marcus!,
    });

    assert.strictEqual(res.chunks.length, 0, 'Cross-tenant query must return 0 chunks in hybrid search');
  });

  await test('Customer Hannah Brooks querying Harborpine ticket TKT-10533 returns 0 chunks in hybrid search', async () => {
    const res = await hybridRetrievalService.retrieveHybridChunks({
      query: 'What error codes are affecting Harborpine Financial in ticket TKT-10533?',
      top_k: 4,
      user: hannah!,
    });

    assert.strictEqual(res.chunks.length, 0, 'Customer cross-tenant query must return 0 chunks in hybrid search');
  });

  await test('Employee Priya querying restricted penetration audit receives 0 restricted chunks', async () => {
    const res = await hybridRetrievalService.retrieveHybridChunks({
      query: 'What were the critical findings in the Q3 security vulnerability penetration test audit?',
      top_k: 4,
      user: priya!,
    });

    for (const chunk of res.chunks) {
      assert.notStrictEqual(chunk.metadata.sensitivity, 'restricted', 'Priya must not receive restricted chunks');
    }
  });

  // --- GROUP 4: End-to-End RAG Integration with Hybrid Search ---
  console.log('\n--- TEST GROUP 4: End-to-End RAG with Hybrid Retrieval ---');

  await test('RAG answerQuestion uses hybrid retrieval by default and produces grounded answer with citations', async () => {
    const res = await ragService.answerQuestion({
      question: 'What does error code CD-WHK-504 mean and what is its retry policy?',
      user: priya!,
      audience: 'internal',
    });

    assert.strictEqual(res.insufficient_evidence, false);
    assert.strictEqual(res.unauthorized_access, false);
    assert(res.citations.length > 0, 'Should return valid citations');
    assert(res.citations.some((c) => c.document_id === 'PDOC-0002'));
    assert(
      res.answer.includes('CD-WHK-504') ||
      res.answer.toLowerCase().includes('10 second') ||
      res.answer.toLowerCase().includes('timeout') ||
      res.answer.toLowerCase().includes('retry')
    );
  });

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} hybrid retrieval test(s) failed.`);
  }
}

if (require.main === module) {
  runHybridRetrievalTests()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('\n[Hybrid Retrieval Tests] Fatal error:', err);
      await closePool();
      process.exit(1);
    });
}
