import assert from 'assert';
import http from 'http';
import { createApp } from '../app';
import { closePool, query } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { retrievalService } from './retrievalService';
import { fullTextSearchService } from './fullTextSearchService';

async function runAdminDocumentsWorkflowTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.5 — Document Permissions & Upload Suite    ');
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

  const testDocCodes = ['TST-551', 'TST-552', 'TST-553'];

  async function cleanupTestDocuments(): Promise<void> {
    const docsRes = await query<{ id: string }>(
      `SELECT id FROM documents WHERE document_id = ANY($1::varchar[])`,
      [testDocCodes]
    );
    const uuids = docsRes.rows.map((r) => r.id);

    await query(`DELETE FROM audit_logs WHERE target_id = ANY($1::varchar[])`, [
      [...testDocCodes, ...uuids],
    ]);

    if (uuids.length > 0) {
      await query(`DELETE FROM approved_summaries WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_permissions WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_chunks WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM ingestion_jobs WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM document_versions WHERE document_id = ANY($1::uuid[])`, [uuids]);
      await query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [uuids]);
    }
  }

  await cleanupTestDocuments();

  const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!;
  const priya = (await authService.resolveAuthenticatedUser('emp_001'))!;
  const meiLin = (await authService.resolveAuthenticatedUser('emp_007'))!;
  const daniel = (await authService.resolveAuthenticatedUser('emp_006'))!;
  const hannah = (await authService.resolveAuthenticatedUser('cu_001'))!;
  const leo = (await authService.resolveAuthenticatedUser('cu_002'))!;
  const suspended = (await authService.resolveAuthenticatedUser('emp_099'))!;

  const rafaelToken = await authService.createToken(rafael.id, rafael.email);
  const priyaToken = await authService.createToken(priya.id, priya.email);
  const meiLinToken = await authService.createToken(meiLin.id, meiLin.email);
  const danielToken = await authService.createToken(daniel.id, daniel.email);
  const hannahToken = await authService.createToken(hannah.id, hannah.email);
  const leoToken = await authService.createToken(leo.id, leo.email);
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

  try {
    await test('1. Unauthenticated requests to document admin routes return 401', async () => {
      const listRes = await requestJson('/api/admin/documents');
      assert.strictEqual(listRes.status, 401);
      const uploadRes = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        body: { filename: 'x.txt', content: 'hello' },
      });
      assert.strictEqual(uploadRes.status, 401);
    });

    await test('2. Non-admin users (support, eng manager, customer, suspended) receive 403 on upload & governance routes', async () => {
      const samplePayload = {
        filename: 'unauth.txt',
        content: 'Unauthorized upload attempt',
        override_metadata: {
          document_id: 'TST-553',
          title: 'Unauth Doc',
          document_type: 'faq',
          tenant_id: 'ten_brightwave',
          owner_team: 'support',
          allowed_groups: ['grp_support'],
          sensitivity: 'internal',
          disclosure_policy: 'internal_only',
        },
      };

      for (const token of [priyaToken, meiLinToken, hannahToken, suspendedToken]) {
        const adminUpload = await requestJson('/api/admin/documents/upload', {
          method: 'POST',
          token,
          body: samplePayload,
        });
        assert.strictEqual(adminUpload.status, 403);

        const publicIngest = await requestJson('/api/documents/ingest', {
          method: 'POST',
          token,
          body: {
            filename: 'unauth.md',
            content: '# No\nNot allowed',
          },
        });
        assert.strictEqual(publicIngest.status, 403);

        const listAdminDocs = await requestJson('/api/admin/documents', { token });
        assert.strictEqual(listAdminDocs.status, 403);
      }
    });

    await test('3. Cross-origin CSRF protection blocks forged browser origins on admin document mutations', async () => {
      const res = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        headers: { Origin: 'https://evil.example.com' },
        body: { filename: 'x.txt', content: 'csrf test' },
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body?.error?.code, 'CSRF_FORBIDDEN');
    });

    await test('4. Upload validation rejects empty, oversized (>10MB), unsupported (.exe), and traversal filenames', async () => {
      const emptyRes = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: { filename: 'empty.txt', content: '' },
      });
      assert.strictEqual(emptyRes.status, 400);

      const extRes = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: { filename: 'malware.exe', content: 'MZ...' },
      });
      assert.strictEqual(extRes.status, 415);

      const traversalRes = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: { filename: '../../etc/passwd.txt', content: 'bad filename' },
      });
      assert.strictEqual(traversalRes.status, 400);

      // > 10MB base64 buffer
      const oversizedBuf = Buffer.alloc(10 * 1024 * 1024 + 512, 'a').toString('base64');
      const largeRes = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: {
          filename: 'oversized.txt',
          content: oversizedBuf,
          is_base64: true,
        },
      });
      assert.strictEqual(largeRes.status, 413);
    });

    await test('5. Upload validation rejects invalid tenant, unknown group, and incompatible sensitivity/policy', async () => {
      const badTenant = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: {
          filename: 'bad-tenant.txt',
          content: 'Valid text body',
          override_metadata: {
            document_id: 'TST-553',
            title: 'Bad Tenant Doc',
            document_type: 'product_doc',
            tenant_id: 'ten_nonexistent',
            owner_team: 'customer_support',
            allowed_groups: ['grp_support'],
            sensitivity: 'internal',
            disclosure_policy: 'internal_only',
          },
        },
      });
      assert.strictEqual(badTenant.status, 400);
      assert.strictEqual(badTenant.body?.error?.code, 'INVALID_TENANT');

      const badGroup = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: {
          filename: 'bad-group.txt',
          content: 'Valid text body',
          override_metadata: {
            document_id: 'TST-553',
            title: 'Bad Group Doc',
            document_type: 'product_doc',
            tenant_id: 'ten_brightwave',
            owner_team: 'customer_support',
            allowed_groups: ['grp_fake_does_not_exist'],
            sensitivity: 'internal',
            disclosure_policy: 'internal_only',
          },
        },
      });
      assert.strictEqual(badGroup.status, 400);
      assert.strictEqual(badGroup.body?.error?.code, 'INVALID_GROUP');

      const badPolicy = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: {
          filename: 'bad-policy.txt',
          content: 'Restricted cannot be customer_shareable',
          override_metadata: {
            document_id: 'TST-553',
            title: 'Bad Policy Doc',
            document_type: 'product_doc',
            tenant_id: 'ten_brightwave',
            owner_team: 'it_security',
            allowed_groups: ['grp_security_restricted'],
            sensitivity: 'restricted',
            disclosure_policy: 'customer_shareable',
          },
        },
      });
      assert.strictEqual(badPolicy.status, 400);
      assert.strictEqual(badPolicy.body?.error?.code, 'POLICY_CONFLICT');
    });

    await test('6. Admin .txt upload via /api/admin/documents/upload succeeds and sets ACL + audit trail without leaking raw content', async () => {
      const secretBody = 'UNIQUE_RAW_TOKEN_551 Internal Brightwave telemetry pipeline calibration note.';
      const res = await requestJson('/api/admin/documents/upload', {
        method: 'POST',
        token: rafaelToken,
        body: {
          filename: 'bw-telemetry-calibration.txt',
          content: Buffer.from(secretBody, 'utf-8').toString('base64'),
          is_base64: true,
          approved_summary: 'Brightwave telemetry calibration schedule and owner notice.',
          override_metadata: {
            document_id: 'TST-551',
            title: 'Brightwave Telemetry Calibration Note',
            document_type: 'runbook',
            tenant_id: 'ten_brightwave',
            owner_team: 'engineering',
            allowed_groups: ['grp_engineering'],
            sensitivity: 'internal',
            disclosure_policy: 'internal_only',
          },
        },
      });

      assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.rawText}`);
      assert.strictEqual(res.body?.data?.ingestion?.document_id, 'TST-551');
      assert.strictEqual(res.body?.data?.detail?.document?.sensitivity, 'internal');
      assert.strictEqual(res.body?.data?.detail?.document?.disclosure_policy, 'internal_only');
      assert.strictEqual(
        res.body?.data?.detail?.approved_summary?.summary_text,
        'Brightwave telemetry calibration schedule and owner notice.'
      );

      // Verify audit log recorded without raw file body
      const auditRes = await query<{ action: string; metadata: any }>(
        `SELECT action, metadata FROM audit_logs WHERE target_id = 'TST-551' AND action = 'admin.document.uploaded'`
      );
      assert.strictEqual(auditRes.rows.length, 1);
      assert.ok(!JSON.stringify(auditRes.rows[0].metadata).includes('UNIQUE_RAW_TOKEN_551'));
    });

    await test('7. Admin legacy /api/documents/ingest upload works for .md files and writes audit log', async () => {
      const mdContent = [
        '---',
        'document_id: TST-552',
        'title: Admin Direct Markdown Ingest Test',
        'document_type: product_doc',
        'tenant_id: global',
        'owner_team: customer_support',
        'allowed_groups: ["grp_support"]',
        'sensitivity: internal',
        'disclosure_policy: internal_only',
        '---',
        '',
        'Platform direct markdown ingest test verification line.',
      ].join('\n');

      const res = await requestJson('/api/documents/ingest', {
        method: 'POST',
        token: rafaelToken,
        body: { filename: 'tst-552.md', content: mdContent },
      });

      assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}: ${res.rawText}`);
      assert.strictEqual(res.body?.data?.document_id, 'TST-552');

      const auditRes = await query(
        `SELECT id FROM audit_logs WHERE target_id = 'TST-552' AND action = 'admin.document.uploaded'`
      );
      assert.strictEqual(auditRes.rows.length, 1);
    });

    await test('8. Initial retrieval & preview enforce uploaded internal_only engineering ACL', async () => {
      // Daniel (emp_006, Brightwave engineering) can inspect and retrieve
      const danielDoc = await requestJson('/api/documents/TST-551', { token: danielToken });
      assert.strictEqual(danielDoc.status, 200);

      const danielVec = await retrievalService.retrieveChunks({
        query: 'UNIQUE_RAW_TOKEN_551 Brightwave telemetry calibration',
        user: daniel,
        top_k: 5,
      });
      assert.ok(
        danielVec.chunks.some((c) => c.document_id === 'TST-551'),
        'Daniel should retrieve TST-551 via vector search'
      );

      const danielFts = await fullTextSearchService.searchChunks({
        query: 'UNIQUE_RAW_TOKEN_551',
        user: daniel,
        top_k: 5,
      });
      assert.ok(
        danielFts.chunks.some((c) => c.document_id === 'TST-551'),
        'Daniel should retrieve TST-551 via full-text search'
      );

      // Hannah (cu_001, Brightwave customer) is strictly denied
      const hannahDoc = await requestJson('/api/documents/TST-551', { token: hannahToken });
      assert.strictEqual(hannahDoc.status, 404);

      const hannahVec = await retrievalService.retrieveChunks({
        query: 'UNIQUE_RAW_TOKEN_551 Brightwave telemetry calibration',
        user: hannah,
        top_k: 5,
      });
      assert.strictEqual(
        hannahVec.chunks.some((c) => c.document_id === 'TST-551'),
        false,
        'Hannah must NOT retrieve internal engineering TST-551'
      );

      const hannahFts = await fullTextSearchService.searchChunks({
        query: 'UNIQUE_RAW_TOKEN_551',
        user: hannah,
        top_k: 5,
      });
      assert.strictEqual(
        hannahFts.chunks.some((c) => c.document_id === 'TST-551'),
        false,
        'Hannah must NOT hit TST-551 via FTS'
      );
    });

    await test('9. Admin permission change to customer_shareable immediately grants Brightwave customer access while isolating foreign tenant', async () => {
      const patchRes = await requestJson('/api/admin/documents/TST-551/permissions', {
        method: 'PATCH',
        token: rafaelToken,
        body: {
          sensitivity: 'public',
          disclosure_policy: 'customer_shareable',
          allowed_groups: ['cust_ten_brightwave_users', 'grp_public'],
        },
      });

      assert.strictEqual(patchRes.status, 200, `Expected 200, got ${patchRes.status}: ${patchRes.rawText}`);
      assert.strictEqual(patchRes.body?.data?.document?.sensitivity, 'public');
      assert.strictEqual(patchRes.body?.data?.document?.disclosure_policy, 'customer_shareable');

      // Hannah (ten_brightwave customer) now gets immediate access across REST + vector + FTS
      const hannahDoc = await requestJson('/api/documents/TST-551', { token: hannahToken });
      assert.strictEqual(hannahDoc.status, 200);

      const hannahVec = await retrievalService.retrieveChunks({
        query: 'UNIQUE_RAW_TOKEN_551 Brightwave telemetry calibration',
        user: hannah,
        top_k: 5,
      });
      assert.ok(
        hannahVec.chunks.some((c) => c.document_id === 'TST-551'),
        'Hannah should immediately retrieve updated customer_shareable TST-551'
      );

      const hannahFts = await fullTextSearchService.searchChunks({
        query: 'UNIQUE_RAW_TOKEN_551',
        user: hannah,
        top_k: 5,
      });
      assert.ok(
        hannahFts.chunks.some((c) => c.document_id === 'TST-551'),
        'Hannah should immediately hit updated customer_shareable TST-551 via FTS'
      );

      // Leo (cu_002, ten_harborpine customer) MUST still remain isolated
      const leoDoc = await requestJson('/api/documents/TST-551', { token: leoToken });
      assert.strictEqual(leoDoc.status, 404);

      const leoVec = await retrievalService.retrieveChunks({
        query: 'UNIQUE_RAW_TOKEN_551 Brightwave telemetry calibration',
        user: leo,
        top_k: 5,
      });
      assert.strictEqual(
        leoVec.chunks.some((c) => c.document_id === 'TST-551'),
        false,
        'Foreign tenant customer Leo must remain blocked'
      );
    });

    await test('10. Effective access preview & document detail reflect real authorization decisions and audit history', async () => {
      const detailRes = await requestJson('/api/admin/documents/TST-551', { token: rafaelToken });
      assert.strictEqual(detailRes.status, 200);

      const detail = detailRes.body?.data;
      assert.ok(Array.isArray(detail.versions) && detail.versions.length >= 1);
      assert.ok(Array.isArray(detail.audit_history) && detail.audit_history.length >= 2);
      assert.ok(
        detail.audit_history.some((a: any) => a.action === 'admin.document.permissions_updated')
      );

      const hannahEntry = detail.effective_access.users.find((u: any) => u.user_id === 'cu_001');
      const leoEntry = detail.effective_access.users.find((u: any) => u.user_id === 'cu_002');
      assert.strictEqual(hannahEntry?.allowed, true);
      assert.strictEqual(leoEntry?.allowed, false);
    });

    await test('11. Archiving document immediately excludes it from listing, preview, vector search, and FTS; restoring re-enables it', async () => {
      const archiveRes = await requestJson('/api/admin/documents/TST-551/archive', {
        method: 'POST',
        token: rafaelToken,
        body: { is_active: false },
      });
      assert.strictEqual(archiveRes.status, 200);
      assert.strictEqual(archiveRes.body?.data?.document?.is_active, false);

      // Both Hannah and Daniel are immediately blocked once archived
      const hannahDoc = await requestJson('/api/documents/TST-551', { token: hannahToken });
      assert.strictEqual(hannahDoc.status, 404);
      const danielDoc = await requestJson('/api/documents/TST-551', { token: danielToken });
      assert.strictEqual(danielDoc.status, 404);

      const hannahList = await requestJson('/api/documents', { token: hannahToken });
      assert.strictEqual(hannahList.status, 200);
      assert.ok(Array.isArray(hannahList.body?.data));
      assert.strictEqual(
        hannahList.body.data.some((d: any) => d.document_id === 'TST-551'),
        false
      );

      const hannahVec = await retrievalService.retrieveChunks({
        query: 'UNIQUE_RAW_TOKEN_551 Brightwave telemetry calibration',
        user: hannah,
        top_k: 5,
      });
      assert.strictEqual(hannahVec.chunks.some((c) => c.document_id === 'TST-551'), false);

      const danielFts = await fullTextSearchService.searchChunks({
        query: 'UNIQUE_RAW_TOKEN_551',
        user: daniel,
        top_k: 5,
      });
      assert.strictEqual(danielFts.chunks.some((c) => c.document_id === 'TST-551'), false);

      // Restore document and verify access returns
      const restoreRes = await requestJson('/api/admin/documents/TST-551/archive', {
        method: 'POST',
        token: rafaelToken,
        body: { is_active: true },
      });
      assert.strictEqual(restoreRes.status, 200);
      assert.strictEqual(restoreRes.body?.data?.document?.is_active, true);

      const hannahRestored = await requestJson('/api/documents/TST-551', { token: hannahToken });
      assert.strictEqual(hannahRestored.status, 200);
    });

    await test('12. Admin document listing supports tenant & sensitivity filtering without returning raw chunks', async () => {
      const filteredRes = await requestJson(
        '/api/admin/documents?tenant=ten_brightwave&sensitivity=public&search=TST-551',
        { token: rafaelToken }
      );
      assert.strictEqual(filteredRes.status, 200);
      const docs = filteredRes.body?.data?.documents || [];
      assert.ok(docs.some((d: any) => d.document_id === 'TST-551'));
      assert.ok(!filteredRes.rawText.includes('UNIQUE_RAW_TOKEN_551'));
    });
  } finally {
    await cleanupTestDocuments();
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

runAdminDocumentsWorkflowTests().catch((err) => {
  console.error('Fatal error running Subphase 5.5 document workflow tests:', err);
  process.exit(1);
});
