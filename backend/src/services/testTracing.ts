import assert from 'assert';
import { traceService, PipelineTrace } from './traceService';
import { ragService } from './ragService';
import { authService } from './authService';
import { closePool } from '../db';
import { AuthenticatedUser } from '../types/identity';

async function runTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 4.8 — Tracing & Data Minimization Test Suite ');
  console.log('==================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // Clear trace buffer before starting
  traceService.clearTraces();

  // --- TEST GROUP 1: Trace ID & Lifecycle ---
  console.log('--- TEST GROUP 1: Trace ID & Lifecycle ---');

  await test('generateTraceId returns a valid v4 UUID', () => {
    const id = traceService.generateTraceId();
    assert.strictEqual(typeof id, 'string');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  await test('recordTrace stores trace and retrieves it by trace_id', () => {
    const traceId = traceService.generateTraceId();
    const trace: PipelineTrace = {
      trace_id: traceId,
      timestamp: new Date().toISOString(),
      user: { id: 'emp_001', role: 'support_agent', tenant_scope: ['ten_brightwave'] },
      audience: 'internal',
      request: { question_length: 50, was_condensed: false },
      stages: {
        retrieval: {
          duration_ms: 45,
          strategy: 'hybrid',
          vector_pool_count: 20,
          fts_pool_count: 20,
          fused_count: 4,
          top_k: 4,
          candidate_document_ids: ['PDOC-0002', 'PDOC-0003'],
        },
        generation: { duration_ms: 1200, model: 'qwen2.5:3b', evidence_items_supplied: 4, retried_bounded_generation: false },
        validation: { duration_ms: 2, answer_valid: true, policy_violated: false },
        citations: { count: 1, cited_document_ids: ['PDOC-0002'], summary_citations_count: 0 },
      },
      outcome: { status: 'success', insufficient_evidence: false, unauthorized_access: false, policy_violated: false },
      total_latency_ms: 1250,
    };

    traceService.recordTrace(trace);
    const retrieved = traceService.getTrace(traceId);
    assert(retrieved, 'Trace should be retrievable by trace_id');
    assert.strictEqual(retrieved.trace_id, traceId);
    assert.strictEqual(retrieved.stages.retrieval.strategy, 'hybrid');
  });

  // --- TEST GROUP 2: Data Minimization & Privacy Verification ---
  console.log('\n--- TEST GROUP 2: Data Minimization & Privacy Verification ---');

  await test('Traces enforce data minimization (NO raw chunk texts, NO secrets)', () => {
    const traces = traceService.listTraces();
    const serialized = JSON.stringify(traces);

    // Verify no credentials or full raw chunk text are leaked into trace objects
    assert(!serialized.includes('password'), 'Trace should never contain password fields');
    assert(!serialized.includes('secret_key'), 'Trace should never contain secret keys');
    assert(!serialized.includes('token_hash'), 'Trace should never contain token hashes');

    for (const t of traces) {
      assert(Array.isArray(t.stages.retrieval.candidate_document_ids), 'Candidates must be document IDs only');
      for (const docId of t.stages.retrieval.candidate_document_ids) {
        assert(typeof docId === 'string' && docId.length < 50, 'Candidate must be short document ID, not raw chunk text');
      }
    }
  });

  // --- TEST GROUP 3: Access Control & Tenant Sanitization ---
  console.log('\n--- TEST GROUP 3: Access Control & Tenant Sanitization ---');

  await test('sanitizeForViewer permits admin to view full trace', () => {
    const adminUser: AuthenticatedUser = {
      id: 'emp_003',
      name: 'Elena Duarte',
      email: 'elena.duarte@clouddesk.example.com',
      role: 'support_lead',
      user_type: 'employee',
      tenant_scope: ['*'],
      groups: ['grp_all_employees', 'grp_support_leads'],
      status: 'active',
      has_wildcard_tenant: true,
    };

    const traces = traceService.listTraces();
    assert(traces.length > 0);
    const sanitized = traceService.sanitizeForViewer(traces[0], adminUser);
    assert(sanitized, 'Admin should be permitted to view trace');
    assert.strictEqual(sanitized.trace_id, traces[0].trace_id);
  });

  await test('sanitizeForViewer denies access to other users traces', () => {
    const otherUser: AuthenticatedUser = {
      id: 'emp_999',
      name: 'Unauthorized Stranger',
      email: 'stranger@example.com',
      role: 'support_agent',
      user_type: 'employee',
      tenant_scope: ['ten_other'],
      groups: ['grp_other'],
      status: 'active',
      has_wildcard_tenant: false,
    };

    const traces = traceService.listTraces();
    assert(traces.length > 0);
    const sanitized = traceService.sanitizeForViewer(traces[0], otherUser);
    assert.strictEqual(sanitized, null, 'Stranger must be denied access to another user trace');
  });

  // --- TEST GROUP 4: Live Pipeline End-to-End Tracing ---
  console.log('\n--- TEST GROUP 4: Live Pipeline End-to-End Tracing ---');

  await test('RAG answerQuestion automatically emits structured trace with trace_id', async () => {
    const user = await authService.resolveAuthenticatedUser('emp_001');
    assert(user, 'Priya Raman must exist');

    const res = await ragService.answerQuestion({
      question: 'What does error code CD-WHK-504 mean?',
      user,
      audience: 'internal',
      top_k: 4,
    });

    assert(res.trace_id, 'Response must include trace_id');
    const recordedTrace = traceService.getTrace(res.trace_id);
    assert(recordedTrace, 'Trace must be saved in trace buffer');
    assert.strictEqual(recordedTrace.user.id, 'emp_001');
    assert.strictEqual(recordedTrace.outcome.status, 'success');
    assert(recordedTrace.stages.retrieval.duration_ms > 0, 'Retrieval duration must be recorded');
    assert(recordedTrace.stages.citations.cited_document_ids.includes('PDOC-0002'));
  });

  await test('Unauthorized access attempts emit complete security audit trace', async () => {
    const marcus = await authService.resolveAuthenticatedUser('emp_002');
    assert(marcus, 'Marcus Webb must exist');

    // Marcus querying Brightwave ticket TKT-10421 (cross-tenant block)
    const res = await ragService.answerQuestion({
      question: 'What issue was reported in ticket TKT-10421?',
      user: marcus,
      audience: 'internal',
      top_k: 4,
    });

    assert(res.trace_id, 'Blocked response must include trace_id');
    const recordedTrace = traceService.getTrace(res.trace_id);
    assert(recordedTrace, 'Audit trace must be recorded for blocked request');
    assert.strictEqual(recordedTrace.outcome.status, 'unauthorized_access');
    assert.strictEqual(recordedTrace.outcome.unauthorized_access, true);
  });

  // --- SUMMARY ---
  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Tracing test runner error:', err);
    await closePool();
    process.exit(1);
  });
