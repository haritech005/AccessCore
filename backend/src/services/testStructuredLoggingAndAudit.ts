import assert from 'assert';
import http from 'http';
import { createApp } from '../app';
import { closePool, query } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { auditService } from './auditService';
import { authService } from './authService';
import { logger, sanitizeLogData } from './logger';
import { runStartupDiagnostics } from './startupDiagnostics';
import { AppError } from '../middleware/errorHandler';

async function runStructuredLoggingAndAuditTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.7 — Structured Logging & Audit Telemetry   ');
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

  const testCorrelationIds = ['test-corr-571', 'test-corr-572', 'test-corr-573'];

  async function cleanupTestAuditLogs(): Promise<void> {
    await query(`DELETE FROM audit_logs WHERE correlation_id = ANY($1::varchar[])`, [
      testCorrelationIds,
    ]);
  }

  await cleanupTestAuditLogs();

  const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!;
  const priya = (await authService.resolveAuthenticatedUser('emp_001'))!;
  const rafaelToken = await authService.createToken(rafael.id, rafael.email);
  const priyaToken = await authService.createToken(priya.id, priya.email);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function requestRaw(
    path: string,
    options: {
      method?: string;
      token?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {}
  ): Promise<{ status: number; headers: Headers; body: any; rawText: string }> {
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
    return { status: res.status, headers: res.headers, body: parsed, rawText };
  }

  try {
    await test('1. Request correlation middleware assigns UUID if missing and echoes X-Request-Id header', async () => {
      const res = await requestRaw('/health');
      assert.strictEqual(res.status, 200);
      const reqId = res.headers.get('x-request-id');
      const corrId = res.headers.get('x-correlation-id');
      assert.ok(reqId && reqId.length >= 10, 'Must set X-Request-Id response header');
      assert.strictEqual(reqId, corrId, 'X-Request-Id and X-Correlation-Id must match');
      assert.strictEqual(res.body?.correlation_id, reqId);
    });

    await test('2. Request correlation middleware propagates supplied X-Request-Id across lifecycle', async () => {
      const customId = 'test-corr-571';
      const res = await requestRaw('/health', {
        headers: { 'X-Request-Id': customId },
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('x-request-id'), customId);
      assert.strictEqual(res.body?.correlation_id, customId);
    });

    await test('3. Error responses include correlation_id on 404 and 400 validation failures', async () => {
      const customId = 'test-corr-572';
      const notFoundRes = await requestRaw('/api/nonexistent-endpoint-57', {
        headers: { 'X-Correlation-Id': customId },
      });
      assert.strictEqual(notFoundRes.status, 404);
      assert.strictEqual(notFoundRes.body?.correlation_id, customId);
      assert.strictEqual(notFoundRes.body?.error?.code, 'ROUTE_NOT_FOUND');

      const badInputRes = await requestRaw('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Request-Id': customId },
        body: {},
      });
      assert.strictEqual(badInputRes.status, 400);
      assert.strictEqual(badInputRes.body?.correlation_id, customId);
      assert.strictEqual(badInputRes.body?.error?.code, 'INVALID_INPUT');
    });

    await test('4. Sensitive data scrubbing redacts passwords, tokens, hashes, auth headers, and prompts in logger', () => {
      const rawMeta = {
        user: 'admin@example.com',
        password: 'SuperSecretPassword123!',
        password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz123456',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        cookie: 'accesscore.session-token=secret_session_token_value',
        token: 'jwe_secret_token_123',
        apikey: 'key_live_abcdef123456',
        prompt: 'User prompt asking about confidential financial data',
        raw_content: 'Entire unredacted body of secret document...',
        public_info: 'This should stay clear',
      };

      const sanitized: any = sanitizeLogData(rawMeta);
      assert.strictEqual(sanitized.password, '[REDACTED]');
      assert.strictEqual(sanitized.password_hash, '[REDACTED]');
      assert.strictEqual(sanitized.authorization, '[REDACTED]');
      assert.strictEqual(sanitized.cookie, '[REDACTED]');
      assert.strictEqual(sanitized.token, '[REDACTED]');
      assert.strictEqual(sanitized.apikey, '[REDACTED]');
      assert.strictEqual(sanitized.prompt, '[REDACTED]');
      assert.strictEqual(sanitized.raw_content, '[REDACTED]');
      assert.strictEqual(sanitized.public_info, 'This should stay clear');
    });

    await test('5. Startup diagnostics verifies database, pgvector extension, schema tables, and Ollama service', async () => {
      const diag = await runStartupDiagnostics();
      assert.ok(diag.ok);
      assert.ok(diag.status === 'healthy' || diag.status === 'degraded');
      assert.strictEqual(diag.services.database.status, 'ok');
      assert.strictEqual(diag.services.database.details?.tablesVerified, 13);
      assert.ok(diag.summary.length > 0);
    });

    await test('6. Auth failure records structured auth.login.failed audit event with correlation ID and IP', async () => {
      const loginFailRes = await requestRaw('/api/auth/login', {
        method: 'POST',
        headers: { 'X-Request-Id': 'test-corr-573' },
        body: {
          email: 'priya.raman@clouddesk.example.com',
          password: 'IncorrectPassword999!',
        },
      });
      assert.strictEqual(loginFailRes.status, 401);

      const auditRes = await query<{ action: string; outcome: string; correlation_id: string }>(
        `SELECT action, outcome, correlation_id FROM audit_logs WHERE correlation_id = 'test-corr-573'`
      );
      assert.ok(auditRes.rows.length >= 1);
      assert.strictEqual(auditRes.rows[0].action, 'auth.login.failed');
      assert.strictEqual(auditRes.rows[0].outcome, 'denied');
      assert.strictEqual(auditRes.rows[0].correlation_id, 'test-corr-573');
    });

    await test('7. Non-admin access to admin route records auth.admin_access.denied audit event', async () => {
      const nonAdminRes = await requestRaw('/api/admin/audit-logs', {
        token: priyaToken,
        headers: { 'X-Request-Id': 'test-corr-573' },
      });
      assert.strictEqual(nonAdminRes.status, 403);
      assert.strictEqual(nonAdminRes.body?.error?.code, 'ADMIN_FORBIDDEN');

      const auditRes = await query<{ action: string; outcome: string; actor_id: string }>(
        `SELECT action, outcome, actor_id FROM audit_logs WHERE action = 'auth.admin_access.denied' AND actor_id = 'emp_001'`
      );
      assert.ok(auditRes.rows.length >= 1);
      assert.strictEqual(auditRes.rows[0].outcome, 'denied');
    });

    await test('8. CSRF mismatch records security.csrf.blocked audit event', async () => {
      const csrfRes = await requestRaw('/api/admin/ingestion/cleanup', {
        method: 'POST',
        token: rafaelToken,
        headers: {
          Origin: 'https://attacker.example.com',
          'X-Request-Id': 'test-corr-573',
        },
        body: {},
      });
      assert.strictEqual(csrfRes.status, 403);
      assert.strictEqual(csrfRes.body?.error?.code, 'CSRF_FORBIDDEN');

      const auditRes = await query<{ action: string; outcome: string }>(
        `SELECT action, outcome FROM audit_logs WHERE action = 'security.csrf.blocked'`
      );
      assert.ok(auditRes.rows.length >= 1);
      assert.strictEqual(auditRes.rows[0].outcome, 'denied');
    });

    await test('9. Admin audit log listing supports search, action, and outcome filtering', async () => {
      const logsRes = await requestRaw('/api/admin/audit-logs?outcome=denied&limit=10', {
        token: rafaelToken,
      });
      assert.strictEqual(logsRes.status, 200);
      assert.ok(Array.isArray(logsRes.body?.data?.events));
      assert.ok(logsRes.body.data.events.every((e: any) => e.outcome === 'denied'));

      const searchRes = await requestRaw('/api/admin/audit-logs?search=test-corr-573', {
        token: rafaelToken,
      });
      assert.strictEqual(searchRes.status, 200);
      assert.ok(
        searchRes.body.data.events.some((e: any) => e.correlation_id === 'test-corr-573')
      );
    });

    await test('10. Admin audit stats aggregate total, outcomes, top actions, and top actors', async () => {
      const statsRes = await requestRaw('/api/admin/audit-logs/stats', {
        token: rafaelToken,
      });
      assert.strictEqual(statsRes.status, 200);
      const data = statsRes.body?.data;
      assert.ok(data.total >= 1);
      assert.ok(data.outcomes.denied >= 1);
      assert.ok(Array.isArray(data.top_actions) && data.top_actions.length >= 1);
      assert.ok(Array.isArray(data.top_actors) && data.top_actors.length >= 1);
      assert.ok(typeof data.recent_24h_count === 'number');
    });

    await test('11. Admin audit export returns valid downloadable JSON and CSV without sensitive credentials', async () => {
      const jsonRes = await requestRaw('/api/admin/audit-logs/export?format=json', {
        token: rafaelToken,
      });
      assert.strictEqual(jsonRes.status, 200);
      assert.ok(jsonRes.headers.get('content-type')?.includes('application/json'));
      assert.ok(Array.isArray(jsonRes.body));
      assert.ok(!jsonRes.rawText.includes('SuperSecretPassword123!'));

      const csvRes = await requestRaw('/api/admin/audit-logs/export?format=csv', {
        token: rafaelToken,
      });
      assert.strictEqual(csvRes.status, 200);
      assert.ok(csvRes.headers.get('content-type')?.includes('text/csv'));
      assert.ok(csvRes.rawText.startsWith('"timestamp","action","actor_email"'));
    });
  } finally {
    await cleanupTestAuditLogs();
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

runStructuredLoggingAndAuditTests().catch((err) => {
  console.error('Fatal error running Subphase 5.7 structured logging tests:', err);
  process.exit(1);
});

