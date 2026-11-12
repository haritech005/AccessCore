import assert from 'assert';
import http from 'http';
import { SignJWT } from 'jose';
import { createApp } from '../app';
import { config } from '../config';
import { closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';
import { authorizationService } from './authorizationService';
import { AuthenticatedUser } from '../types/identity';

async function runAdminFoundationTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.3 — Admin Foundation & Access Enforcement  ');
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

  // Resolve real users from PostgreSQL
  const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!; // it_security_admin
  const priya = (await authService.resolveAuthenticatedUser('emp_001'))!; // support_agent
  const meiLin = (await authService.resolveAuthenticatedUser('emp_007'))!; // engineering_manager
  const hannah = (await authService.resolveAuthenticatedUser('cu_001'))!; // customer_user
  const suspended = (await authService.resolveAuthenticatedUser('emp_099'))!; // suspended

  // Issue real session tokens
  const rafaelToken = await authService.createToken(rafael.id, rafael.email);
  const priyaToken = await authService.createToken(priya.id, priya.email);
  const meiLinToken = await authService.createToken(meiLin.id, meiLin.email);
  const hannahToken = await authService.createToken(hannah.id, hannah.email);
  const suspendedToken = await authService.createToken(suspended.id, suspended.email);

  // Spin up Express app on an ephemeral port
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    console.log('--- TEST GROUP 1: Central Admin Policy Rules ---');

    await test('IT Security Admin (emp_008) passes authorizationService.isAdmin', () => {
      assert.strictEqual(authorizationService.isAdmin(rafael), true);
      assert.strictEqual(authorizationService.authorizeAdminAccess(rafael).allowed, true);
    });

    await test('Generic active employee with role "admin" passes isAdmin', () => {
      const syntheticAdmin: AuthenticatedUser = {
        ...priya,
        role: 'admin',
      };
      assert.strictEqual(authorizationService.isAdmin(syntheticAdmin), true);
    });

    await test('Normal support agent (emp_001) is denied admin access', () => {
      assert.strictEqual(authorizationService.isAdmin(priya), false);
      const res = authorizationService.authorizeAdminAccess(priya);
      assert.strictEqual(res.allowed, false);
    });

    await test('Engineering Manager with restricted clearance (emp_007) is denied admin access', () => {
      assert.strictEqual(authorizationService.isAdmin(meiLin), false);
    });

    await test('Customer user (cu_001) is denied admin access even if role tampered in object', () => {
      const tamperedCustomer: AuthenticatedUser = {
        ...hannah,
        role: 'admin',
      };
      assert.strictEqual(authorizationService.isAdmin(tamperedCustomer), false);
    });

    await test('Suspended user is denied admin access even if assigned admin role', () => {
      const suspendedAdmin: AuthenticatedUser = {
        ...rafael,
        status: 'suspended',
      };
      assert.strictEqual(authorizationService.isAdmin(suspendedAdmin), false);
    });

    console.log('\n--- TEST GROUP 2: HTTP Unauthenticated & Non-Admin Enforcement ---');

    await test('Unauthenticated GET /api/admin/overview returns HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`);
      assert.strictEqual(res.status, 401);
      const body = await res.json();
      assert.strictEqual(body.success, false);
    });

    await test('Unauthenticated GET /api/admin/access-check returns HTTP 401', async () => {
      const res = await fetch(`${baseUrl}/api/admin/access-check`);
      assert.strictEqual(res.status, 401);
    });

    await test('Unauthenticated probe to unknown /api/admin/secret returns HTTP 401 (no 404 leak)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/secret-route`);
      assert.strictEqual(res.status, 401);
    });

    await test('Customer user (cu_001) calling GET /api/admin/overview returns HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${hannahToken}` },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error?.code, 'ADMIN_FORBIDDEN');
    });

    await test('Normal employee (emp_001) calling GET /api/admin/overview returns HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${priyaToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    await test('Engineering Manager (emp_007) calling GET /api/admin/access-check returns HTTP 403', async () => {
      const res = await fetch(`${baseUrl}/api/admin/access-check`, {
        headers: { Authorization: `Bearer ${meiLinToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    await test('Suspended user (emp_099) with signed token returns HTTP 403 ACCOUNT_INACTIVE', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${suspendedToken}` },
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error?.code, 'ACCOUNT_INACTIVE');
    });

    console.log('\n--- TEST GROUP 3: Token Tampering & Privilege Escalation Defense ---');

    await test('JWT with injected role="admin" claim for emp_001 still blocked with 403 via DB lookup', async () => {
      const secret = new TextEncoder().encode(config.AUTH_SECRET);
      const escalatedToken = await new SignJWT({
        sub: 'emp_001',
        email: priya.email,
        role: 'admin',
        isAdmin: true,
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(secret);

      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${escalatedToken}` },
      });
      assert.strictEqual(res.status, 403);
    });

    await test('JWT signed with invalid secret rejected with HTTP 401', async () => {
      const wrongSecret = new TextEncoder().encode('attacker-wrong-secret-key-32-chars-long!');
      const forgedToken = await new SignJWT({
        sub: 'emp_008',
        email: rafael.email,
      })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(wrongSecret);

      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      assert.strictEqual(res.status, 401);
    });

    console.log('\n--- TEST GROUP 4: Authorized Admin Access & CSRF Protection ---');

    await test('Authorized admin (emp_008) passes GET /api/admin/access-check with HTTP 200', async () => {
      const res = await fetch(`${baseUrl}/api/admin/access-check`, {
        headers: { Authorization: `Bearer ${rafaelToken}` },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.data.authorized, true);
      assert.strictEqual(body.data.admin.role, 'it_security_admin');
    });

    await test('Authorized admin (emp_008) retrieves live overview stats without password leaks', async () => {
      const res = await fetch(`${baseUrl}/api/admin/overview`, {
        headers: { Authorization: `Bearer ${rafaelToken}` },
      });
      assert.strictEqual(res.status, 200);
      const rawText = await res.text();
      assert(!rawText.includes('password_hash'), 'Response must never contain password_hash');

      const body = JSON.parse(rawText);
      assert.strictEqual(body.success, true);
      assert(body.data.metrics.users.total >= 12, 'Should count seeded users');
      assert(body.data.metrics.users.admins >= 1, 'Should count active admins');
      assert(body.data.metrics.groups >= 10, 'Should count seeded groups');
      assert(body.data.metrics.tenants >= 4, 'Should count seeded tenants');
    });

    await test('Cookie-authenticated admin POST from untrusted Origin blocked with 403 CSRF_FORBIDDEN', async () => {
      const res = await fetch(`${baseUrl}/api/admin/test-csrf-endpoint`, {
        method: 'POST',
        headers: {
          Cookie: `accesscore.session-token=${rafaelToken}`,
          Origin: 'https://evil-attacker.example.com',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mutate' }),
      });
      assert.strictEqual(res.status, 403);
      const body = await res.json();
      assert.strictEqual(body.error?.code, 'CSRF_FORBIDDEN');
    });

    await test('Cookie-authenticated admin POST from trusted Origin passes CSRF check (reaches 404)', async () => {
      const res = await fetch(`${baseUrl}/api/admin/test-csrf-endpoint`, {
        method: 'POST',
        headers: {
          Cookie: `accesscore.session-token=${rafaelToken}`,
          Origin: 'http://localhost:3000',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'mutate' }),
      });
      assert.strictEqual(res.status, 404);
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }

  console.log('\n==================================================================');
  console.log(` RESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests`);
  console.log('==================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} admin foundation test(s) failed.`);
  }
}

runAdminFoundationTests().catch((err) => {
  console.error('[Admin Foundation Tests] Fatal error:', err);
  process.exit(1);
});

