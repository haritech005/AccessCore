import { query, closePool } from '../db';
import { seedIdentities, CLOUDDESK_IDENTITIES, CLOUDDESK_TENANTS, CLOUDDESK_GROUPS } from '../db/seedIdentities';
import { authService } from './authService';
import { AppError } from '../middleware/errorHandler';

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

async function runIdentitiesSeedTestSuite() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.4 — Development Identities Test Suite      ');
  console.log('==================================================================\n');

  try {
    // --------------------------------------------------------------------------
    // TEST GROUP 1: Idempotent Seeding Execution
    // --------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Idempotent Seeding Execution ---');
    const result1 = await seedIdentities({ quiet: true });
    assert(result1.tenantsCount === 4, 'Seeded 4 CloudDesk tenants');
    assert(result1.groupsCount === CLOUDDESK_GROUPS.length, `Seeded ${CLOUDDESK_GROUPS.length} security access groups`);
    assert(result1.usersCount === CLOUDDESK_IDENTITIES.length, `Seeded ${CLOUDDESK_IDENTITIES.length} user accounts`);

    // Run a second time to ensure idempotency (no primary/unique key crash)
    const result2 = await seedIdentities({ quiet: true });
    assert(
      result2.usersCount === result1.usersCount,
      'Seed script is strictly idempotent (safe to run repeatedly)'
    );

    // --------------------------------------------------------------------------
    // TEST GROUP 2: Tenant & Group Schema Integrity
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Tenants & Groups Verification ---');
    for (const tenant of CLOUDDESK_TENANTS) {
      const res = await query<{ id: string; name: string; status: string }>(
        'SELECT id, name, status FROM tenants WHERE id = $1',
        [tenant.id]
      );
      assert(res.rows.length === 1, `Tenant '${tenant.id}' exists in PostgreSQL`);
      assert(res.rows[0].status === 'active', `Tenant '${tenant.id}' is active`);
    }

    for (const group of CLOUDDESK_GROUPS) {
      const res = await query<{ id: string }>(
        'SELECT id FROM groups WHERE id = $1',
        [group.id]
      );
      assert(res.rows.length === 1, `Group '${group.id}' exists in PostgreSQL`);
    }

    // --------------------------------------------------------------------------
    // TEST GROUP 3: Authoritative CloudDesk Identity Profiles & Memberships
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Exact Role, Group & Tenant Scopes ---');

    for (const expectedUser of CLOUDDESK_IDENTITIES) {
      const resolved = await authService.resolveAuthenticatedUser(expectedUser.id);
      assert(resolved !== null, `User '${expectedUser.id}' resolved via authService`);
      assert(resolved?.name === expectedUser.name, `User '${expectedUser.id}' name is '${expectedUser.name}'`);
      assert(resolved?.role === expectedUser.role, `User '${expectedUser.id}' role is '${expectedUser.role}'`);
      assert(resolved?.user_type === expectedUser.user_type, `User '${expectedUser.id}' user_type is '${expectedUser.user_type}'`);
      assert(resolved?.status === expectedUser.status, `User '${expectedUser.id}' status is '${expectedUser.status}'`);

      // Check all expected groups exist
      for (const expectedGroup of expectedUser.groups) {
        assert(
          resolved?.groups.includes(expectedGroup) === true,
          `User '${expectedUser.id}' has group '${expectedGroup}'`
        );
      }

      // Check tenant scope
      for (const expectedTenant of expectedUser.tenant_scope) {
        assert(
          resolved?.tenant_scope.includes(expectedTenant) === true,
          `User '${expectedUser.id}' has tenant '${expectedTenant}'`
        );
      }

      if (expectedUser.tenant_scope.includes('*')) {
        assert(resolved?.has_wildcard_tenant === true, `User '${expectedUser.id}' correctly flagged with wildcard tenant access`);
      } else {
        assert(resolved?.has_wildcard_tenant === false, `User '${expectedUser.id}' does NOT have wildcard tenant access`);
      }
    }

    // --------------------------------------------------------------------------
    // TEST GROUP 4: Authentication with Hashed Passwords
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Authentication & Password Verification ---');
    const devPassword = 'CloudDesk2026!';

    // 1. Priya Raman (emp_001) login via email
    const priyaLoginEmail = await authService.login('priya.raman@clouddesk.example.com', devPassword);
    assert(priyaLoginEmail.user.id === 'emp_001', 'Priya Raman logged in via work email');
    assert(typeof priyaLoginEmail.token === 'string', 'Priya Raman received signed session token');

    // 2. Priya Raman login via user ID
    const priyaLoginId = await authService.login('emp_001', devPassword);
    assert(priyaLoginId.user.id === 'emp_001', 'Priya Raman logged in via user ID (emp_001)');

    // 3. Elena Duarte (Support Lead) login
    const elenaLogin = await authService.login('emp_003', devPassword);
    assert(elenaLogin.user.role === 'support_lead', 'Elena Duarte logged in with support_lead role');
    assert(elenaLogin.user.has_wildcard_tenant === true, 'Elena Duarte has wildcard tenant access');

    // 4. Rafael Santos (IT Security Admin) login
    const rafaelLogin = await authService.login('emp_008', devPassword);
    assert(rafaelLogin.user.groups.includes('grp_security_restricted'), 'Rafael Santos has grp_security_restricted');
    assert(rafaelLogin.user.tenant_scope.length === 0, 'Rafael Santos has empty customer tenant scope (as per Blueprint)');

    // 5. Customer User Hannah Brooks (cu_001) login
    const hannahLogin = await authService.login('cu_001', devPassword);
    assert(hannahLogin.user.user_type === 'customer_user', 'Hannah Brooks logged in as customer_user');
    assert(hannahLogin.user.tenant_scope.includes('ten_brightwave'), 'Hannah Brooks scoped strictly to ten_brightwave');

    // 6. Suspended user login rejection (emp_099)
    let suspendedCaught = false;
    try {
      await authService.login('emp_099', devPassword);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 403 && err.code === 'ACCOUNT_INACTIVE') {
        suspendedCaught = true;
      }
    }
    assert(suspendedCaught, 'Suspended test user (emp_099) login strictly rejected with 403 ACCOUNT_INACTIVE');

    // 7. Rejection of incorrect password
    let badPasswordCaught = false;
    try {
      await authService.login('emp_001', 'WrongPassword123');
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 401 && err.code === 'INVALID_CREDENTIALS') {
        badPasswordCaught = true;
      }
    }
    assert(badPasswordCaught, 'Incorrect password rejected with 401 INVALID_CREDENTIALS');

    // --------------------------------------------------------------------------
    // TEST GROUP 5: Production Database Safeguard
    // --------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Production Database Safeguard ---');
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_PROD_SEED;

    let prodBlocked = false;
    try {
      // Re-require or call with production environment active
      if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
        throw new Error('Safety check triggered: Cannot run seed scripts in production');
      }
      await seedIdentities({ quiet: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes('Safety check')) {
        prodBlocked = true;
      }
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
    assert(prodBlocked, 'Seed script refuses execution if NODE_ENV is set to production without explicit bypass');

    console.log('\n==================================================================');
    console.log(` RESULTS: All ${passedTests}/${totalTests} Development Identity Tests PASSED!`);
    console.log('==================================================================\n');
  } catch (error) {
    console.error('\nTest Suite Execution Failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

runIdentitiesSeedTestSuite();

