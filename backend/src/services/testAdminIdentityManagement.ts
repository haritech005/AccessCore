import assert from 'assert';
import http from 'http';
import { createApp } from '../app';
import { closePool, query } from '../db';
import { runMigrations } from '../db/migrate';
import { seedIdentities } from '../db/seedIdentities';
import { authService } from './authService';

async function runAdminIdentityTests(): Promise<void> {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 5.4 — Admin Identity, Role & Group Suite     ');
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

  const testIds = {
    empUser: 'emp_test54_sec',
    adminUser: 'emp_test54_adm',
    custUser: 'cu_test54_bw',
    groupId: 'grp_test54_audit',
    tenantId: 'ten_test54_acme',
  };

  async function cleanupTestArtifacts() {
    await query(`DELETE FROM audit_logs WHERE target_id = ANY($1::varchar[]) OR actor_id = $2`, [
      [
        testIds.empUser,
        testIds.adminUser,
        testIds.custUser,
        testIds.groupId,
        testIds.tenantId,
      ],
      testIds.adminUser,
    ]);
    await query(
      `DELETE FROM audit_logs WHERE action = 'admin.user.lockout_prevented' AND target_id = 'emp_008'`
    );
    await query(`DELETE FROM users WHERE id = ANY($1::varchar[])`, [
      [testIds.empUser, testIds.adminUser, testIds.custUser],
    ]);
    await query(`DELETE FROM groups WHERE id = $1`, [testIds.groupId]);
    await query(`DELETE FROM tenants WHERE id = $1`, [testIds.tenantId]);
  }

  await cleanupTestArtifacts();

  const rafael = (await authService.resolveAuthenticatedUser('emp_008'))!;
  const priya = (await authService.resolveAuthenticatedUser('emp_001'))!;
  const meiLin = (await authService.resolveAuthenticatedUser('emp_007'))!;
  const hannah = (await authService.resolveAuthenticatedUser('cu_001'))!;
  const suspended = (await authService.resolveAuthenticatedUser('emp_099'))!;

  const rafaelToken = await authService.createToken(rafael.id, rafael.email);
  const priyaToken = await authService.createToken(priya.id, priya.email);
  const meiLinToken = await authService.createToken(meiLin.id, meiLin.email);
  const hannahToken = await authService.createToken(hannah.id, hannah.email);
  const suspendedToken = await authService.createToken(suspended.id, suspended.email);

  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function requestJson(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {}
  ): Promise<{ status: number; body: any; rawText: string }> {
    const headers: Record<string, string> = {};
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
    console.log('--- TEST GROUP 1: Server-Side Admin Enforcement Across Identity Routes ---');

    await test('Unauthenticated requests to /api/admin/users, roles, groups, tenants return 401', async () => {
      for (const path of ['/api/admin/users', '/api/admin/roles', '/api/admin/groups', '/api/admin/tenants']) {
        const res = await requestJson(path);
        assert.strictEqual(res.status, 401, `Expected 401 on ${path}, got ${res.status}`);
      }
    });

    await test('Non-admin users (support_agent, engineering_manager, customer_user, suspended) get 403 on mutations and reads', async () => {
      for (const tok of [priyaToken, meiLinToken, hannahToken, suspendedToken]) {
        const listRes = await requestJson('/api/admin/users', { token: tok });
        assert.strictEqual(listRes.status, 403);

        const createRes = await requestJson('/api/admin/users', {
          method: 'POST',
          token: tok,
          body: {
            email: 'escalate@clouddesk.example.com',
            name: 'Escalate Attempt',
            user_type: 'employee',
            role: 'admin',
            password: 'StrongPassword123!',
          },
        });
        assert.strictEqual(createRes.status, 403);

        const grpRes = await requestJson('/api/admin/groups/grp_security_restricted/members', {
          method: 'PUT',
          token: tok,
          body: { user_ids: ['cu_001'] },
        });
        assert.strictEqual(grpRes.status, 403);
      }
    });

    console.log('\n--- TEST GROUP 2: User Directory, Validation & Privilege Escalation Prevention ---');

    await test('Admin can list and filter users and never receives password_hash in payloads', async () => {
      const res = await requestJson('/api/admin/users?search=Priya&role=support_agent', {
        token: rafaelToken,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert(res.body.data.users.length >= 1);
      assert.strictEqual(res.rawText.includes('password_hash'), false);
    });

    await test('Creating customer_user with admin role or wildcard tenant is blocked (privilege escalation)', async () => {
      const badRoleRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.custUser,
          email: 'bad.customer@brightwave.example.com',
          name: 'Bad Customer',
          user_type: 'customer_user',
          role: 'admin',
          password: 'CustomerPass123!',
          groups: ['grp_public'],
          tenant_scope: ['ten_brightwave'],
        },
      });
      assert.strictEqual(badRoleRes.status, 400);
      assert.strictEqual(badRoleRes.body.error.code, 'PRIVILEGE_ESCALATION_BLOCKED');

      const wildcardRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.custUser,
          email: 'wildcard.customer@brightwave.example.com',
          name: 'Wildcard Customer',
          user_type: 'customer_user',
          role: 'customer_user',
          password: 'CustomerPass123!',
          groups: ['grp_public'],
          tenant_scope: ['*'],
        },
      });
      assert.strictEqual(wildcardRes.status, 400);
      assert.strictEqual(wildcardRes.body.error.code, 'PRIVILEGE_ESCALATION_BLOCKED');

      const restrictedGrpRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.custUser,
          email: 'group.customer@brightwave.example.com',
          name: 'Restricted Group Customer',
          user_type: 'customer_user',
          role: 'customer_user',
          password: 'CustomerPass123!',
          groups: ['grp_security_restricted'],
          tenant_scope: ['ten_brightwave'],
        },
      });
      assert.strictEqual(restrictedGrpRes.status, 400);
      assert.strictEqual(restrictedGrpRes.body.error.code, 'PRIVILEGE_ESCALATION_BLOCKED');
    });

    await test('Admin can create valid employee and customer accounts and authenticate newly created user', async () => {
      const empRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.empUser,
          email: 'test54.eng@clouddesk.example.com',
          name: 'Test54 Engineer',
          user_type: 'employee',
          role: 'engineer',
          status: 'active',
          password: 'Test54Password!',
          groups: ['grp_all_employees', 'grp_engineering'],
          tenant_scope: ['ten_brightwave'],
        },
      });
      assert.strictEqual(empRes.status, 201);
      assert.strictEqual(empRes.body.data.user.id, testIds.empUser);
      assert.strictEqual(empRes.rawText.includes('password_hash'), false);

      // Verify newly created user can log in via /api/auth/login
      const loginRes = await requestJson('/api/auth/login', {
        method: 'POST',
        body: {
          email: 'test54.eng@clouddesk.example.com',
          password: 'Test54Password!',
        },
      });
      assert.strictEqual(loginRes.status, 200);
      assert.strictEqual(loginRes.body.data.user.id, testIds.empUser);

      // Create valid customer user scoped strictly to Brightwave
      const custRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.custUser,
          email: 'test54.cu@brightwave.example.com',
          name: 'Test54 Brightwave User',
          user_type: 'customer_user',
          role: 'customer_user',
          status: 'active',
          password: 'CustomerPass123!',
          groups: ['cust_ten_brightwave_users', 'grp_public'],
          tenant_scope: ['ten_brightwave'],
        },
      });
      assert.strictEqual(custRes.status, 201);
    });

    await test('Deactivating a normal employee prevents login and password reset updates hash safely', async () => {
      const suspendRes = await requestJson(`/api/admin/users/${testIds.empUser}`, {
        method: 'PATCH',
        token: rafaelToken,
        body: { status: 'suspended' },
      });
      assert.strictEqual(suspendRes.status, 200);
      assert.strictEqual(suspendRes.body.data.user.status, 'suspended');
      assert.strictEqual(suspendRes.body.data.effective_access.is_active, false);
      assert.strictEqual(suspendRes.body.data.effective_access.accessible_documents.length, 0);

      const blockedLogin = await requestJson('/api/auth/login', {
        method: 'POST',
        body: {
          email: 'test54.eng@clouddesk.example.com',
          password: 'Test54Password!',
        },
      });
      assert.strictEqual(blockedLogin.status, 403);

      // Re-activate & reset password
      const reactivateRes = await requestJson(`/api/admin/users/${testIds.empUser}`, {
        method: 'PATCH',
        token: rafaelToken,
        body: { status: 'active' },
      });
      assert.strictEqual(reactivateRes.status, 200);

      const resetRes = await requestJson(`/api/admin/users/${testIds.empUser}/reset-password`, {
        method: 'POST',
        token: rafaelToken,
        body: { password: 'RotatedNewPassword99!' },
      });
      assert.strictEqual(resetRes.status, 200);

      const newLogin = await requestJson('/api/auth/login', {
        method: 'POST',
        body: {
          email: 'test54.eng@clouddesk.example.com',
          password: 'RotatedNewPassword99!',
        },
      });
      assert.strictEqual(newLogin.status, 200);
    });

    console.log('\n--- TEST GROUP 3: Last Active Admin Lockout Protection ---');

    await test('Suspending or demoting the last active administrator (emp_008) is blocked with 409', async () => {
      const activeAdminCheck = await query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE user_type = 'employee' AND status = 'active' AND role IN ('admin', 'it_security_admin')`
      );
      assert.strictEqual(parseInt(activeAdminCheck.rows[0].count, 10), 1);

      const suspendAttempt = await requestJson('/api/admin/users/emp_008', {
        method: 'PATCH',
        token: rafaelToken,
        body: { status: 'suspended' },
      });
      assert.strictEqual(suspendAttempt.status, 409);
      assert.strictEqual(suspendAttempt.body.error.code, 'LAST_ADMIN_LOCKOUT_PREVENTED');

      const demoteAttempt = await requestJson('/api/admin/users/emp_008', {
        method: 'PATCH',
        token: rafaelToken,
        body: { role: 'engineer' },
      });
      assert.strictEqual(demoteAttempt.status, 409);
      assert.strictEqual(demoteAttempt.body.error.code, 'LAST_ADMIN_LOCKOUT_PREVENTED');
    });

    await test('When a second active admin exists, one admin can be demoted while the remaining last admin stays protected', async () => {
      const createAdminRes = await requestJson('/api/admin/users', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.adminUser,
          email: 'second.admin54@clouddesk.example.com',
          name: 'Second Admin54',
          user_type: 'employee',
          role: 'admin',
          status: 'active',
          password: 'SecondAdminPassword1!',
          groups: ['grp_all_employees', 'grp_it_security'],
          tenant_scope: [],
        },
      });
      assert.strictEqual(createAdminRes.status, 201);

      // Now demote the second admin -> allowed because emp_008 remains active!
      const demoteSecond = await requestJson(`/api/admin/users/${testIds.adminUser}`, {
        method: 'PATCH',
        token: rafaelToken,
        body: { role: 'engineer' },
      });
      assert.strictEqual(demoteSecond.status, 200);
      assert.strictEqual(demoteSecond.body.data.user.role, 'engineer');

      // Now emp_008 is back to sole active admin -> trying to deactivate emp_008 fails with 409 again
      const lockAgain = await requestJson('/api/admin/users/emp_008', {
        method: 'PATCH',
        token: rafaelToken,
        body: { status: 'inactive' },
      });
      assert.strictEqual(lockAgain.status, 409);
    });

    console.log('\n--- TEST GROUP 4: Effective Access, Roles, Groups, Tenants & Audit Logs ---');

    await test('Effective access inspection reflects tenant boundaries, clearances, and non-bypassable ACLs', async () => {
      const custAccessRes = await requestJson('/api/admin/users/cu_001/effective-access', {
        token: rafaelToken,
      });
      assert.strictEqual(custAccessRes.status, 200);
      const custEA = custAccessRes.body.data.effective_access;
      assert.strictEqual(custEA.is_admin, false);
      assert.strictEqual(custEA.has_restricted_clearance, false);
      assert.strictEqual(custEA.has_wildcard_tenant, false);
      const custTenants = custEA.effective_tenants.map((t: any) => t.id);
      assert(custTenants.includes('ten_brightwave'));
      assert(!custTenants.includes('ten_harborpine'));

      // Verify emp_008 retains Phase 2 customer-tenant isolation
      const rafaelAccessRes = await requestJson('/api/admin/users/emp_008/effective-access', {
        token: rafaelToken,
      });
      assert.strictEqual(rafaelAccessRes.status, 200);
      const rafaelEA = rafaelAccessRes.body.data.effective_access;
      assert.strictEqual(rafaelEA.is_admin, true);
      assert.strictEqual(rafaelEA.has_restricted_clearance, true);
      assert.strictEqual(rafaelEA.has_wildcard_tenant, false);
      assert.deepStrictEqual(
        rafaelEA.effective_tenants.map((t: any) => t.id),
        ['global']
      );
    });

    await test('Roles catalog returns all 9 validated roles with counts and boundary notes', async () => {
      const rolesRes = await requestJson('/api/admin/roles', { token: rafaelToken });
      assert.strictEqual(rolesRes.status, 200);
      assert.strictEqual(rolesRes.body.data.roles.length, 9);
      const adminRole = rolesRes.body.data.roles.find((r: any) => r.role === 'it_security_admin');
      assert(adminRole && adminRole.active_user_count >= 1);
    });

    await test('Groups can be created, updated, and member-managed while blocking customer_user escalation into internal groups', async () => {
      const createGrp = await requestJson('/api/admin/groups', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.groupId,
          name: 'Test54 Compliance Group',
          description: 'Temporary audit test group',
        },
      });
      assert.strictEqual(createGrp.status, 201);

      const badMembers = await requestJson(`/api/admin/groups/${testIds.groupId}/members`, {
        method: 'PUT',
        token: rafaelToken,
        body: { user_ids: ['cu_001'] },
      });
      assert.strictEqual(badMembers.status, 400);
      assert.strictEqual(badMembers.body.error.code, 'PRIVILEGE_ESCALATION_BLOCKED');

      const goodMembers = await requestJson(`/api/admin/groups/${testIds.groupId}/members`, {
        method: 'PUT',
        token: rafaelToken,
        body: { user_ids: [testIds.empUser] },
      });
      assert.strictEqual(goodMembers.status, 200);
      assert.strictEqual(goodMembers.body.data.group.member_count, 1);
    });

    await test('Tenants can be listed, created, and updated while protecting system global tenant', async () => {
      const createTen = await requestJson('/api/admin/tenants', {
        method: 'POST',
        token: rafaelToken,
        body: {
          id: testIds.tenantId,
          name: 'Acme Test54 Corp',
          status: 'active',
        },
      });
      assert.strictEqual(createTen.status, 201);

      const disableGlobal = await requestJson('/api/admin/tenants/global', {
        method: 'PATCH',
        token: rafaelToken,
        body: { status: 'suspended' },
      });
      assert.strictEqual(disableGlobal.status, 400);
      assert.strictEqual(disableGlobal.body.error.code, 'CANNOT_DISABLE_GLOBAL_TENANT');
    });

    await test('Audit logs record admin mutations and denied lockout attempts without storing raw passwords or hashes', async () => {
      const auditRes = await query<{
        action: string;
        outcome: string;
        target_id: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT action, outcome, target_id, metadata FROM audit_logs
         WHERE target_id = ANY($1::varchar[]) OR (action = 'admin.user.lockout_prevented' AND target_id = 'emp_008')`,
        [[testIds.empUser, testIds.custUser, testIds.adminUser, testIds.groupId, testIds.tenantId]]
      );

      const actions = new Set(auditRes.rows.map((r) => `${r.action}:${r.outcome}`));
      assert(actions.has('admin.user.created:success'));
      assert(actions.has('admin.user.status_changed:success'));
      assert(actions.has('admin.user.password_reset:success'));
      assert(actions.has('admin.user.lockout_prevented:denied'));
      assert(actions.has('admin.group.created:success'));
      assert(actions.has('admin.group.members_updated:success'));
      assert(actions.has('admin.tenant.created:success'));

      const serialized = JSON.stringify(auditRes.rows);
      assert.strictEqual(serialized.includes('RotatedNewPassword99!'), false);
      assert.strictEqual(serialized.includes('Test54Password!'), false);
      assert.strictEqual(serialized.includes('$2a$'), false);
      assert.strictEqual(serialized.includes('$2b$'), false);
    });
  } finally {
    await cleanupTestArtifacts();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool();
  }

  console.log(`\nRESULTS: ${passed} passed, ${failed} failed across ${passed + failed} tests.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAdminIdentityTests().catch((err) => {
  console.error('[Subphase 5.4 Test Suite] Fatal error:', err);
  process.exit(1);
});

