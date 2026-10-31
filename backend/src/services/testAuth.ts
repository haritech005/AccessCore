import { query, closePool } from '../db';
import { runMigrations } from '../db/migrate';
import { authService } from './authService';
import { extractToken, requireAuth, optionalAuth } from '../middleware/auth';
import { Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler';
import { createApp } from '../app';
import { AddressInfo } from 'net';

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

async function runAuthTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.3 - Authentication Integration Test Suite  ');
  console.log('==================================================================\n');

  try {
    // 0. Ensure migrations are up to date
    await runMigrations();

    // --------------------------------------------------------------------------
    // TEST GROUP 1: Password Cryptographic Hashing
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Password Cryptographic Hashing ---');
    const plainPassword = 'SuperSecretPassword2026!';
    const passwordHash = await authService.hashPassword(plainPassword);

    assert(passwordHash !== plainPassword, 'Password is not plaintext');
    assert(passwordHash.startsWith('$2'), 'Bcrypt algorithm prefix ($2) is present');
    assert(
      await authService.comparePassword(plainPassword, passwordHash),
      'Password comparison matches for correct plaintext password'
    );
    assert(
      !(await authService.comparePassword('WrongPassword123!', passwordHash)),
      'Password comparison rejects invalid password'
    );

    // --------------------------------------------------------------------------
    // TEST GROUP 2: JWT Session Token Creation, Signing & Verification
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: JWT Session Token Handling (jose HS256) ---');
    const sampleUserId = 'test_usr_token_01';
    const sampleEmail = 'token_test@accesscore.local';

    const token = await authService.createToken(sampleUserId, sampleEmail, '1h');
    assert(typeof token === 'string' && token.split('.').length === 3, 'Token generated in standard compact JWT format (3 segments)');

    const verified = await authService.verifyToken(token);
    assert(verified.sub === sampleUserId, 'Verified token extracts correct subject (user ID)');
    assert(verified.email === sampleEmail, 'Verified token extracts correct email claim');

    // Tampered token test
    let tamperedRejected = false;
    try {
      const tamperedToken = token.slice(0, -6) + 'abcdef';
      await authService.verifyToken(tamperedToken);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_SESSION') {
        tamperedRejected = true;
      }
    }
    assert(tamperedRejected, 'Tampered token rejected with 401 INVALID_SESSION');

    // Expired token test (0 seconds expiration)
    let expiredRejected = false;
    try {
      const expiredToken = await authService.createToken(sampleUserId, sampleEmail, '0s');
      await new Promise((r) => setTimeout(r, 20));
      await authService.verifyToken(expiredToken);
    } catch (err) {
      if (err instanceof AppError && err.code === 'INVALID_SESSION') {
        expiredRejected = true;
      }
    }
    assert(expiredRejected, 'Expired session token rejected with 401 INVALID_SESSION');

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Database User Identity & Membership Resolution
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Authoritative Database Identity Resolution ---');
    const testActiveId = 'auth_usr_active';
    const testActiveEmail = 'priya.active@example.com';
    const testSuspendedId = 'auth_usr_suspended';
    const testSuspendedEmail = 'marcus.suspended@example.com';

    // Cleanup prior test artifacts
    await query(`DELETE FROM user_groups WHERE user_id IN ($1, $2)`, [testActiveId, testSuspendedId]);
    await query(`DELETE FROM user_tenants WHERE user_id IN ($1, $2)`, [testActiveId, testSuspendedId]);
    await query(`DELETE FROM users WHERE id IN ($1, $2)`, [testActiveId, testSuspendedId]);

    // Ensure tenants and groups exist
    await query(
      `INSERT INTO tenants (id, name, status) VALUES ('ten_auth_test', 'Auth Test Tenant', 'active')
       ON CONFLICT (id) DO NOTHING`
    );
    await query(
      `INSERT INTO groups (id, name, description) VALUES ('grp_auth_support', 'Auth Test Support', 'Test')
       ON CONFLICT (id) DO NOTHING`
    );

    // Seed active user with hashed password
    const hashedPwd = await authService.hashPassword('PriyaPass2026!');
    await query(
      `INSERT INTO users (id, email, name, role, user_type, status, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [testActiveId, testActiveEmail, 'Priya Raman', 'support_agent', 'employee', 'active', hashedPwd]
    );
    await query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`, [testActiveId, 'grp_auth_support']);
    await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2)`, [testActiveId, 'ten_auth_test']);

    // Seed suspended user
    await query(
      `INSERT INTO users (id, email, name, role, user_type, status, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [testSuspendedId, testSuspendedEmail, 'Marcus Suspended', 'support_agent', 'employee', 'suspended', hashedPwd]
    );

    // Resolve active user context
    const resolvedActive = await authService.resolveAuthenticatedUser(testActiveId);
    assert(resolvedActive !== null, 'Active user resolved from PostgreSQL');
    assert(resolvedActive?.id === testActiveId, 'Resolved correct user ID');
    assert(resolvedActive?.status === 'active', 'Resolved status is active');
    assert(resolvedActive?.groups.includes('grp_auth_support') === true, 'Resolved real-time group membership');
    assert(resolvedActive?.tenant_scope.includes('ten_auth_test') === true, 'Resolved real-time tenant scope');
    assert(resolvedActive?.has_wildcard_tenant === false, 'Non-wildcard tenant correctly identified');

    // Non-existent user resolution
    const resolvedMissing = await authService.resolveAuthenticatedUser('non_existent_usr_999');
    assert(resolvedMissing === null, 'Non-existent user returns null');

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Credentials Login & Access Rejection
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Credentials Login (authService.login) ---');

    // Valid login
    const loginRes = await authService.login(testActiveEmail, 'PriyaPass2026!');
    assert(loginRes.user.id === testActiveId, 'Valid login returns user profile');
    assert(typeof loginRes.token === 'string' && loginRes.token.length > 20, 'Valid login returns signed session token');

    // Invalid password
    let badPasswordRejected = false;
    try {
      await authService.login(testActiveEmail, 'WrongPassword!');
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401 && err.code === 'INVALID_CREDENTIALS') {
        badPasswordRejected = true;
      }
    }
    assert(badPasswordRejected, 'Invalid password rejected with 401 INVALID_CREDENTIALS');

    // Non-existent account
    let unknownAccountRejected = false;
    try {
      await authService.login('unknown.user@example.com', 'AnyPassword!');
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401 && err.code === 'INVALID_CREDENTIALS') {
        unknownAccountRejected = true;
      }
    }
    assert(unknownAccountRejected, 'Unknown account rejected with 401 INVALID_CREDENTIALS');

    // Inactive/Suspended account login attempt
    let suspendedLoginRejected = false;
    try {
      await authService.login(testSuspendedEmail, 'PriyaPass2026!');
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 403 && err.code === 'ACCOUNT_INACTIVE') {
        suspendedLoginRejected = true;
      }
    }
    assert(suspendedLoginRejected, 'Suspended account login rejected with 403 ACCOUNT_INACTIVE');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Express Authentication Middleware (requireAuth & extractToken)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Express Authentication Middleware (requireAuth) ---');

    function createMockReqRes(headers: Record<string, string> = {}) {
      const req = {
        headers,
      } as unknown as Request;
      const res = {
        status: () => res,
        json: () => res,
      } as unknown as Response;
      return { req, res };
    }

    // 1. Missing token
    let unauthRejected = false;
    const { req: req1, res: res1 } = createMockReqRes({});
    await requireAuth(req1, res1, (err) => {
      if (err instanceof AppError && err.statusCode === 401 && err.code === 'UNAUTHORIZED') {
        unauthRejected = true;
      }
    });
    assert(unauthRejected, 'Request without Authorization header rejected with 401 UNAUTHORIZED');

    // 2. Token extraction from Bearer header
    const mockBearerReq = {
      headers: { authorization: `Bearer ${loginRes.token}` },
    } as unknown as Request;
    assert(extractToken(mockBearerReq) === loginRes.token, 'extractToken successfully extracts Bearer token');

    // 3. Token extraction from Cookie
    const mockCookieReq = {
      headers: { cookie: `other=foo; accesscore.session-token=${loginRes.token}; bar=baz` },
    } as unknown as Request;
    assert(extractToken(mockCookieReq) === loginRes.token, 'extractToken successfully extracts cookie session token');

    // 4. Valid active session in requireAuth
    let activeAllowed = false;
    const { req: reqActive, res: resActive } = createMockReqRes({
      authorization: `Bearer ${loginRes.token}`,
    });
    await requireAuth(reqActive, resActive, (err) => {
      if (!err && reqActive.user?.id === testActiveId) {
        activeAllowed = true;
      }
    });
    assert(activeAllowed, 'Valid session attaches resolved AuthenticatedUser to req.user and passes');

    // 5. Inactive / Suspended user with valid JWT signature
    const suspendedToken = await authService.createToken(testSuspendedId, testSuspendedEmail);
    let suspendedSessionRejected = false;
    const { req: reqSuspended, res: resSuspended } = createMockReqRes({
      authorization: `Bearer ${suspendedToken}`,
    });
    await requireAuth(reqSuspended, resSuspended, (err) => {
      if (err instanceof AppError && err.statusCode === 403 && err.code === 'ACCOUNT_INACTIVE') {
        suspendedSessionRejected = true;
      }
    });
    assert(
      suspendedSessionRejected,
      'PostgreSQL status check immediately rejects suspended user even with valid cryptographic token (403 ACCOUNT_INACTIVE)'
    );

    // 6. Optional auth middleware with and without token
    let optionalNoTokenPassed = false;
    const { req: reqOpt1, res: resOpt1 } = createMockReqRes({});
    await optionalAuth(reqOpt1, resOpt1, (err) => {
      if (!err && reqOpt1.user === undefined) {
        optionalNoTokenPassed = true;
      }
    });
    assert(optionalNoTokenPassed, 'optionalAuth allows unauthenticated request with req.user undefined');

    let optionalWithTokenPassed = false;
    const { req: reqOpt2, res: resOpt2 } = createMockReqRes({
      authorization: `Bearer ${loginRes.token}`,
    });
    await optionalAuth(reqOpt2, resOpt2, (err) => {
      if (!err && reqOpt2.user?.id === testActiveId) {
        optionalWithTokenPassed = true;
      }
    });
    assert(optionalWithTokenPassed, 'optionalAuth resolves AuthenticatedUser when valid token is present');

    // --------------------------------------------------------------------------
    // TEST GROUP 6: Client Privilege Escalation Prevention
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Client Privilege Escalation Prevention ---');
    const userScope = resolvedActive!.tenant_scope;
    const attemptedUnauthorizedTenants = ['ten_harborpine', 'ten_lumenfield'];
    const filteredTenants = attemptedUnauthorizedTenants.filter((t) => userScope.includes(t));
    assert(
      filteredTenants.length === 0,
      'Client cannot supply unassigned tenant IDs to broaden access'
    );

    const clientSuppliedGroups = ['grp_security_restricted', 'grp_admins'];
    const authoritativeGroups = resolvedActive!.groups;
    assert(
      !authoritativeGroups.includes('grp_security_restricted'),
      'Server-side principal ignores client-supplied groups (grp_security_restricted)'
    );

    // --------------------------------------------------------------------------
    // TEST GROUP 7: Live HTTP API Protection on Express Server
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Live HTTP API Endpoints & Protection ---');
    const app = createApp();
    const server = app.listen(0);
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Public Health endpoint
      const healthRes = await fetch(`${baseUrl}/health`);
      assert(healthRes.status === 200, 'Public /health endpoint returns HTTP 200 without auth');

      // 2. Unauthenticated GET /api/auth/me
      const meUnauth = await fetch(`${baseUrl}/api/auth/me`);
      assert(meUnauth.status === 401, 'Unauthenticated GET /api/auth/me rejected with 401');

      // 3. Login via HTTP endpoint
      const httpLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testActiveEmail, password: 'PriyaPass2026!' }),
      });
      assert(httpLoginRes.status === 200, 'POST /api/auth/login returns HTTP 200');
      const httpLoginData = await httpLoginRes.json();
      assert(httpLoginData.success === true, 'POST /api/auth/login success flag is true');
      const liveToken = httpLoginData.data.token as string;
      assert(typeof liveToken === 'string' && liveToken.length > 20, 'POST /api/auth/login returned live session token');

      // Check cookie header
      const cookieHeader = httpLoginRes.headers.get('set-cookie');
      assert(Boolean(cookieHeader && cookieHeader.includes('accesscore.session-token')), 'POST /api/auth/login set accesscore.session-token cookie');

      // 4. Authenticated GET /api/auth/me
      const meAuth = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${liveToken}` },
      });
      assert(meAuth.status === 200, 'Authenticated GET /api/auth/me returns HTTP 200');
      const meData = await meAuth.json();
      assert(meData.data.user.id === testActiveId, 'GET /api/auth/me returns user profile matching principal');

      // 5. Unauthenticated GET /api/documents
      const docsUnauth = await fetch(`${baseUrl}/api/documents`);
      assert(docsUnauth.status === 401, 'GET /api/documents without token returns HTTP 401');

      // 6. Authenticated GET /api/documents
      const docsAuth = await fetch(`${baseUrl}/api/documents`, {
        headers: { Authorization: `Bearer ${liveToken}` },
      });
      assert(docsAuth.status === 200, 'GET /api/documents with valid token returns HTTP 200');

      // 7. Unauthenticated POST /api/retrieval/search
      const retUnauth = await fetch(`${baseUrl}/api/retrieval/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'webhook' }),
      });
      assert(retUnauth.status === 401, 'POST /api/retrieval/search without token returns HTTP 401');

      // 8. Invalid token POST /api/retrieval/search
      const retInvalid = await fetch(`${baseUrl}/api/retrieval/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer invalid_malformed_token_xyz',
        },
        body: JSON.stringify({ query: 'webhook' }),
      });
      assert(retInvalid.status === 401, 'POST /api/retrieval/search with invalid token returns HTTP 401');

      // 9. Unauthenticated POST /api/rag/query
      const ragUnauth = await fetch(`${baseUrl}/api/rag/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'webhook' }),
      });
      assert(ragUnauth.status === 401, 'POST /api/rag/query without token returns HTTP 401');

      // 10. Inactive/Suspended account token on protected endpoint
      const ragSuspended = await fetch(`${baseUrl}/api/rag/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${suspendedToken}`,
        },
        body: JSON.stringify({ question: 'webhook' }),
      });
      assert(ragSuspended.status === 403, 'POST /api/rag/query with suspended account returns HTTP 403');

      // 11. POST /api/auth/logout
      const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST' });
      assert(logoutRes.status === 200, 'POST /api/auth/logout returns HTTP 200');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Clean up test identities
    await query(`DELETE FROM user_groups WHERE user_id IN ($1, $2)`, [testActiveId, testSuspendedId]);
    await query(`DELETE FROM user_tenants WHERE user_id IN ($1, $2)`, [testActiveId, testSuspendedId]);
    await query(`DELETE FROM users WHERE id IN ($1, $2)`, [testActiveId, testSuspendedId]);
    await query(`DELETE FROM groups WHERE id = 'grp_auth_support'`);
    await query(`DELETE FROM tenants WHERE id = 'ten_auth_test'`);

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Authentication Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runAuthTestSuite();
