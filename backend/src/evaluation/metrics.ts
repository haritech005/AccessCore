/**
 * AccessCore — Information Retrieval and RAG Evaluation Metrics Engine
 * Subphase 4.7: Comprehensive Evaluation Metrics
 */

export interface MetricPercentiles {
  min: number;
  max: number;
  mean: number;
  median: number; // p50
  p90: number;
  p95: number;
}

export interface CitationEvaluationResult {
  valid: boolean;
  supportRate: number; // Fraction of expected documents present in citations
  hasForbiddenLeak: boolean; // True if citations contain restricted/unauthorized document IDs
  issues: string[];
}

export interface GroundednessEvaluationResult {
  grounded: boolean;
  matchedKeywords: string[];
  missingKeywords: string[];
  keywordCoverageRate: number;
  properRefusal: boolean;
  unauthorizedLeakDetected: boolean;
  issues: string[];
}

export interface RetrievalMetricsAtK {
  recallAt1: number;
  recallAt3: number;
  recallAt4: number;
  recallAt5: number;
  recallAt10: number;
  mrr: number; // Mean Reciprocal Rank
  precisionAt4: number;
  ndcgAt4: number; // Normalized Discounted Cumulative Gain
}

/**
 * Calculates Recall@K.
 * For target queries: (expected docs found in top K) / (total expected docs)
 * For negative/restricted queries: returns 1.0 (no target docs to recall; governed by security isolation).
 */
export function calculateRecallAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[],
  k: number
): number {
  if (k <= 0) return 0;
  if (expectedDocIds.length === 0) {
    return retrievedDocIds.slice(0, k).length === 0 ? 1.0 : 0.0;
  }

  const topK = retrievedDocIds.slice(0, k);
  const uniqueTopK = new Set(topK);
  const hits = expectedDocIds.filter((id) => uniqueTopK.has(id)).length;
  return hits / expectedDocIds.length;
}

/**
 * Calculates Reciprocal Rank (RR): 1 / (rank of first relevant document).
 */
export function calculateReciprocalRank(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): number {
  if (expectedDocIds.length === 0) return 1.0;

  for (let i = 0; i < retrievedDocIds.length; i++) {
    if (expectedDocIds.includes(retrievedDocIds[i])) {
      return 1 / (i + 1);
    }
  }

  return 0.0;
}

/**
 * Calculates Precision@K: (relevant docs in top K) / K.
 */
export function calculatePrecisionAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[],
  k: number
): number {
  if (k <= 0) return 0;
  if (expectedDocIds.length === 0) return 1.0;

  const topK = retrievedDocIds.slice(0, k);
  const uniqueTopK = new Set(topK);
  const hits = expectedDocIds.filter((id) => uniqueTopK.has(id)).length;
  return hits / k;
}

/**
 * Calculates Normalized Discounted Cumulative Gain (NDCG@K) with binary relevance.
 */
export function calculateNDCGAtK(
  retrievedDocIds: string[],
  expectedDocIds: string[],
  k: number
): number {
  if (k <= 0) return 0;
  if (expectedDocIds.length === 0) return 1.0;

  const topK = retrievedDocIds.slice(0, k);
  let dcg = 0;
  const seenRelevant = new Set<string>();

  for (let i = 0; i < topK.length; i++) {
    const docId = topK[i];
    if (expectedDocIds.includes(docId) && !seenRelevant.has(docId)) {
      seenRelevant.add(docId);
      dcg += 1 / Math.log2(i + 2); // i+1+1 because rank is 1-indexed
    }
  }

  let idcg = 0;
  const idealCount = Math.min(expectedDocIds.length, k);
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : Math.min(1.0, dcg / idcg);
}

/**
 * Computes all standard retrieval metrics at once for a single test case.
 */
export function computeRetrievalMetrics(
  retrievedDocIds: string[],
  expectedDocIds: string[]
): RetrievalMetricsAtK {
  return {
    recallAt1: calculateRecallAtK(retrievedDocIds, expectedDocIds, 1),
    recallAt3: calculateRecallAtK(retrievedDocIds, expectedDocIds, 3),
    recallAt4: calculateRecallAtK(retrievedDocIds, expectedDocIds, 4),
    recallAt5: calculateRecallAtK(retrievedDocIds, expectedDocIds, 5),
    recallAt10: calculateRecallAtK(retrievedDocIds, expectedDocIds, 10),
    mrr: calculateReciprocalRank(retrievedDocIds, expectedDocIds),
    precisionAt4: calculatePrecisionAtK(retrievedDocIds, expectedDocIds, 4),
    ndcgAt4: calculateNDCGAtK(retrievedDocIds, expectedDocIds, 4),
  };
}

/**
 * Evaluates citation validity, claim support, and authorization boundaries.
 */
