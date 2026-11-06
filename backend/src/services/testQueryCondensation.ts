import assert from 'assert';
import { queryCondensationService } from './queryCondensationService';
import { ragService } from './ragService';
import { authService } from './authService';
import { closePool } from '../db';
import { ChatMessageTurn } from '../types/rag';

async function runQueryCondensationTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.4 — Conversational Query Condensation Tests');
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

  const priya = await authService.resolveAuthenticatedUser('emp_001');
  const hannah = await authService.resolveAuthenticatedUser('cu_001');

  if (!priya || !hannah) {
    throw new Error('Required test identities (emp_001, cu_001) could not be resolved.');
  }

  try {
    // =========================================================================
    // GROUP 1: Unit Level Query Condensation Logic & Heuristics
    // =========================================================================
    console.log('--- TEST GROUP 1: Fast Bypass & Heuristic Logic ---');

    await test('Single-turn query (no chat history) returns original query immediately with zero latency', async () => {
      const q = 'What are the API rate limits for the Starter plan?';
      const res = await queryCondensationService.condenseQuery({
        question: q,
        chat_history: [],
      });

      assert.strictEqual(res.condensed_query, q);
      assert.strictEqual(res.was_condensed, false);
      assert.strictEqual(res.latency_ms, 0);
    });

    await test('Undefined or empty chat history turns return original query immediately', async () => {
      const q = 'What is error CD-API-429?';
      const res = await queryCondensationService.condenseQuery({
        question: q,
        chat_history: undefined,
      });

      assert.strictEqual(res.condensed_query, q);
      assert.strictEqual(res.was_condensed, false);
      assert.strictEqual(res.latency_ms, 0);
    });

    await test('Empty string question throws validation AppError', async () => {
      let threw = false;
      try {
        await queryCondensationService.condenseQuery({
          question: '   ',
          chat_history: [],
        });
      } catch {
        threw = true;
      }
      assert(threw, 'Should throw AppError on whitespace question');
    });

    // =========================================================================
    // GROUP 2: Pronoun and Entity Resolution (Live Ollama LLM)
    // =========================================================================
    console.log('\n--- TEST GROUP 2: Pronoun & Reference Resolution (Ollama) ---');

    await test('Pronoun resolution: rewrites "How do I fix that timeout error?" to include CD-WHK-504', async () => {
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'What does error code CD-WHK-504 mean and what is its retry policy?',
        },
        {
          role: 'assistant',
          content:
            'Error CD-WHK-504 indicates a webhook delivery gateway timeout when a customer endpoint does not respond within 10 seconds. CloudDesk retries up to 5 times. [PDOC-0002]',
        },
      ];

      const res = await queryCondensationService.condenseQuery({
        question: 'How do I fix that timeout error?',
        chat_history: history,
      });

      assert(res.was_condensed, 'Should mark query as condensed');
      const lower = res.condensed_query.toLowerCase();
      assert(
        res.condensed_query.includes('CD-WHK-504') || lower.includes('cd-whk-504'),
        `Condensed query must include error code CD-WHK-504 (got: "${res.condensed_query}")`
      );
      assert(
        lower.includes('timeout') || lower.includes('webhook'),
        `Condensed query must include timeout/webhook context (got: "${res.condensed_query}")`
      );
      console.log(`    Original: "How do I fix that timeout error?" -> Condensed: "${res.condensed_query}" (${res.latency_ms}ms)`);
    });

    await test('Entity resolution: rewrites "Who submitted it and what was the problem?" to include TKT-10467', async () => {
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'Tell me about support ticket TKT-10467 for Lumenfield High School.',
        },
        {
          role: 'assistant',
          content:
            'Ticket TKT-10467 describes outdated ticket metrics on the school administrative dashboard due to database read replica lag. [TKT-10467]',
        },
      ];

      const res = await queryCondensationService.condenseQuery({
        question: 'Who submitted it and what was the problem?',
        chat_history: history,
      });

      assert(res.was_condensed, 'Should mark query as condensed');
      assert(
        res.condensed_query.includes('TKT-10467') || res.condensed_query.toLowerCase().includes('lumenfield'),
        `Condensed query must resolve entity to TKT-10467 or Lumenfield (got: "${res.condensed_query}")`
      );
      console.log(`    Original: "Who submitted it..." -> Condensed: "${res.condensed_query}" (${res.latency_ms}ms)`);
    });

    await test('Elliptical follow-up: rewrites "What about Enterprise?" after rate limit discussion', async () => {
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'What are the API rate limits for the Starter plan?',
        },
        {
          role: 'assistant',
          content:
            'The Starter plan allows up to 60 API requests per minute with a burst allowance of 10 requests. [PDOC-0003]',
        },
      ];

      const res = await queryCondensationService.condenseQuery({
        question: 'What about Enterprise?',
        chat_history: history,
      });

      assert(res.was_condensed, 'Should mark query as condensed');
      const lower = res.condensed_query.toLowerCase();
      assert(
        lower.includes('enterprise') && (lower.includes('rate limit') || lower.includes('api')),
        `Condensed query must expand to Enterprise plan API rate limits (got: "${res.condensed_query}")`
      );
      console.log(`    Original: "What about Enterprise?" -> Condensed: "${res.condensed_query}" (${res.latency_ms}ms)`);
    });

    // =========================================================================
    // GROUP 3: End-to-End Multi-Turn RAG Verification (EVAL-011 Fix)
    // =========================================================================
    console.log('\n--- TEST GROUP 3: End-to-End Multi-Turn RAG (EVAL-011 Resolution) ---');

    await test('EVAL-011 Resolution: Multi-turn follow-up retrieves PDOC-0002 and cites correct evidence', async () => {
      // Simulate Turn 1:
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'What does error code CD-WHK-504 mean and what is its retry policy?',
        },
        {
          role: 'assistant',
          content:
            'Error code CD-WHK-504 indicates a webhook delivery gateway timeout when a customer endpoint does not respond within 10 seconds. CloudDesk retries up to 5 times with exponential backoff. [PDOC-0002]',
        },
      ];

      // Turn 2 follow-up question:
      const res = await ragService.answerQuestion({
        question: 'How do I fix that timeout error?',
        chat_history: history,
        user: priya,
        audience: 'internal',
        top_k: 4,
      });

      assert.strictEqual(res.insufficient_evidence, false, 'Should not return insufficient evidence');
      assert.strictEqual(res.was_condensed, true, 'Query should be condensed');
      assert(res.condensed_query, 'Must return condensed_query');
      assert(res.citations.length > 0, 'Must produce citations');
      assert(
        res.citations.some((c) => c.document_id === 'PDOC-0002'),
        `Must cite PDOC-0002 (Webhooks Overview). Actual citations: [${res.citations.map((c) => c.document_id).join(', ')}]`
      );
      assert(
        res.retrieved_chunks.some((c) => c.document_id === 'PDOC-0002'),
        'Retrieved chunks must include PDOC-0002'
      );
      console.log(`    EVAL-011 Condensed Query: "${res.condensed_query}"`);
      console.log(`    Retrieved Docs: [${res.retrieved_chunks.map((c) => c.document_id).join(', ')}]`);
      console.log(`    Citations: [${res.citations.map((c) => c.document_id).join(', ')}]`);
      console.log(`    Condensation Latency: ${res.latency_ms.condensation}ms | Retrieval: ${res.latency_ms.retrieval}ms`);
    });

    // =========================================================================
    // GROUP 4: Multi-Turn Security & Disclosure Boundary Enforcement
    // =========================================================================
    console.log('\n--- TEST GROUP 4: Multi-Turn Authorization & Policy Isolation ---');

    await test('Tenant isolation: follow-up attempting cross-tenant ticket query is blocked at SQL level', async () => {
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'How do CloudDesk webhooks work?',
        },
        {
          role: 'assistant',
          content: 'CloudDesk webhooks provide near real-time event notifications for tickets and account events. [PDOC-0002]',
        },
      ];

      // Hannah is scoped strictly to ten_brightwave. She attempts to query Harborpine ticket TKT-10533
      const res = await ragService.answerQuestion({
        question: 'What is the status of that Harborpine ticket TKT-10533?',
        chat_history: history,
        user: hannah,
        audience: 'customer',
      });

      assert(res.insufficient_evidence || res.unauthorized_access, 'Must refuse access to cross-tenant ticket');
      assert.strictEqual(res.citations.length, 0, 'Zero citations for unauthorized cross-tenant query');
      assert.strictEqual(
        res.retrieved_chunks.filter((c) => c.document_id === 'TKT-10533').length,
        0,
        'Harborpine ticket chunks must not be retrieved for Brightwave customer'
      );
    });

    await test('Disclosure policy: customer mode follow-up strictly excludes internal runbook chunks', async () => {
      const history: ChatMessageTurn[] = [
        {
          role: 'user',
          content: 'Tell me about the internal dispatcher troubleshooting runbook PDOC-0001.',
        },
        {
          role: 'assistant',
          content: 'PDOC-0001 covers internal dispatcher CLI and manual re-enqueue operations. [PDOC-0001]',
        },
      ];

      // Priya in customer mode asks follow-up about dispatcher procedures
      const res = await ragService.answerQuestion({
        question: 'What are the dispatcher commands mentioned earlier?',
        chat_history: history,
        user: priya,
        audience: 'customer', // Customer mode enforced
      });

      assert.strictEqual(res.insufficient_evidence, true, 'Customer mode must refuse internal runbook procedures');
      assert.strictEqual(res.citations.length, 0, 'Zero citations for internal runbook in customer mode');
      assert.strictEqual(
        res.retrieved_chunks.length,
        0,
        'Internal runbook chunks must be completely excluded before prompt construction in customer mode'
      );
    });
  } finally {
    await closePool();
  }

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} query condensation test(s) failed.`);
  }
}

if (require.main === module) {
  runQueryCondensationTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[Query Condensation Tests] Fatal error:', err);
      process.exit(1);
    });
}

