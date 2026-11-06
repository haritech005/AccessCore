import assert from 'assert';
import {
  calculateRecallAtK,
  calculateReciprocalRank,
  calculatePrecisionAtK,
  calculateNDCGAtK,
  computeRetrievalMetrics,
  evaluateCitations,
  evaluateGroundedness,
  calculatePercentiles,
  calculateMacroAverage,
} from './metrics';

function runTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.7 — Metrics Engine Test Suite             ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // --- TEST GROUP 1: Recall@K Calculations ---
  console.log('--- TEST GROUP 1: Recall@K Calculations ---');

  test('Recall@K correctly calculates single-document hit at k=1, 3, 4', () => {
    const retrieved = ['PDOC-0001', 'PDOC-0002', 'PDOC-0003'];
    const expected = ['PDOC-0001'];
    assert.strictEqual(calculateRecallAtK(retrieved, expected, 1), 1.0);
    assert.strictEqual(calculateRecallAtK(retrieved, expected, 3), 1.0);
    assert.strictEqual(calculateRecallAtK(retrieved, expected, 4), 1.0);
  });

  test('Recall@K correctly calculates multi-document partial and full hits', () => {
    const retrieved = ['PDOC-0001', 'PDOC-0003', 'PDOC-0004'];
    const expected = ['PDOC-0001', 'PDOC-0002']; // PDOC-0002 is missing
    assert.strictEqual(calculateRecallAtK(retrieved, expected, 1), 0.5); // only PDOC-0001 in top 1
    assert.strictEqual(calculateRecallAtK(retrieved, expected, 3), 0.5); // still only PDOC-0001 in top 3
  });

  test('Recall@K handles negative/boundary query correctly (zero retrieved = 1.0)', () => {
    assert.strictEqual(calculateRecallAtK([], [], 4), 1.0); // 0 docs retrieved for negative query = success
    assert.strictEqual(calculateRecallAtK(['PDOC-0001'], [], 4), 0.0); // leaked unauthorized doc = failure
  });

  test('Recall@K handles k <= 0 or empty inputs cleanly', () => {
    assert.strictEqual(calculateRecallAtK(['PDOC-0001'], ['PDOC-0001'], 0), 0.0);
    assert.strictEqual(calculateRecallAtK([], ['PDOC-0001'], 4), 0.0);
  });

  // --- TEST GROUP 2: Reciprocal Rank & Precision ---
  console.log('\n--- TEST GROUP 2: Reciprocal Rank & Precision ---');

  test('Reciprocal rank computes 1.0 for rank 1, 0.5 for rank 2, 0.333 for rank 3', () => {
    assert.strictEqual(calculateReciprocalRank(['DOC-A', 'DOC-B'], ['DOC-A']), 1.0);
    assert.strictEqual(calculateReciprocalRank(['DOC-X', 'DOC-A'], ['DOC-A']), 0.5);
    assert.strictEqual(parseFloat(calculateReciprocalRank(['DOC-X', 'DOC-Y', 'DOC-A'], ['DOC-A']).toFixed(3)), 0.333);
    assert.strictEqual(calculateReciprocalRank(['DOC-X', 'DOC-Y'], ['DOC-A']), 0.0);
  });

  test('Precision@K calculates correctly', () => {
    const retrieved = ['DOC-1', 'DOC-2', 'DOC-3', 'DOC-4'];
    const expected = ['DOC-1', 'DOC-2'];
    assert.strictEqual(calculatePrecisionAtK(retrieved, expected, 2), 1.0); // 2/2 in top 2
    assert.strictEqual(calculatePrecisionAtK(retrieved, expected, 4), 0.5); // 2/4 in top 4
  });

  test('NDCG@K calculates ideal DCG (1.0) when all targets are at top ranks', () => {
    const retrieved = ['DOC-1', 'DOC-2', 'DOC-3', 'DOC-4'];
    const expected = ['DOC-1', 'DOC-2'];
    const ndcg = calculateNDCGAtK(retrieved, expected, 4);
    assert.strictEqual(ndcg, 1.0);
  });

  test('computeRetrievalMetrics produces all metrics bundle simultaneously', () => {
    const res = computeRetrievalMetrics(['DOC-1', 'DOC-2'], ['DOC-1']);
    assert.strictEqual(res.recallAt1, 1.0);
    assert.strictEqual(res.recallAt4, 1.0);
    assert.strictEqual(res.mrr, 1.0);
    assert.strictEqual(res.precisionAt4, 0.25);
  });

  // --- TEST GROUP 3: Citation Correctness & Groundedness ---
  console.log('\n--- TEST GROUP 3: Citation Correctness & Groundedness ---');

  test('evaluateCitations identifies valid matching citations', () => {
    const citations = [{ document_id: 'PDOC-0001', is_summary: false, title: 'Title' }];
    const evalRes = evaluateCitations(citations, ['PDOC-0001']);
    assert.strictEqual(evalRes.valid, true);
    assert.strictEqual(evalRes.supportRate, 1.0);
    assert.strictEqual(evalRes.hasForbiddenLeak, false);
  });

  test('evaluateCitations flags forbidden leaks and missing citations', () => {
    const citations = [{ document_id: 'TKT-SECRET', is_summary: false, title: 'Secret' }];
    const evalRes = evaluateCitations(citations, ['PDOC-0001'], ['TKT-SECRET']);
    assert.strictEqual(evalRes.valid, false);
    assert.strictEqual(evalRes.hasForbiddenLeak, true);
    assert.strictEqual(evalRes.supportRate, 0.0);
    assert(evalRes.issues.some((i) => i.includes('Unauthorized documents cited')));
  });

  test('evaluateGroundedness verifies keyword presence and proper refusal', () => {
    const answer = 'The starter plan allows 60 requests per minute with rate limits.';
    const gRes = evaluateGroundedness(answer, ['60', 'requests per minute', 'starter'], false, false, 'permitted_full');
    assert.strictEqual(gRes.grounded, true);
    assert.strictEqual(gRes.keywordCoverageRate, 1.0);

    // Negative refusal check
    const refusalAnswer = 'I do not have sufficient evidence in the provided documents to answer this question.';
    const rRes = evaluateGroundedness(refusalAnswer, [], true, false, 'refusal_insufficient_evidence');
    assert.strictEqual(rRes.grounded, true);
    assert.strictEqual(rRes.properRefusal, true);
  });

  // --- TEST GROUP 4: Percentiles & Statistical Aggregations ---
  console.log('\n--- TEST GROUP 4: Percentiles & Statistical Aggregations ---');

  test('calculatePercentiles correctly computes median (p50), p90, p95, mean, min, max', () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = calculatePercentiles(data);
    assert.strictEqual(stats.min, 10);
    assert.strictEqual(stats.max, 100);
    assert.strictEqual(stats.mean, 55);
    assert.strictEqual(stats.median, 50);
    assert.strictEqual(stats.p90, 90);
    assert.strictEqual(stats.p95, 100);
  });

  test('calculateMacroAverage computes precise mean across test cases', () => {
    const vals = [0.8, 0.9, 1.0, 0.7];
    assert.strictEqual(calculateMacroAverage(vals), 0.85);
  });

  // --- SUMMARY ---
  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite();

