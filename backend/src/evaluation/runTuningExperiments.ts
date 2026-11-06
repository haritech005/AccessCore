import fs from 'fs';
import path from 'path';
import { EVALUATION_DATASET } from './dataset';
import { authService } from '../services/authService';
import { hybridRetrievalService } from '../services/hybridRetrievalService';
import { queryCondensationService } from '../services/queryCondensationService';
import { closePool } from '../db';
import { DEFAULT_RETRIEVAL_CONFIG, RETRIEVAL_PRESETS } from '../config/retrievalConfig';

export interface TuningTrialResult {
  dimension: string;
  configLabel: string;
  params: {
    top_k: number;
    vector_candidates: number;
    fts_candidates: number;
    rrf_k: number;
    min_similarity: number;
    diversity_threshold: number;
    max_chunks_per_doc: number;
  };
  metrics: {
    overallPassRate: string;
    meanRecallAt3: string;
    meanRecallAt4: string;
    eval005Recall: string;
    eval011Recall: string;
    medianRetrievalLatencyMs: number;
    meanRetrievalLatencyMs: number;
    meanFusionLatencyMs: number;
  };
}

export async function runTuningExperiments(): Promise<TuningTrialResult[]> {
  console.log('================================================================================');
  console.log(' AccessCore Subphase 4.5 — Systematic Retrieval Parameter Tuning Experiments');
  console.log(' Fixed Benchmark: 15 Evaluation Dataset Cases across All User Personas');
  console.log('================================================================================\n');

  // Pre-resolve identities & conversational condensed queries to ensure strict comparability
  const resolvedUsers = new Map<string, any>();
  const preparedQueries = new Map<string, string>();

  for (const tc of EVALUATION_DATASET) {
    if (!resolvedUsers.has(tc.userId)) {
      const u = await authService.resolveAuthenticatedUser(tc.userId);
      if (!u) throw new Error(`User ${tc.userId} not found`);
      resolvedUsers.set(tc.userId, u);
    }

    if (tc.isConversationalFollowup && tc.conversationContext) {
      const cond = await queryCondensationService.condenseQuery({
        question: tc.question,
        chat_history: [
          { role: 'user', content: tc.conversationContext.priorQuestion },
          { role: 'assistant', content: tc.conversationContext.priorAnswerExcerpt },
        ],
      });
      preparedQueries.set(tc.id, cond.condensed_query);
    } else {
      preparedQueries.set(tc.id, tc.question);
    }
  }

  // Define controlled experimental trials
  const trials: {
    dimension: string;
    label: string;
    params: typeof DEFAULT_RETRIEVAL_CONFIG;
  }[] = [
    // 1. Candidate Pool Sizing
    {
      dimension: 'Candidate Pool Sizing',
      label: 'Pool = 10 (Vector: 10, FTS: 10)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, vector_candidates: 10, fts_candidates: 10 },
    },
    {
      dimension: 'Candidate Pool Sizing',
      label: 'Pool = 20 (Vector: 20, FTS: 20) [Current Baseline]',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, vector_candidates: 20, fts_candidates: 20 },
    },
    {
      dimension: 'Candidate Pool Sizing',
      label: 'Pool = 35 (Vector: 35, FTS: 35)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, vector_candidates: 35, fts_candidates: 35 },
    },

    // 2. Final Top-K Selection
    {
      dimension: 'Final Top-K Selection',
      label: 'Top-K = 3',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, top_k: 3 },
    },
    {
      dimension: 'Final Top-K Selection',
      label: 'Top-K = 4 [Current Baseline]',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, top_k: 4 },
    },
    {
      dimension: 'Final Top-K Selection',
      label: 'Top-K = 5',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, top_k: 5 },
    },

    // 3. RRF Smoothing Constant (k)
    {
      dimension: 'RRF Constant (k)',
      label: 'RRF k = 20 (Strong Top-Rank Weighting)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, rrf_k: 20 },
    },
    {
      dimension: 'RRF Constant (k)',
      label: 'RRF k = 60 (Standard IR Smoothing) [Current Baseline]',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, rrf_k: 60 },
    },
    {
      dimension: 'RRF Constant (k)',
      label: 'RRF k = 100 (Dampened Rank Weighting)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, rrf_k: 100 },
    },

    // 4. Document Diversity Threshold
    {
      dimension: 'Document Diversity Threshold',
      label: 'Threshold = 0.50 (Aggressive Diversity)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, diversity_threshold: 0.50 },
    },
    {
      dimension: 'Document Diversity Threshold',
      label: 'Threshold = 0.70 (Balanced Competitive) [Current Baseline]',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, diversity_threshold: 0.70 },
    },
    {
      dimension: 'Document Diversity Threshold',
      label: 'Threshold = 0.85 (Strict Dominant Doc Priority)',
      params: { ...DEFAULT_RETRIEVAL_CONFIG, diversity_threshold: 0.85 },
    },

    // 5. Operational Presets
    {
      dimension: 'Operational Presets',
      label: 'Preset: Low Latency',
      params: { ...RETRIEVAL_PRESETS.low_latency },
    },
    {
      dimension: 'Operational Presets',
      label: 'Preset: Balanced (Production Default)',
      params: { ...RETRIEVAL_PRESETS.balanced },
    },
    {
      dimension: 'Operational Presets',
      label: 'Preset: High Recall',
      params: { ...RETRIEVAL_PRESETS.high_recall },
    },
  ];

  const trialResults: TuningTrialResult[] = [];

  for (let tIdx = 0; tIdx < trials.length; tIdx++) {
    const trial = trials[tIdx];
    console.log(`[${tIdx + 1}/${trials.length}] Evaluating ${trial.dimension}: "${trial.label}"...`);

    const latencies: number[] = [];
    const fusionLatencies: number[] = [];
    let passedCount = 0;
    let sumRecall3 = 0;
    let sumRecall4 = 0;
    let eval005Recall = '0%';
    let eval011Recall = '0%';

    for (const testCase of EVALUATION_DATASET) {
      const user = resolvedUsers.get(tcUserId(testCase.userId));
      const query = preparedQueries.get(testCase.id)!;

      const retRes = await hybridRetrievalService.retrieveHybridChunks({
        query,
        user,
        top_k: trial.params.top_k,
        vector_candidates: trial.params.vector_candidates,
        fts_candidates: trial.params.fts_candidates,
        min_similarity: trial.params.min_similarity,
        rrf_k: trial.params.rrf_k,
        diversity_threshold: trial.params.diversity_threshold,
        max_chunks_per_doc: trial.params.max_chunks_per_doc,
        audience: testCase.audience,
      });

      latencies.push(retRes.latency_ms.total);
      fusionLatencies.push(retRes.latency_ms.fusion);

      const retrievedDocIds = retRes.chunks.map((c) => c.document_id);
      const top3 = retrievedDocIds.slice(0, 3);
      const top4 = retrievedDocIds.slice(0, 4);

      let rec3 = 0;
      let rec4 = 0;

      if (testCase.expectedDocumentIds.length > 0) {
        const u3 = new Set(top3);
        const m3 = testCase.expectedDocumentIds.filter((id) => u3.has(id)).length;
        rec3 = m3 / testCase.expectedDocumentIds.length;

        const u4 = new Set(top4);
        const m4 = testCase.expectedDocumentIds.filter((id) => u4.has(id)).length;
        rec4 = m4 / testCase.expectedDocumentIds.length;
      } else {
        const unauth = retrievedDocIds.length > 0;
        rec3 = unauth ? 0 : 1;
        rec4 = unauth ? 0 : 1;
      }

      sumRecall3 += rec3;
      sumRecall4 += rec4;

      if (testCase.id === 'EVAL-005') {
        eval005Recall = `${(rec4 * 100).toFixed(0)}%`;
      }
      if (testCase.id === 'EVAL-011') {
        eval011Recall = `${(rec4 * 100).toFixed(0)}%`;
      }

      if (rec4 >= 1.0 || testCase.expectedDocumentIds.length === 0) {
        passedCount++;
      }
    }

    function median(vals: number[]): number {
      const s = [...vals].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 !== 0 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
    }
    function mean(vals: number[]): number {
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    const n = EVALUATION_DATASET.length;
    const meanRec3Val = `${((sumRecall3 / n) * 100).toFixed(1)}%`;
    const meanRec4Val = `${((sumRecall4 / n) * 100).toFixed(1)}%`;
    const passRate = `${((passedCount / n) * 100).toFixed(1)}%`;

    trialResults.push({
      dimension: trial.dimension,
      configLabel: trial.label,
      params: trial.params,
      metrics: {
        overallPassRate: passRate,
        meanRecallAt3: meanRec3Val,
        meanRecallAt4: meanRec4Val,
        eval005Recall,
        eval011Recall,
        medianRetrievalLatencyMs: median(latencies),
        meanRetrievalLatencyMs: mean(latencies),
        meanFusionLatencyMs: mean(fusionLatencies),
      },
    });
  }

  function tcUserId(id: string): string {
    return id;
  }

  const outPath = path.resolve(__dirname, 'tuning-results.json');
  fs.writeFileSync(outPath, JSON.stringify(trialResults, null, 2), 'utf-8');
  console.log(`\n[Tuning Experiments] Complete results recorded to: ${outPath}\n`);

  console.log('================================================================================');
  console.log(' RETRIEVAL PARAMETER TUNING RESULTS SUMMARY');
  console.log('================================================================================');
  console.table(
    trialResults.map((t) => ({
      Dimension: t.dimension,
      Configuration: t.configLabel,
      'Pass Rate': t.metrics.overallPassRate,
      'Rec@3': t.metrics.meanRecallAt3,
      'Rec@4': t.metrics.meanRecallAt4,
      'EVAL-005': t.metrics.eval005Recall,
      'EVAL-011': t.metrics.eval011Recall,
      'Ret Latency (med)': `${t.metrics.medianRetrievalLatencyMs} ms`,
    }))
  );

  return trialResults;
}

if (require.main === module) {
  runTuningExperiments()
    .then(() => {
      closePool();
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[Tuning Experiments] Error:', err);
      closePool();
      process.exit(1);
    });
}

