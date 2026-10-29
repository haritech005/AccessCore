import { getPool, closePool, query } from '../db';
import { runMigrations } from '../db/migrate';
import {
  AuthenticatedUser,
  evaluateDocumentAccess,
  DocumentAccessTarget,
} from '../types/identity';

async function runIdentitySchemaTests() {
  console.log('==================================================================');
  console.log(' AccessCore Subphase 2.2 - Identity & Permission Schema Tests    ');
  console.log('==================================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      console.log(`  ✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ [FAIL] ${testName}`);
      throw new Error(`Assertion failed: ${testName}`);
    }
  }

  // 1. Run migrations to ensure 002_identity_and_permissions.sql is applied
  console.log('--- TEST GROUP 1: Database Migration & Schema Verification ---');
  await runMigrations();

  // Verify tables exist in PostgreSQL
  const requiredTables = [
    'tenants',
    'groups',
    'users',
    'user_groups',
    'user_tenants',
    'document_permissions',
  ];

  for (const table of requiredTables) {
    const res = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = $1
      );`,
      [table]
    );
    assert(res.rows[0].exists === true, `Table '${table}' exists in database schema`);
  }

  // 2. Test Relational Constraints and Foreign Keys
  console.log('\n--- TEST GROUP 2: Constraints & Relational Integrity ---');
  const testTenantId = 'test_ten_acme';
  const testGroupId = 'test_grp_ops';
  const testUserId = 'test_usr_001';

  // Clean up any leftovers
  await query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  await query(`DELETE FROM groups WHERE id = $1`, [testGroupId]);
  await query(`DELETE FROM tenants WHERE id = $1`, [testTenantId]);

  // Insert tenant
  await query(`INSERT INTO tenants (id, name, status) VALUES ($1, $2, $3)`, [
    testTenantId,
    'Acme Corporation',
    'active',
  ]);
  assert(true, 'Inserted test tenant record');

  // Insert group
  await query(`INSERT INTO groups (id, name, description) VALUES ($1, $2, $3)`, [
    testGroupId,
    'Operations Group',
    'Test operations team',
  ]);
  assert(true, 'Inserted test group record');

  // Insert user
  await query(
    `INSERT INTO users (id, email, name, role, user_type, status, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      testUserId,
      'test.user@example.com',
      'Test User',
      'support_agent',
      'employee',
      'active',
      'hashed_secret_placeholder',
    ]
  );
  assert(true, 'Inserted test user record with role and user_type');

  // Test duplicate email constraint
  let duplicateEmailCaught = false;
  try {
    await query(
      `INSERT INTO users (id, email, name, role, user_type, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['test_usr_002', 'test.user@example.com', 'Duplicate Email User', 'support_agent', 'employee', 'active']
    );
  } catch (err: any) {
    if (err.code === '23505') {
      duplicateEmailCaught = true;
    }
  }
  assert(duplicateEmailCaught, 'Unique constraint rejects duplicate user email (23505)');

  // Link user to group and tenant
  await query(`INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`, [
    testUserId,
    testGroupId,
  ]);
  assert(true, 'Linked user to group via user_groups join table');

  await query(`INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2)`, [
    testUserId,
    testTenantId,
  ]);
  assert(true, 'Linked user to tenant scope via user_tenants join table');

  // Verify cascade delete
  await query(`DELETE FROM users WHERE id = $1`, [testUserId]);
  const userGroupsRes = await query(`SELECT * FROM user_groups WHERE user_id = $1`, [testUserId]);
  const userTenantsRes = await query(`SELECT * FROM user_tenants WHERE user_id = $1`, [testUserId]);
  assert(
    userGroupsRes.rows.length === 0 && userTenantsRes.rows.length === 0,
    'Foreign key CASCADE deletes user_groups and user_tenants when user is deleted'
  );

  // Clean up remaining test data
  await query(`DELETE FROM groups WHERE id = $1`, [testGroupId]);
  await query(`DELETE FROM tenants WHERE id = $1`, [testTenantId]);

  // 3. Test Centralized Permission Evaluation Rules
  console.log('\n--- TEST GROUP 3: Centralized Permission Evaluation Logic ---');

  const baseUser: AuthenticatedUser = {
    id: 'emp_001',
    email: 'priya.raman@clouddesk.example.com',
    name: 'Priya Raman',
    role: 'support_agent',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_support'],
    tenant_scope: ['ten_brightwave', 'ten_lumenfield'],
    has_wildcard_tenant: false,
  };

  // Case 1: Inactive user account is denied
  const inactiveUser: AuthenticatedUser = {
    ...baseUser,
    status: 'inactive',
  };
  const res1 = evaluateDocumentAccess(inactiveUser, {
    tenant_id: 'ten_brightwave',
    allowed_groups: ['grp_support'],
  });
  assert(!res1.allowed && Boolean(res1.reason?.includes('inactive')), 'Inactive user account is strictly denied');

  // Case 2: Matching tenant & matching group is allowed
  const res2 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'ten_brightwave',
    allowed_groups: ['grp_support'],
  });
  assert(res2.allowed === true, 'Matching tenant and matching group is allowed access');

  // Case 3: Unauthorized tenant is denied
  const res3 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'ten_harborpine', // Priya is NOT assigned to harborpine
    allowed_groups: ['grp_support'],
  });
  assert(!res3.allowed && Boolean(res3.reason?.includes('Tenant access denied')), 'User is denied access to unauthorized tenant');

  // Case 4: Wildcard tenant user can access any customer tenant
  const leadUser: AuthenticatedUser = {
    ...baseUser,
    id: 'emp_003',
    name: 'Elena Duarte',
    role: 'support_lead',
    groups: ['grp_all_employees', 'grp_support', 'grp_support_leads'],
    tenant_scope: ['*'],
    has_wildcard_tenant: true,
  };
  const res4 = evaluateDocumentAccess(leadUser, {
    tenant_id: 'ten_harborpine',
    allowed_groups: ['grp_support'],
  });
  assert(res4.allowed === true, 'Wildcard tenant user (*) is permitted access across tenants');

  // Case 5: Global document is accessible to any user with matching group
  const res5 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'global',
    allowed_groups: ['grp_support'],
  });
  assert(res5.allowed === true, 'Global document is accessible to users with matching group');

  // Case 6: Matching tenant but missing group is denied (default-deny)
  const res6 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'ten_brightwave',
    allowed_groups: ['grp_engineering'], // Priya does not belong to engineering
  });
  assert(!res6.allowed && Boolean(res6.reason?.includes('Group access denied')), 'Matching tenant without matching group is denied (default-deny)');

  // Case 7: Public document (grp_public) is accessible to users in tenant scope
  const res7 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'global',
    allowed_groups: ['grp_public'],
  });
  assert(res7.allowed === true, 'Public document (grp_public) is accessible');

  // Case 8: Restricted document requires explicit security clearance
  const restrictedDoc: DocumentAccessTarget = {
    tenant_id: 'global',
    allowed_groups: ['grp_security_restricted'],
    sensitivity: 'restricted',
  };
  const res8a = evaluateDocumentAccess(baseUser, restrictedDoc);
  assert(!res8a.allowed && Boolean(res8a.reason?.includes('Restricted sensitivity requires explicit security clearance')), 'Restricted document denied to standard employee');

  const secAdmin: AuthenticatedUser = {
    ...baseUser,
    id: 'emp_008',
    role: 'it_security_admin',
    groups: ['grp_all_employees', 'grp_it_security', 'grp_security_restricted'],
    tenant_scope: [],
    has_wildcard_tenant: false,
  };
  const res8b = evaluateDocumentAccess(secAdmin, restrictedDoc);
  assert(res8b.allowed === true, 'Restricted document permitted to user with grp_security_restricted');

  // Case 9: Customer user cannot access other customer tenants
  const customerUser: AuthenticatedUser = {
    id: 'cu_001',
    email: 'hannah.brooks@brightwave.example.com',
    name: 'Hannah Brooks',
    role: 'customer_user',
    user_type: 'customer_user',
    status: 'active',
    groups: ['grp_public', 'cust_ten_brightwave_users'],
    tenant_scope: ['ten_brightwave'],
    has_wildcard_tenant: false,
  };
  const res9a = evaluateDocumentAccess(customerUser, {
    tenant_id: 'ten_brightwave',
    allowed_groups: ['cust_ten_brightwave_users'],
  });
  assert(res9a.allowed === true, 'Customer user has access to their own tenant document');

  const res9b = evaluateDocumentAccess(customerUser, {
    tenant_id: 'ten_harborpine',
    allowed_groups: ['cust_ten_harborpine_users'],
  });
  assert(!res9b.allowed, 'Customer user cannot access documents of another customer tenant');

  // Case 10: Inactive document is denied
  const res10 = evaluateDocumentAccess(baseUser, {
    tenant_id: 'ten_brightwave',
    allowed_groups: ['grp_support'],
    is_active: false,
  });
  assert(!res10.allowed && Boolean(res10.reason?.includes('inactive')), 'Inactive document version is denied');

  console.log('\n==================================================================');
  console.log(` ALL ${passed}/${total} IDENTITY & PERMISSION TESTS PASSED! `);
  console.log(' Subphase 2.2 Acceptance Criteria Fully Met.                      ');
  console.log('==================================================================\n');

  await closePool();
}

runIdentitySchemaTests().catch(async (err) => {
  console.error('[Identity Schema Test Runner Error]', err);
  await closePool();
  process.exit(1);
});
