import assert from 'assert';
import http from 'http';
import { createApp } from '../app';
import { closePool, query } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { adminDocumentService } from './adminDocumentService';
import { adminIngestionService } from './adminIngestionService';
import { authService } from './authService';
import { ingestionService } from './ingestionService';
import { retrievalService } from './retrievalService';

async function runAdminIngestionRecoveryTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.6 — Ingestion Monitoring & Recovery Suite  ');
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

  await runMigrations();
  await seedIdentities({ quiet: true });

  const testDocCodes = ['TST-561', 'TST-562', 'TST-563'];

  async function cleanupTestArtifacts(): Promise<void> {
    const docsRes = await query<{ id: string }>(
      `SELECT id FROM documents WHERE document_id = ANY($1::varchar[])`,
      [testDocCodes]
    );
    const uuids = docsRes.rows.map((r) => r.id);

    await query(
      `DELETE FROM audit_logs WHERE target_id = ANY($1::varchar[]) OR (target_id = ANY($2::varchar[]) AND action LIKE 'admin.ingestion.%')`,
      [[...testDocCodes, ...uuids], ['ingestion_batch', 'vector_fts_index']]
    );

    if (uuids.length > 0) {
      await query(`DELETE FROM approved_summaries WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_permissions WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_chunks WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM ingestion_jobs WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_versions WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [uuids]);
    }
  }

  await cleanupTestArtifacts();

  const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!;
  const priya = (await authService.resolveAuthenticatedUser('emp_001'))!;
  const daniel = (await authService.resolveAuthenticatedUser('emp_006'))!;
  const hannah = (await authService.resolveAuthenticatedUser('cu_001'))!;
  const leo = (await authService.resolveAuthenticatedUser('cu_002'))!;
  const suspended = (await authService.resolveAuthenticatedUser('emp_099'))!;

  const rafaelToken = await authService.createToken(rafael.id, rafael.email);
  const priyaToken = await authService.createToken(priya.id, priya.email);
  const hannahToken = await authService.createToken(hannah.id, hannah.email);
  const suspendedToken = await authService.createToken(suspended.id, suspended.email);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function requestJson(
    path: string,
    options: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}
  ): Promise<{ status: number; body: any; rawText: string }> {
    const headers: Record<string, string> = { ...(options.headers || {}) };
    if (options.token) {
      headers.Authorization = `Bearer ${options.token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const rawText = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed, rawText };
  }

  let failedJob561Id = '';
  let failedJob562V2Id = '';
  let completedJob561Id = '';

  try {
    await test('1. Unauthenticated & non-admin requests to ingestion recovery routes return 401/403', async () => {
      const unauthJobs = await requestJson('/api/admin/ingestion/jobs');
      assert.strictEqual(unauthJobs.status, 401);

      for (const token of [priyaToken, hannahToken, suspendedToken]) {
        const listRes = await requestJson('/api/admin/ingestion/jobs', { token });
        assert.strictEqual(listRes.status, 403);

        const cleanupRes = await requestJson('/api/admin/ingestion/cleanup', {
          method: 'POST',
          token,
          body: {},
        });
        assert.strictEqual(cleanupRes.status, 403);

        const batchRes = await requestJson('/api/admin/ingestion/reindex-batch', {
          method: 'POST',
          token,
          body: { document_ids: ['PDOC-0001'] },
        });
        assert.strictEqual(batchRes.status, 403);
      }
    });

    await test('2. Cross-origin CSRF protection blocks forged Origin on ingestion mutation endpoints', async () => {
      const csrfRes = await requestJson('/api/admin/ingestion/cleanup', {
        method: 'POST',
        token: rafaelToken,
        headers: { Origin: 'https://evil.example.com' },
        body: {},
      });
      assert.strictEqual(csrfRes.status, 403);
      assert.strictEqual(csrfRes.body?.error?.code, 'CSRF_FORBIDDEN');
    });

    await test('3. Initial processing failure leaves zero active chunks and exposes sanitized diagnostics', async () => {
      let threw = false;
      try {
        await ingestionService.ingestDocument({
          filename: 'tst-561.txt',
          buffer: Buffer.from('TOKEN_INITIAL_561 Brightwave recovery test doc.', 'utf-8'),
          overrideMetadata: {
            document_id: 'TST-561',
            title: 'Ingestion Recovery Test 561',
            document_type: 'runbook',
            tenant_id: 'ten_brightwave',
            owner_team: 'engineering',
            allowed_groups: ['grp_engineering'],
            sensitivity: 'internal',
            disclosure_policy: 'internal_only',
          },
          simulateProcessingFailure: true,
        });
      } catch (err: any) {
        threw = true;
        failedJob561Id = err.jobId || '';
      }
      assert.ok(threw, 'Expected simulated failure to throw');
      assert.ok(failedJob561Id, 'Expected failed job ID to be recorded');

      const detailRes = await requestJson(`/api/admin/ingestion/jobs/${failedJob561Id}`, {
        token: rafaelToken,
      });
      assert.strictEqual(detailRes.status, 200);
      assert.strictEqual(detailRes.body?.data?.job?.status, 'failed');
      assert.strictEqual(detailRes.body?.data?.job?.document_status, 'failed');
      assert.strictEqual(detailRes.body?.data?.job?.has_recovery_snapshot, true);
      assert.strictEqual(detailRes.body?.data?.job?.can_retry, true);
      assert.ok(!detailRes.rawText.includes('D:\\Projects'));

      const chunksCount = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM document_chunks c JOIN documents d ON d.id = c.document_id WHERE d.document_id = 'TST-561'`
      );
      assert.strictEqual(chunksCount.rows[0].count, '0');
    });

    await test('4. Partial failure during re-index leaves previous v1 active chunks intact and retrievable', async () => {
      const okV1 = await ingestionService.ingestDocument({
        filename: 'tst-562.txt',
        buffer: Buffer.from('TOKEN_V1_INTACT_562 Brightwave operational note.', 'utf-8'),
        overrideMetadata: {
          document_id: 'TST-562',
          title: 'Atomic Swap Test 562',
          document_type: 'runbook',
          tenant_id: 'ten_brightwave',
          owner_team: 'engineering',
          allowed_groups: ['grp_engineering'],
          sensitivity: 'internal',
          disclosure_policy: 'internal_only',
        },
      });
      assert.strictEqual(okV1.status, 'completed');

      let threw = false;
      try {
        await adminIngestionService.reindexDocument(
          rafael,
          'TST-562',
          { correlationId: 'test-56-partial', ipAddress: '127.0.0.1' },
          {
            content: 'TOKEN_V2_BROKEN_562 should never appear',
            force_reembed: true,
            simulate_failure: true,
          }
        );
      } catch (err: any) {
        threw = true;
        failedJob562V2Id = err.jobId || '';
      }
      assert.ok(threw);

      const danielVec = await retrievalService.retrieveChunks({
        query: 'TOKEN_V1_INTACT_562 Brightwave operational note',
        user: daniel,
        top_k: 5,
      });
      assert.ok(
        danielVec.chunks.some(
          (c) => c.document_id === 'TST-562' && c.content.includes('TOKEN_V1_INTACT_562')
        ),
        'Original active v1 chunk must remain retrievable after failed re-index'
      );
    });

    await test('5. Retry failed jobs succeeds across HTTP endpoint without version collisions and clears recovery snapshot', async () => {
      const retry561 = await requestJson(`/api/admin/ingestion/jobs/${failedJob561Id}/retry`, {
        method: 'POST',
        token: rafaelToken,
        body: {},
      });
      assert.strictEqual(retry561.status, 200, `Expected 200, got ${retry561.status}: ${retry561.rawText}`);
      assert.strictEqual(retry561.body?.data?.status, 'completed');
      completedJob561Id = retry561.body?.data?.job_id;

      // Also retry failed v2 job on TST-562 (tests monotonic version calculation v3 after failed v2!)
      const retry562 = await requestJson(`/api/admin/ingestion/jobs/${failedJob562V2Id}/retry`, {
        method: 'POST',
        token: rafaelToken,
        body: {},
      });
      assert.strictEqual(retry562.status, 200, `Expected 200, got ${retry562.status}: ${retry562.rawText}`);
      assert.strictEqual(retry562.body?.data?.status, 'completed');
      assert.ok(retry562.body?.data?.version >= 2);

      // Verify snapshot was wiped once completed
      const snapCheck = await query<{ snap: unknown }>(
        `SELECT source_snapshot AS snap FROM ingestion_jobs WHERE id = ANY($1::uuid[]) AND source_snapshot IS NOT NULL`,
        [[failedJob561Id, completedJob561Id]]
      );
      assert.strictEqual(snapCheck.rows.length, 0);

      // Verify audit log
      const auditRes = await query(
        `SELECT id FROM audit_logs WHERE target_id = 'TST-561' AND action = 'admin.ingestion.retry_succeeded'`
      );
      assert.ok(auditRes.rows.length >= 1);
    });

    await test('6. Retrying an already completed job returns 409 JOB_NOT_FAILED', async () => {
      const res = await requestJson(`/api/admin/ingestion/jobs/${completedJob561Id}/retry`, {
        method: 'POST',
        token: rafaelToken,
        body: {},
      });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body?.error?.code, 'JOB_NOT_FAILED');
    });

    await test('7. Retry limit (max_attempts=3) blocks infinite retry loops with 429 RETRY_LIMIT_EXCEEDED', async () => {
      let jobAttempt1 = '';
      try {
        await ingestionService.ingestDocument({
          filename: 'tst-563.txt',
          buffer: Buffer.from('TOKEN_RETRY_LIMIT_563 failing file.', 'utf-8'),
          overrideMetadata: {
            document_id: 'TST-563',
            title: 'Retry Limit Test 563',
            document_type: 'runbook',
            tenant_id: 'ten_brightwave',
            owner_team: 'engineering',
            allowed_groups: ['grp_engineering'],
            sensitivity: 'internal',
            disclosure_policy: 'internal_only',
          },
          simulateProcessingFailure: true,
        });
      } catch (err: any) {
        jobAttempt1 = err.jobId || '';
      }
      assert.ok(jobAttempt1);

      let jobAttempt2 = '';
      try {
        await adminIngestionService.retryFailedJob(
          rafael,
          jobAttempt1,
          { correlationId: 'test-limit-2', ipAddress: '127.0.0.1' },
          { simulate_failure: true }
        );
      } catch (err: any) {
        jobAttempt2 = err.jobId || '';
      }
      assert.ok(jobAttempt2);

      let jobAttempt3 = '';
      try {
        await adminIngestionService.retryFailedJob(
          rafael,
          jobAttempt2,
          { correlationId: 'test-limit-3', ipAddress: '127.0.0.1' },
          { simulate_failure: true }
        );
      } catch (err: any) {
        jobAttempt3 = err.jobId || '';
      }
      assert.ok(jobAttempt3);

      // Attempt #4 via HTTP MUST be rejected with 429
      const blockedRes = await requestJson(`/api/admin/ingestion/jobs/${jobAttempt3}/retry`, {
        method: 'POST',
        token: rafaelToken,
        body: {},
      });
      assert.strictEqual(blockedRes.status, 429);
      assert.strictEqual(blockedRes.body?.error?.code, 'RETRY_LIMIT_EXCEEDED');

      const auditBlocked = await query(
        `SELECT id FROM audit_logs WHERE target_id = 'TST-563' AND action = 'admin.ingestion.retry_blocked'`
      );
      assert.strictEqual(auditBlocked.rows.length, 1);
    });

    await test('8. Re-index preserves updated admin ACLs and retires superseded chunk content immediately', async () => {
      await adminDocumentService.updateDocumentPermissions(
        rafael,
        'TST-562',
        {
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
          allowed_groups: ['cust_ten_brightwave_users', 'grp_public'],
        },
        { correlationId: 'test-acl-562', ipAddress: '127.0.0.1' }
      );

      const reindexRes = await requestJson('/api/admin/documents/TST-562/reindex', {
        method: 'POST',
        token: rafaelToken,
        body: {
          content: 'TOKEN_V_UPDATED_562 Fresh Brightwave customer webhook guide.',
          force_reembed: true,
        },
      });
      assert.strictEqual(
        reindexRes.status,
        200,
        `Expected 200, got ${reindexRes.status}: ${reindexRes.rawText}`
      );

      // Brightwave customer Hannah sees updated content and NOT stale TOKEN_V1_INTACT_562
      const hannahVec = await retrievalService.retrieveChunks({
        query: 'TOKEN_V_UPDATED_562 Fresh Brightwave customer webhook guide',
        user: hannah,
        top_k: 5,
      });
      assert.ok(
        hannahVec.chunks.some(
          (c) => c.document_id === 'TST-562' && c.content.includes('TOKEN_V_UPDATED_562')
        ),
        'Hannah must retrieve newly re-indexed content under preserved customer_shareable ACL'
      );

      const hannahOld = await retrievalService.retrieveChunks({
        query: 'TOKEN_V1_INTACT_562',
        user: hannah,
        top_k: 5,
      });
      assert.strictEqual(
        hannahOld.chunks.some((c) => c.content.includes('TOKEN_V1_INTACT_562')),
        false,
        'Superseded v1 content must no longer be active/retrievable'
      );

      // Foreign tenant Leo remains strictly isolated
      const leoVec = await retrievalService.retrieveChunks({
        query: 'TOKEN_V_UPDATED_562 Fresh Brightwave customer webhook guide',
        user: leo,
        top_k: 5,
      });
      assert.strictEqual(leoVec.chunks.some((c) => c.document_id === 'TST-562'), false);
    });

    await test('9. Concurrent active ingestion guard prevents overlapping duplicate re-index jobs', async () => {
      const docRes = await query<{ id: string }>(
        `SELECT id FROM documents WHERE document_id = 'TST-562'`
      );
      const docUuid = docRes.rows[0].id;
      const inserted = await query<{ id: string }>(
        `INSERT INTO ingestion_jobs (document_id, status, job_type, started_at)
         VALUES ($1, 'processing', 'reindex', NOW()) RETURNING id`,
        [docUuid]
      );

      const conflictRes = await requestJson('/api/admin/documents/TST-562/reindex', {
        method: 'POST',
        token: rafaelToken,
        body: {},
      });
      assert.strictEqual(conflictRes.status, 409);
      assert.strictEqual(conflictRes.body?.error?.code, 'INGESTION_IN_PROGRESS');

      await query(`DELETE FROM ingestion_jobs WHERE id = $1`, [inserted.rows[0].id]);
    });

    await test('10. Batch re-index executes cleanly across explicit document selection and writes audit event', async () => {
      const batchRes = await requestJson('/api/admin/ingestion/reindex-batch', {
        method: 'POST',
        token: rafaelToken,
        body: { document_ids: ['TST-561', 'TST-562'], force_reembed: true },
      });
      assert.strictEqual(batchRes.status, 200);
      assert.strictEqual(batchRes.body?.data?.total_requested, 2);
      assert.strictEqual(batchRes.body?.data?.succeeded, 2);
      assert.strictEqual(batchRes.body?.data?.failed, 0);

      const auditBatch = await query(
        `SELECT id FROM audit_logs WHERE action = 'admin.ingestion.batch_reindex' AND target_id = 'ingestion_batch'`
      );
      assert.ok(auditBatch.rows.length >= 1);
    });

    await test('11. Stale index diagnostics detect desyncs/stale active chunks and cleanup endpoint repairs them atomically', async () => {
      // Simulate synthetic stale state on TST-561 & TST-562
      await query(`
        UPDATE document_chunks c
        SET is_active = true
        FROM document_versions v, documents d
        WHERE c.version_id = v.id
          AND c.document_id = d.id
          AND d.document_id = 'TST-562'
          AND v.status = 'archived'
      `);

      await query(`
        UPDATE document_chunks c
        SET metadata = c.metadata || '{"tenant_id":"ten_drifted_wrong"}'::jsonb
        FROM documents d
        WHERE c.document_id = d.id
          AND d.document_id = 'TST-561'
          AND c.is_active = true
      `);

      // Also inject a stale orphaned processing job
      const doc561 = await query<{ id: string }>(
        `SELECT id FROM documents WHERE document_id = 'TST-561'`
      );
      await query(
        `INSERT INTO ingestion_jobs (document_id, status, job_type, started_at)
         VALUES ($1, 'processing', 'reindex', NOW() - INTERVAL '30 minutes')`,
        [doc561.rows[0].id]
      );

      const preCheck = await requestJson('/api/admin/ingestion/jobs', { token: rafaelToken });
      assert.strictEqual(preCheck.status, 200);
      const health = preCheck.body?.data?.health;
      assert.ok(health.stale_active_chunks >= 1, 'Should detect stale active chunks');
      assert.ok(health.acl_desynced_documents >= 1, 'Should detect ACL desync');
      assert.ok(health.stale_processing_jobs >= 1, 'Should detect stale processing job');

      const cleanupRes = await requestJson('/api/admin/ingestion/cleanup', {
        method: 'POST',
        token: rafaelToken,
        body: { stale_threshold_minutes: 15 },
      });
      assert.strictEqual(cleanupRes.status, 200);
      assert.ok(cleanupRes.body?.data?.cleaned?.deactivated_stale_chunks >= 1);
      assert.ok(cleanupRes.body?.data?.cleaned?.resynced_acl_chunks >= 1);
      assert.ok(cleanupRes.body?.data?.cleaned?.recovered_stale_jobs >= 1);

      const postHealth = cleanupRes.body?.data?.health;
      assert.strictEqual(postHealth.stale_active_chunks, 0);
      assert.strictEqual(postHealth.acl_desynced_documents, 0);
      assert.strictEqual(postHealth.stale_processing_jobs, 0);
    });
  } finally {
    await cleanupTestArtifacts();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }

  console.log('\n==================================================================');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('==================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runAdminIngestionRecoveryTests().catch((err) => {
  console.error('Fatal error running Subphase 5.6 ingestion recovery tests:', err);
  process.exit(1);
});

