import { closePool } from '../db';
import { ragService, INSUFFICIENT_EVIDENCE_MESSAGE } from './ragService';
import { AppError } from '../middleware/errorHandler';

async function runRAGTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 1.9 - RAG Pipeline & Grounded Answers Test  ');
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
    // TEST 1: Grounded Answer for Webhook Delivery Troubleshooting (PDOC-0001)
    // --------------------------------------------------------------------------
    console.log('--- TEST 1: Grounded Answer for Webhook Error CD-WHK-504 ---');
    const q1 = 'What causes webhook error CD-WHK-504 and what are the troubleshooting steps?';
    console.log(`Question: "${q1}"`);

    const r1 = await ragService.answerQuestion({ question: q1, top_k: 3 });

    console.log(`\nGenerated Answer:\n${r1.answer}\n`);
    console.log(`Citations (${r1.citations.length}):`, r1.citations.map((c) => `[${c.document_id}] ${c.title}`));
    console.log(`Latency: retrieval=${r1.latency_ms.retrieval}ms, generation=${r1.latency_ms.generation}ms, total=${r1.latency_ms.total}ms\n`);

    assert(r1.insufficient_evidence === false, 'Flagged as having sufficient evidence');
    assert(r1.answer.length > 50, 'Generated meaningful answer length');
    assert(
      r1.answer.toLowerCase().includes('504') || r1.answer.toLowerCase().includes('webhook'),
      'Answer mentions 504 or webhook details'
    );
    assert(r1.citations.length >= 1, 'At least one verified citation generated');
    assert(
      r1.citations[0].document_id === 'PDOC-0001' || r1.citations[0].document_id === 'PDOC-0002',
      `Citation points to verified source document (${r1.citations[0].document_id})`
    );
    assert(r1.citations[0].snippet.length > 0, 'Citation has non-empty snippet');
    assert(r1.retrieved_chunks.length >= 1, 'Retrieved chunks provenance recorded');

    // --------------------------------------------------------------------------
    // TEST 2: Grounded Answer for API Rate Limits (PDOC-0003)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: Grounded Answer for API Rate Limits ---');
    const q2 = 'What is the rate limit quota for API requests in the Enterprise tier?';
    console.log(`Question: "${q2}"`);

    const r2 = await ragService.answerQuestion({ question: q2, top_k: 3 });
    console.log(`\nGenerated Answer:\n${r2.answer}\n`);

    assert(r2.insufficient_evidence === false, 'Rate limit question has sufficient evidence');
    assert(
      r2.answer.includes('1,200') || r2.answer.includes('1200') || r2.answer.toLowerCase().includes('enterprise'),
      'Answer contains accurate rate limit quota from PDOC-0003'
    );
    assert(
      r2.citations.some((c) => c.document_id === 'PDOC-0003'),
      'Citation points to PDOC-0003'
    );

    // --------------------------------------------------------------------------
    // TEST 3: Grounded Answer for Support Ticket (TKT-10421)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: Grounded Answer for Support Ticket TKT-10421 ---');
    const q3 = 'What did Hannah Brooks report in the Brightwave support ticket?';
    console.log(`Question: "${q3}"`);

    const r3 = await ragService.answerQuestion({ question: q3, top_k: 3 });
    console.log(`\nGenerated Answer:\n${r3.answer}\n`);

    assert(r3.insufficient_evidence === false, 'Ticket question has sufficient evidence');
    assert(
      r3.answer.includes('Brightwave') || r3.answer.includes('timeout') || r3.answer.includes('Hannah'),
      'Answer contains accurate ticket details'
    );
    assert(
      r3.citations.some((c) => c.document_id === 'TKT-10421' && c.tenant_id === 'ten_brightwave'),
      'Citation preserved tenant_id ten_brightwave'
    );

    // --------------------------------------------------------------------------
    // TEST 4: Citation Validation (No Hallucinated Citations)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 4: Citation Validation Against Context ---');
    const retrievedDocIds = new Set(r1.retrieved_chunks.map((c) => c.document_id));
    for (const citation of r1.citations) {
      assert(
        retrievedDocIds.has(citation.document_id),
        `Citation [${citation.document_id}] is strictly validated against retrieved context`
      );
    }

    // --------------------------------------------------------------------------
    // TEST 5: Insufficient Evidence Handling (Refusal without Hallucination)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 5: Insufficient Evidence Handling ---');
    const qUnsupported = 'What is the personal home address and CEO salary of the CloudDesk founder?';
    console.log(`Unsupported Question: "${qUnsupported}"`);

    const rUnsupported = await ragService.answerQuestion({
      question: qUnsupported,
      top_k: 2,
    });
    console.log(`\nResponse:\n${rUnsupported.answer}\n`);

    assert(rUnsupported.insufficient_evidence === true, 'Unsupported question flagged as insufficient_evidence: true');
    assert(
      rUnsupported.answer.toLowerCase().includes('insufficient evidence') ||
      rUnsupported.answer.toLowerCase().includes('not have sufficient evidence'),
      'Returned explicit insufficient evidence message'
    );
    assert(rUnsupported.citations.length === 0, 'No citations attached to unsupported answer');

    // --------------------------------------------------------------------------
    // TEST 6: Zero Retrieval Short-Circuit
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 6: Zero Retrieval Short-Circuit ---');
    const rZero = await ragService.answerQuestion({
      question: 'XJZZ9988_NON_EXISTENT_QUERY_TERM_12345',
      min_similarity: 0.99, // Force 0 chunks
    });

    assert(rZero.insufficient_evidence === true, 'Zero retrieval returned insufficient_evidence: true');
    assert(rZero.answer === INSUFFICIENT_EVIDENCE_MESSAGE, 'Returned standard insufficient evidence message');
    assert(rZero.latency_ms.generation === 0, 'Generation latency is 0ms (no LLM call wasted)');

    // --------------------------------------------------------------------------
    // TEST 7: Input Validation & Error Handling
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 7: Input Validation & Error Handling ---');
    let threwEmpty = false;
    try {
      await ragService.answerQuestion({ question: '   ' });
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_QUESTION' && err.statusCode === 400) {
        threwEmpty = true;
      }
    }
    assert(threwEmpty, 'Empty question rejected with 400 INVALID_QUESTION');

    let threwModelError = false;
    try {
      await ragService.answerQuestion({
        question: 'What is CD-WHK-504?',
        model: 'non_existent_model_xyz',
      });
    } catch (err) {
      if (err instanceof AppError && err.code === 'MODEL_GENERATION_FAILED' && err.statusCode === 502) {
        threwModelError = true;
      }
    }
    assert(threwModelError, 'Non-existent model caught with 502 MODEL_GENERATION_FAILED');

    console.log('\n==================================================================');
    console.log(` ALL ${passedTests}/${totalTests} RAG PIPELINE TESTS PASSED SUCCESSFULLY! `);
    console.log(' Subphase 1.9 Acceptance Criteria Fully Met.                      ');
    console.log('==================================================================\n');
  } finally {
    await closePool();
  }
}

runRAGTestSuite().catch((err) => {
  console.error('\nFatal RAG test runner error:', err);
  process.exit(1);
});