export function evaluateCitations(
  citations: { document_id: string; is_summary?: boolean; title?: string }[],
  expectedDocIds: string[],
  blockedDocIds: string[] = []
): CitationEvaluationResult {
  const issues: string[] = [];

  // 1. Check for unauthorized leakage
  const citedIds = citations.map((c) => c.document_id);
  const forbiddenHits = citedIds.filter((id) => blockedDocIds.includes(id));
  const hasForbiddenLeak = forbiddenHits.length > 0;
  if (hasForbiddenLeak) {
    issues.push(`Unauthorized documents cited: ${forbiddenHits.join(', ')}`);
  }

  // 2. Negative queries: expectedDocIds is empty, citations MUST be empty
  if (expectedDocIds.length === 0) {
    const valid = citations.length === 0 && !hasForbiddenLeak;
    if (citations.length > 0) {
      issues.push(`Expected 0 citations for negative/restricted query, but received ${citations.length}`);
    }
    return {
      valid,
      supportRate: valid ? 1.0 : 0.0,
      hasForbiddenLeak,
      issues,
    };
  }

  // 3. Positive queries: check that expected documents are present in citations
  const uniqueCited = new Set(citedIds);
  const supportedCount = expectedDocIds.filter((id) => uniqueCited.has(id)).length;
  const supportRate = supportedCount / expectedDocIds.length;

  if (supportRate === 0) {
    const missing = expectedDocIds.filter((id) => !uniqueCited.has(id));
    issues.push(`Expected citations missing: ${missing.join(', ')}`);
  }

  return {
    valid: supportRate > 0 && !hasForbiddenLeak,
    supportRate,
    hasForbiddenLeak,
    issues,
  };
}

/**
 * Evaluates groundedness, factual keyword coverage, and appropriate refusal discipline.
 */
export function evaluateGroundedness(
  answer: string,
  expectedKeywords: string[],
  insufficientEvidence: boolean,
  unauthorizedAccess: boolean,
  expectedBehavior: string,
  unauthorizedKeywords: string[] = []
): GroundednessEvaluationResult {
  const issues: string[] = [];
  const normalizedAnswer = answer.toLowerCase();

  // 1. Check for unauthorized information leak
  const leakedWords = unauthorizedKeywords.filter((kw) =>
    normalizedAnswer.includes(kw.toLowerCase())
  );
  const unauthorizedLeakDetected = leakedWords.length > 0;
  if (unauthorizedLeakDetected) {
    issues.push(`Detected unauthorized data in answer: ${leakedWords.join(', ')}`);
  }

  // 2. Refusal discipline for negative or unsupported cases
  const isRefusalExpected =
    expectedBehavior === 'refusal_insufficient_evidence' ||
    expectedBehavior === 'blocked_tenant_isolation' ||
    expectedBehavior === 'blocked_sensitivity' ||
    expectedBehavior === 'blocked_internal_only';

  if (isRefusalExpected) {
    const properRefusal =
      insufficientEvidence ||
      unauthorizedAccess ||
      normalizedAnswer.includes('not authorized') ||
      normalizedAnswer.includes('do not have sufficient evidence') ||
      normalizedAnswer.includes('insufficient evidence') ||
      normalizedAnswer.includes('does not contain') ||
      normalizedAnswer.includes('cannot answer');

    if (!properRefusal) {
      issues.push('Expected honest refusal or authorization denial, but system generated an answer.');
    }

    return {
      grounded: properRefusal && !unauthorizedLeakDetected,
      matchedKeywords: [],
      missingKeywords: [],
      keywordCoverageRate: properRefusal ? 1.0 : 0.0,
      properRefusal,
      unauthorizedLeakDetected,
      issues,
    };
  }

  // 3. Customer group boundary observation check
  if (expectedBehavior === 'customer_group_boundary_observation') {
    const validBoundary = insufficientEvidence || unauthorizedAccess;
    return {
      grounded: validBoundary && !unauthorizedLeakDetected,
      matchedKeywords: [],
      missingKeywords: [],
      keywordCoverageRate: 1.0,
      properRefusal: validBoundary,
      unauthorizedLeakDetected,
      issues,
    };
  }

  // 4. Positive cases: Check that at least one factual key fact is present in the answer
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of expectedKeywords) {
    if (normalizedAnswer.includes(kw.toLowerCase())) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const keywordCoverageRate =
    expectedKeywords.length > 0 ? matchedKeywords.length / expectedKeywords.length : 1.0;

  const hasAtLeastOneKeyFact =
    expectedKeywords.length === 0 || matchedKeywords.length > 0;

  if (!hasAtLeastOneKeyFact) {
    issues.push(`Answer did not contain expected key facts. Missing: ${missingKeywords.join(', ')}`);
  }

  const grounded = hasAtLeastOneKeyFact && !unauthorizedLeakDetected;

  return {
    grounded,
    matchedKeywords,
    missingKeywords,
    keywordCoverageRate,
    properRefusal: true,
    unauthorizedLeakDetected,
    issues,
  };
}

/**
 * Calculates statistical percentiles (min, max, mean, median/p50, p90, p95) from latency arrays.
 */
export function calculatePercentiles(values: number[]): MetricPercentiles {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, p90: 0, p95: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mean = Math.round(sum / sorted.length);

  const getPercentile = (p: number): number => {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  };

  return {
    min,
    max,
    mean,
    median: getPercentile(50),
    p90: getPercentile(90),
    p95: getPercentile(95),
  };
}

/**
 * Calculates macro-average for any numerical array.
 */
export function calculateMacroAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return parseFloat((sum / values.length).toFixed(4));
}
