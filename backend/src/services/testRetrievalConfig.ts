import assert from 'assert';
import {
  DEFAULT_RETRIEVAL_CONFIG,
  RETRIEVAL_PRESETS,
  sanitizeRetrievalOptions,
  retrievalConfigSchema,
} from '../config/retrievalConfig';
import { hybridRetrievalService } from './hybridRetrievalService';
import { authService } from './authService';
import { closePool } from '../db';
import { RetrievedChunk, FullTextChunk } from '../types/rag';

async function runRetrievalConfigTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.5 — Retrieval Config & Tuning Test Suite   ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`  ✗ [FAIL] ${name}`);
      console.error(`    ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  try {
    // =========================================================================
    // GROUP 1: Retrieval Configuration Schema & Defaults
    // =========================================================================
    console.log('--- TEST GROUP 1: Config Schema & Defaults ---');

    await test('DEFAULT_RETRIEVAL_CONFIG has verified production default values', () => {
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.top_k, 4);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.vector_candidates, 20);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.fts_candidates, 20);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.min_similarity, 0.35);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.rrf_k, 60);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.diversity_threshold, 0.70);
      assert.strictEqual(DEFAULT_RETRIEVAL_CONFIG.max_chunks_per_doc, 2);
    });

    await test('All operational presets conform to retrievalConfigSchema', () => {
      const presets = Object.keys(RETRIEVAL_PRESETS) as (keyof typeof RETRIEVAL_PRESETS)[];
      for (const p of presets) {
        const parsed = retrievalConfigSchema.safeParse(RETRIEVAL_PRESETS[p]);
        assert(parsed.success, `Preset ${p} must validate against schema`);
      }
    });

    // =========================================================================
    // GROUP 2: Parameter Sanitization & Safety Boundary Enforcement
    // =========================================================================
    console.log('\n--- TEST GROUP 2: Input Sanitization & Boundary Bounds ---');

    await test('sanitizeRetrievalOptions falls back to safe defaults when options are undefined', () => {
      const sanitized = sanitizeRetrievalOptions(undefined);
      assert.deepStrictEqual(sanitized, DEFAULT_RETRIEVAL_CONFIG);
    });

    await test('sanitizeRetrievalOptions falls back to safe defaults on out-of-range inputs', () => {
      // Out of bounds: top_k=999, min_similarity=-5.0
      const sanitized = sanitizeRetrievalOptions({
        top_k: 999 as any,
        min_similarity: -5.0 as any,
      });
      assert.strictEqual(sanitized.top_k, DEFAULT_RETRIEVAL_CONFIG.top_k);
      assert.strictEqual(sanitized.min_similarity, DEFAULT_RETRIEVAL_CONFIG.min_similarity);
    });

    await test('sanitizeRetrievalOptions automatically expands candidate pools to at least top_k', () => {
      const sanitized = sanitizeRetrievalOptions({
        top_k: 10,
        vector_candidates: 5,
        fts_candidates: 6,
      });
      assert.strictEqual(sanitized.top_k, 10);
      assert.strictEqual(sanitized.vector_candidates, 10, 'vector_candidates must be at least top_k');
      assert.strictEqual(sanitized.fts_candidates, 10, 'fts_candidates must be at least top_k');
    });

    // =========================================================================
    // GROUP 3: Dynamic Candidate Fusion with Tuned Parameters
    // =========================================================================
    console.log('\n--- TEST GROUP 3: Dynamic Fusion & Diversity Tuning ---');

    await test('fuseCandidates correctly accepts dynamic RRF k and diversityThreshold', () => {
      const mockVector: RetrievedChunk[] = [
        {
          id: 'c1',
          document_id: 'DOC-1',
          version_id: 'v1',
          chunk_index: 0,
          content: 'text',
          similarity: 0.9,
          cosine_distance: 0.1,
          is_active: true,
          metadata: {} as any,
        },
        {
          id: 'c2',
          document_id: 'DOC-1',
          version_id: 'v1',
          chunk_index: 1,
          content: 'text',
          similarity: 0.85,
          cosine_distance: 0.15,
          is_active: true,
          metadata: {} as any,
        },
        {
          id: 'c3',
          document_id: 'DOC-2',
          version_id: 'v1',
          chunk_index: 0,
          content: 'text',
          similarity: 0.80,
          cosine_distance: 0.2,
          is_active: true,
          metadata: {} as any,
        },
      ];

      const mockFts: FullTextChunk[] = [
        {
          id: 'c1',
          document_id: 'DOC-1',
          version_id: 'v1',
          chunk_index: 0,
          content: 'text',
          rank: 2.0,
          is_active: true,
          metadata: {} as any,
        },
        {
          id: 'c3',
          document_id: 'DOC-2',
          version_id: 'v1',
          chunk_index: 0,
          content: 'text',
          rank: 1.5,
          is_active: true,
          metadata: {} as any,
        },
      ];

      // Test with k=20
      const fusedK20 = hybridRetrievalService.fuseCandidates(mockVector, mockFts, 20, 3, 0.70, 2);
      assert.strictEqual(fusedK20[0].id, 'c1');
      // Score for c1 with k=20: 1/(20+1) + 1/(20+1) = 2/21 ~ 0.0952
      const expectedK20 = (1 / 21) + (1 / 21);
      assert(Math.abs(fusedK20[0].rrf_score - expectedK20) < 0.0001);

      // Test with k=60
      const fusedK60 = hybridRetrievalService.fuseCandidates(mockVector, mockFts, 60, 3, 0.70, 2);
      const expectedK60 = (1 / 61) + (1 / 61);
      assert(Math.abs(fusedK60[0].rrf_score - expectedK60) < 0.0001);
    });

    // =========================================================================
    // GROUP 4: Live Dynamic Hybrid Retrieval with Custom Parameters
    // =========================================================================
    console.log('\n--- TEST GROUP 4: Live Retrieval with Tuned Parameters ---');

    await test('Live hybrid retrieval executes with low_latency preset overrides', async () => {
      const priya = await authService.resolveAuthenticatedUser('emp_001');
      assert(priya);

      const res = await hybridRetrievalService.retrieveHybridChunks({
        query: 'What does error CD-API-429 mean?',
        user: priya,
        top_k: RETRIEVAL_PRESETS.low_latency.top_k,
        vector_candidates: RETRIEVAL_PRESETS.low_latency.vector_candidates,
        fts_candidates: RETRIEVAL_PRESETS.low_latency.fts_candidates,
        rrf_k: RETRIEVAL_PRESETS.low_latency.rrf_k,
      });

      assert(res.chunks.length > 0 && res.chunks.length <= 3, 'Must return at most top_k=3');
      assert(
        res.chunks.some((c) => c.document_id === 'PDOC-0003' || c.document_id === 'TKT-10467'),
        'Top chunks must include CD-API-429 reference (PDOC-0003 or TKT-10467)'
      );
    });

    await test('Live hybrid retrieval executes with high_recall preset overrides', async () => {
      const elena = await authService.resolveAuthenticatedUser('emp_003');
      assert(elena);

      const res = await hybridRetrievalService.retrieveHybridChunks({
        query: 'What are CloudDesk webhook timeout limits and retry schedules?',
        user: elena,
        top_k: RETRIEVAL_PRESETS.high_recall.top_k,
        vector_candidates: RETRIEVAL_PRESETS.high_recall.vector_candidates,
        fts_candidates: RETRIEVAL_PRESETS.high_recall.fts_candidates,
      });

      assert(res.chunks.length > 0 && res.chunks.length <= 6, 'Must return up to top_k=6');
      assert(res.chunks.some((c) => c.document_id === 'PDOC-0002'));
    });
  } finally {
    await closePool();
  }

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} retrieval config test(s) failed.`);
  }
}

if (require.main === module) {
  runRetrievalConfigTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Retrieval Config Tests] Fatal error:', err);
      process.exit(1);
    });
}
