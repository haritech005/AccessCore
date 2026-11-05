import fs from 'fs';
import path from 'path';
import { EVALUATION_DATASET, EvaluationCase } from './dataset';
import { authService } from '../services/authService';
import { hybridRetrievalService } from '../services/hybridRetrievalService';
import { ragService } from '../services/ragService';
import { closePool } from '../db';
import { EvaluationCaseResult, BaselineEvaluationSummary } from './runBaselineEval';

export async function runHybridEvaluation(): Promise<BaselineEvaluationSummary> {
  console.log('================================================================================');
  console.log(' AccessCore Hybrid Retrieval & Evaluation Runner (Subphase 4.3)');
  console.log(' Engine: Dense Vector (pgvector) + Sparse Lexical (tsvector) + RRF (k=60)');
  console.log('================================================================================\n');

  const caseResults: EvaluationCaseResult[] = [];
  const retrievalLatencies: number[] = [];
  const generationLatencies: number[] = [];
  const totalLatencies: number[] = [];

  for (let i = 0; i < EVALUATION_DATASET.length; i++) {
    const testCase = EVALUATION_DATASET[i];
    console.log(`[${i + 1}/${EVALUATION_DATASET.length}] Running ${testCase.id} (${testCase.category})...`);
    console.log(`  Question: "${testCase.question}"`);
    console.log(`  User: ${testCase.userName} (${testCase.userId}) | Role: ${testCase.userRole} | Audience: ${testCase.audience}`);

    const user = await authService.resolveAuthenticatedUser(testCase.userId);
    if (!user) {
      throw new Error(`Evaluation identity '${testCase.userId}' could not be resolved from database.`);
    }

    // 1. Direct Hybrid Retrieval Stage Measurement
    const retRes = await hybridRetrievalService.retrieveHybridChunks({
      query: testCase.question,
      user,
      top_k: 4,
      vector_candidates: 20,
      fts_candidates: 20,
      rrf_k: 60,
      audience: testCase.audience,
    });

    const retrievedDocIds = retRes.chunks.map((c) => c.document_id);
    const top3DocIds = retrievedDocIds.slice(0, 3);
    const top4DocIds = retrievedDocIds.slice(0, 4);

    // Compute Recall@3 and Recall@4
    let recallAt3 = 0;
    let recallAt4 = 0;

    if (testCase.expectedDocumentIds.length > 0) {
      const uniqueTop3 = new Set(top3DocIds);
      const matchesAt3 = testCase.expectedDocumentIds.filter((id) => uniqueTop3.has(id)).length;
      recallAt3 = matchesAt3 / testCase.expectedDocumentIds.length;

      const uniqueTop4 = new Set(top4DocIds);
      const matchesAt4 = testCase.expectedDocumentIds.filter((id) => uniqueTop4.has(id)).length;
      recallAt4 = matchesAt4 / testCase.expectedDocumentIds.length;
    } else {
      // For negative / restricted / insufficient cases, recall is 1.0 if zero unauthorized documents returned
      const unauthorizedDocsReturned = retrievedDocIds.length > 0;
      recallAt3 = unauthorizedDocsReturned ? 0.0 : 1.0;
      recallAt4 = unauthorizedDocsReturned ? 0.0 : 1.0;
    }

    // 2. Full RAG Answer Generation Measurement with Hybrid Retrieval
    const ragRes = await ragService.answerQuestion({
      question: testCase.question,
      user,
      audience: testCase.audience,
      top_k: 4,
      retrieval_strategy: 'hybrid',
      vector_candidates: 20,
      fts_candidates: 20,
      rrf_k: 60,
    });

    const retMs = ragRes.latency_ms?.retrieval ?? retRes.latency_ms.total;
    const genMs = ragRes.latency_ms?.generation ?? 0;
    const totMs = ragRes.latency_ms?.total ?? (retMs + genMs);

    retrievalLatencies.push(retMs);
    generationLatencies.push(genMs);
    totalLatencies.push(totMs);

    // 3. Evaluate Citation Validity
    let citationValid = true;
    const citations = ragRes.citations.map((c) => ({
      document_id: c.document_id,
      is_summary: c.is_summary,
      title: c.title,
    }));

    if (testCase.expectedDocumentIds.length === 0) {
      citationValid = citations.length === 0;
    } else {
      const citedIds = citations.map((c) => c.document_id);
      const hasExpectedDoc = testCase.expectedDocumentIds.some((id) => citedIds.includes(id));
      citationValid = hasExpectedDoc;

      if (testCase.audience === 'customer' && testCase.category === 'customer_facing_disclosure') {
        citationValid = citationValid && citations.every((c) => c.is_summary === true);
      }
    }

    // 4. Evaluate Groundedness & Behavior
    let groundednessPassed = true;
    let behaviorPassed = true;
    let notes = '';

    const lowerAnswer = ragRes.answer.toLowerCase();

    switch (testCase.expectedAuthDisclosureBehavior) {
      case 'permitted_full':
        if (ragRes.insufficient_evidence || ragRes.unauthorized_access || ragRes.policy_violated) {
          groundednessPassed = false;
          notes += 'Unexpected refusal on permitted query. ';
        }
        const matchesKeywords = testCase.expectedAnswerKeywords.some((kw) =>
          lowerAnswer.includes(kw.toLowerCase())
        );
        if (!matchesKeywords) {
          groundednessPassed = false;
          notes += 'Answer did not contain expected key facts. ';
        }
        behaviorPassed = !ragRes.unauthorized_access && !ragRes.policy_violated;
        break;

      case 'permitted_approved_summary':
        if (ragRes.insufficient_evidence || ragRes.unauthorized_access) {
          groundednessPassed = false;
          notes += 'Unexpected refusal on approved summary query. ';
        }
        const hasApprovedBadge = citations.some((c) => c.is_summary);
        if (!hasApprovedBadge) {
          behaviorPassed = false;
          notes += 'Citation did not indicate approved customer summary. ';
        }
        break;

      case 'blocked_tenant_isolation':
      case 'blocked_sensitivity':
        if (!ragRes.unauthorized_access && !ragRes.insufficient_evidence) {
          behaviorPassed = false;
          groundednessPassed = false;
          notes += 'SECURITY LEAK: Did not refuse unauthorized query! ';
        }
        break;

      case 'blocked_internal_only':
      case 'refusal_insufficient_evidence':
        if (!ragRes.insufficient_evidence) {
          behaviorPassed = false;
          groundednessPassed = false;
          notes += 'Did not return insufficient evidence refusal. ';
        }
        break;

      case 'customer_group_boundary_observation':
        behaviorPassed = true;
        groundednessPassed = ragRes.unauthorized_access || ragRes.insufficient_evidence;
        notes += '[OBSERVATION 1] Customer persona ticket query boundary. ';
        break;
    }

    if (testCase.isConversationalFollowup) {
      if (recallAt4 < 1.0) {
        notes += '[SUBPHASE 4.4 TARGET] Pronoun query needs query condensation. ';
      }
    }

    const overallPassed = (recallAt4 >= 1.0 || testCase.expectedDocumentIds.length === 0) &&
                          citationValid &&
                          behaviorPassed &&
                          groundednessPassed;

    const answerExcerpt = ragRes.answer.length > 120
      ? ragRes.answer.substring(0, 117) + '...'
      : ragRes.answer;

    console.log(`  -> Retrieved Docs: [${retrievedDocIds.join(', ')}]`);
    console.log(`  -> Recall@3: ${(recallAt3 * 100).toFixed(0)}% | Recall@4: ${(recallAt4 * 100).toFixed(0)}%`);
    console.log(`  -> Citations: [${citations.map((c) => `${c.document_id}${c.is_summary ? '(summary)' : ''}`).join(', ')}]`);
    console.log(`  -> Latency: Retrieval ${retMs}ms | Generation ${genMs}ms | Total ${totMs}ms`);
    console.log(`  -> Status: ${overallPassed ? '✓ PASS' : '✗ LIMITATION'} ${notes ? `(${notes.trim()})` : ''}\n`);

    caseResults.push({
      id: testCase.id,
      category: testCase.category,
      description: testCase.description,
      question: testCase.question,
      user: `${testCase.userName} (${testCase.userId})`,
      audience: testCase.audience,
      expectedDocumentIds: testCase.expectedDocumentIds,
      retrievedDocumentIds: retrievedDocIds,
      top3DocumentIds: top3DocIds,
      recallAt3,
      recallAt4,
      citations,
      citationValid,
      groundednessPassed,
      behaviorPassed,
      overallPassed,
      latencies: {
        retrievalMs: retMs,
        generationMs: genMs,
        totalMs: totMs,
      },
      answerExcerpt,
      notes: notes.trim(),
    });
  }

  function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  }

  const totalCases = caseResults.length;
  const overallPassedCount = caseResults.filter((r) => r.overallPassed).length;
  const overallPassRate = `${((overallPassedCount / totalCases) * 100).toFixed(1)}%`;

  const meanRecall3Val = mean(caseResults.map((r) => r.recallAt3 * 100));
  const meanRecall4Val = mean(caseResults.map((r) => r.recallAt4 * 100));

  const validCitationsCount = caseResults.filter((r) => r.citationValid).length;
  const citationValidityRate = `${((validCitationsCount / totalCases) * 100).toFixed(1)}%`;

  const groundedCount = caseResults.filter((r) => r.groundednessPassed).length;
  const groundednessComplianceRate = `${((groundedCount / totalCases) * 100).toFixed(1)}%`;

  const summary: BaselineEvaluationSummary = {
    timestamp: new Date().toISOString(),
    totalCases,
    overallPassedCount,
    overallPassRate,
    meanRecallAt3: `${meanRecall3Val.toFixed(1)}%`,
    meanRecallAt4: `${meanRecall4Val.toFixed(1)}%`,
    citationValidityRate,
    groundednessComplianceRate,
    latency: {
      medianRetrievalMs: median(retrievalLatencies),
      meanRetrievalMs: mean(retrievalLatencies),
      medianGenerationMs: median(generationLatencies),
      meanGenerationMs: mean(generationLatencies),
      medianTotalMs: median(totalLatencies),
      meanTotalMs: mean(totalLatencies),
    },
    results: caseResults,
  };

  const outPath = path.resolve(__dirname, 'hybrid-results.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`[Hybrid Eval] Detailed hybrid metrics saved to: ${outPath}\n`);

  console.log('================================================================================');
  console.log(' HYBRID RETRIEVAL EVALUATION REPORT SUMMARY (Subphase 4.3)');
  console.log('================================================================================');
  console.log(`Total Test Cases:            ${totalCases}`);
  console.log(`Pass Rate:                   ${overallPassedCount} / ${totalCases} (${overallPassRate})`);
  console.log(`Mean Recall@3:               ${summary.meanRecallAt3}`);
  console.log(`Mean Recall@4:               ${summary.meanRecallAt4}`);
  console.log(`Citation Validity Rate:      ${citationValidityRate}`);
  console.log(`Groundedness Compliance:     ${groundednessComplianceRate}`);
  console.log('--------------------------------------------------------------------------------');
  console.log('Pipeline Latencies:');
  console.log(`  Hybrid Retrieval (Median): ${summary.latency.medianRetrievalMs} ms (Mean: ${summary.latency.meanRetrievalMs} ms)`);
  console.log(`  LLM Generation (Median):   ${summary.latency.medianGenerationMs} ms (Mean: ${summary.latency.meanGenerationMs} ms)`);
  console.log(`  End-to-End Total (Median): ${summary.latency.medianTotalMs} ms (Mean: ${summary.latency.meanTotalMs} ms)`);
  console.log('================================================================================\n');

  console.table(
    caseResults.map((r) => ({
      ID: r.id,
      Category: r.category,
      User: r.user.split(' ')[0],
      Audience: r.audience,
      Expected: r.expectedDocumentIds.join(','),
      Retrieved: r.retrievedDocumentIds.join(','),
      'Rec@3': `${(r.recallAt3 * 100).toFixed(0)}%`,
      'Rec@4': `${(r.recallAt4 * 100).toFixed(0)}%`,
      Citations: r.citations.map((c) => c.document_id).join(','),
      'Ret(ms)': r.latencies.retrievalMs,
      'Tot(ms)': r.latencies.totalMs,
      Status: r.overallPassed ? '✓ PASS' : '✗ LIMITATION',
    }))
  );

  return summary;
}

if (require.main === module) {
  runHybridEvaluation()
    .then(() => {
      closePool();
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[Hybrid Eval] Fatal error executing evaluation:', err);
      closePool();
      process.exit(1);
    });
}

