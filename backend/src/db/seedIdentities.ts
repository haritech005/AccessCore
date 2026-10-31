import { getPool, closePool } from './index';
import { runMigrations } from './migrate';
import { authService } from '../services/authService';
import { config } from '../config';

export interface SeedIdentityDefinition {
  id: string;
  name: string;
  email: string;
  role: string;
  user_type: 'employee' | 'customer_user';
  status: 'active' | 'suspended' | 'inactive';
  groups: string[];
  tenant_scope: string[];
}

export const CLOUDDESK_TENANTS = [
  { id: 'global', name: 'CloudDesk Global (Company-wide)', status: 'active' },
  { id: 'ten_brightwave', name: 'Brightwave Logistics', status: 'active' },
  { id: 'ten_harborpine', name: 'Harborpine Financial', status: 'active' },
  { id: 'ten_lumenfield', name: 'Lumenfield Academy', status: 'active' },
];

export const CLOUDDESK_GROUPS = [
  { id: 'grp_all_employees', name: 'All Employees', description: 'Every active CloudDesk employee' },
  { id: 'grp_support', name: 'Customer Support', description: 'Customer Support staff' },
  { id: 'grp_support_leads', name: 'Support Leads', description: 'Support leads (subset of support)' },
  { id: 'grp_customer_success', name: 'Customer Success', description: 'Customer Success staff' },
  { id: 'grp_cs_managers', name: 'Customer Success Managers', description: 'Customer Success managers (subset)' },
  { id: 'grp_engineering', name: 'Engineering', description: 'Engineering staff' },
  { id: 'grp_eng_oncall', name: 'Engineering On-Call', description: 'Engineers on the incident on-call rotation' },
  { id: 'grp_incident_review', name: 'Incident Review', description: 'Named people cleared for full incident reports and root-cause detail' },
  { id: 'grp_it_security', name: 'IT / Security', description: 'IT / Security administrators' },
  { id: 'grp_security_restricted', name: 'Security Restricted', description: 'Small group cleared for restricted security/audit material' },
  { id: 'grp_public', name: 'Public Readers', description: 'Pseudo-group for unauthenticated/public readers' },
  { id: 'cust_ten_brightwave_users', name: 'Brightwave Customer Users', description: 'Customer users of Brightwave Logistics' },
  { id: 'cust_ten_harborpine_users', name: 'Harborpine Customer Users', description: 'Customer users of Harborpine Financial' },
  { id: 'cust_ten_lumenfield_users', name: 'Lumenfield Customer Users', description: 'Customer users of Lumenfield Academy' },
];

/**
 * Agreed CloudDesk Identity Dataset from CloudDesk Blueprint (BP-0001, Section 4.4 & 3)
 */
export const CLOUDDESK_IDENTITIES: SeedIdentityDefinition[] = [
  // 1. Support Agent (Brightwave & Lumenfield)
  {
    id: 'emp_001',
    name: 'Priya Raman',
    email: 'priya.raman@clouddesk.example.com',
    role: 'support_agent',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_support'],
    tenant_scope: ['ten_brightwave', 'ten_lumenfield'],
  },
  // 2. Support Agent (Harborpine & Lumenfield)
  {
    id: 'emp_002',
    name: 'Marcus Webb',
    email: 'marcus.webb@clouddesk.example.com',
    role: 'support_agent',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_support'],
    tenant_scope: ['ten_harborpine', 'ten_lumenfield'],
  },
  // 3. Support Lead (All tenants via wildcard)
  {
    id: 'emp_003',
    name: 'Elena Duarte',
    email: 'elena.duarte@clouddesk.example.com',
    role: 'support_lead',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_support', 'grp_support_leads'],
    tenant_scope: ['*'],
  },
  // 4. CSM (Brightwave & Harborpine)
  {
    id: 'emp_004',
    name: 'Tomas Eriksen',
    email: 'tomas.eriksen@clouddesk.example.com',
    role: 'csm',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_customer_success'],
    tenant_scope: ['ten_brightwave', 'ten_harborpine'],
  },
  // 5. CS Manager (All tenants via wildcard)
  {
    id: 'emp_005',
    name: 'Aisha Khan',
    email: 'aisha.khan@clouddesk.example.com',
    role: 'cs_manager',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_customer_success', 'grp_cs_managers'],
    tenant_scope: ['*'],
  },
  // 6. Engineer (All tenants)
  {
    id: 'emp_006',
    name: 'Daniel Okafor',
    email: 'daniel.okafor@clouddesk.example.com',
    role: 'engineer',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_engineering'],
    tenant_scope: ['*'],
  },
  // 7. Engineering Manager (All tenants + Incident Review clearance)
  {
    id: 'emp_007',
    name: 'Mei Lin Chen',
    email: 'mei.lin.chen@clouddesk.example.com',
    role: 'engineering_manager',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_engineering', 'grp_eng_oncall', 'grp_incident_review'],
    tenant_scope: ['*'],
  },
  // 8. IT Security Administrator (Security Restricted clearance; zero customer tenant scope)
  {
    id: 'emp_008',
    name: 'Rafael Santos',
    email: 'rafael.santos@clouddesk.example.com',
    role: 'it_security_admin',
    user_type: 'employee',
    status: 'active',
    groups: ['grp_all_employees', 'grp_it_security', 'grp_security_restricted'],
    tenant_scope: [],
  },
  // 9. Customer User 1 (Brightwave Logistics Admin)
  {
    id: 'cu_001',
    name: 'Hannah Brooks',
    email: 'hannah.brooks@brightwave.example.com',
    role: 'customer_user',
    user_type: 'customer_user',
    status: 'active',
    groups: ['cust_ten_brightwave_users', 'grp_public'],
    tenant_scope: ['ten_brightwave'],
  },
  // 10. Customer User 2 (Harborpine Financial Admin)
  {
    id: 'cu_002',
    name: 'Leo Navarro',
    email: 'leo.navarro@harborpine.example.com',
    role: 'customer_user',
    user_type: 'customer_user',
    status: 'active',
    groups: ['cust_ten_harborpine_users', 'grp_public'],
    tenant_scope: ['ten_harborpine'],
  },
  // 11. Customer User 3 (Lumenfield Academy Agent)
  {
    id: 'cu_003',
    name: 'Grace Okoye',
    email: 'grace.okoye@lumenfield.example.com',
    role: 'customer_user',
    user_type: 'customer_user',
    status: 'active',
    groups: ['cust_ten_lumenfield_users', 'grp_public'],
    tenant_scope: ['ten_lumenfield'],
  },
  // 12. Suspended Test User (Used to test immediate account lockouts)
  {
    id: 'emp_099',
    name: 'Inactive Tester',
    email: 'inactive.tester@clouddesk.example.com',
    role: 'support_agent',
    user_type: 'employee',
    status: 'suspended',
    groups: ['grp_all_employees', 'grp_support'],
    tenant_scope: ['ten_brightwave'],
  },
];

/**
 * Seeds CloudDesk development identities, tenants, groups, and memberships.
 * Safe to execute multiple times (idempotent).
 */
export async function seedIdentities(options?: { quiet?: boolean }): Promise<{
  tenantsCount: number;
  groupsCount: number;
  usersCount: number;
}> {
  // Production safeguard
  if (config.NODE_ENV === 'production' && !process.env.ALLOW_PROD_SEED) {
    throw new Error(
      '[AccessCore Seed] Safety check failed: Cannot run development seed scripts against a production database.'
    );
  }

  // Ensure migrations are current first
  await runMigrations();

  const pool = getPool();
  const client = await pool.connect();

  const log = (msg: string) => {
    if (!options?.quiet) console.log(msg);
  };

  try {
    log('\n==================================================================');
    log(' AccessCore Subphase 2.4 — Development Identity Seeding           ');
    log('==================================================================\n');

    await client.query('BEGIN');

    // 1. Seed Tenants
    log('[Seed] Upserting 4 CloudDesk tenants...');
    for (const tenant of CLOUDDESK_TENANTS) {
      await client.query(
        `INSERT INTO tenants (id, name, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status`,
        [tenant.id, tenant.name, tenant.status]
      );
    }

    // 2. Seed Groups
    log(`[Seed] Upserting ${CLOUDDESK_GROUPS.length} security access groups...`);
    for (const grp of CLOUDDESK_GROUPS) {
      await client.query(
        `INSERT INTO groups (id, name, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description`,
        [grp.id, grp.name, grp.description]
      );
    }

    // 3. Hash default development password (CloudDesk2026!)
    const devPassword = config.DEV_USER_PASSWORD;
    const defaultPasswordHash = await authService.hashPassword(devPassword);

    // 4. Seed Users and Memberships
    log(`[Seed] Upserting ${CLOUDDESK_IDENTITIES.length} user accounts with hashed credentials...`);
    for (const user of CLOUDDESK_IDENTITIES) {
      // Upsert User
      await client.query(
        `INSERT INTO users (id, email, name, role, user_type, status, password_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = EXCLUDED.email,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           user_type = EXCLUDED.user_type,
           status = EXCLUDED.status,
           password_hash = EXCLUDED.password_hash,
           updated_at = NOW()`,
        [
          user.id,
          user.email.toLowerCase(),
          user.name,
          user.role,
          user.user_type,
          user.status,
          defaultPasswordHash,
        ]
      );

      // Re-seed Group Memberships
      await client.query(`DELETE FROM user_groups WHERE user_id = $1`, [user.id]);
      for (const grpId of user.groups) {
        await client.query(
          `INSERT INTO user_groups (user_id, group_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, group_id) DO NOTHING`,
          [user.id, grpId]
        );
      }

      // Re-seed Tenant Scopes
      await client.query(`DELETE FROM user_tenants WHERE user_id = $1`, [user.id]);
      for (const tenantId of user.tenant_scope) {
        await client.query(
          `INSERT INTO user_tenants (user_id, tenant_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, tenant_id) DO NOTHING`,
          [user.id, tenantId]
        );
      }
    }

    await client.query('COMMIT');

    log('\n[Seed] Successfully seeded all identities!');
    log(`  - Tenants: ${CLOUDDESK_TENANTS.length}`);
    log(`  - Groups: ${CLOUDDESK_GROUPS.length}`);
    log(`  - User Accounts: ${CLOUDDESK_IDENTITIES.length}`);
    log(`  - Dev Password: ${devPassword} (Hashed with bcrypt: 10 rounds)\n`);

    return {
      tenantsCount: CLOUDDESK_TENANTS.length,
      groupsCount: CLOUDDESK_GROUPS.length,
      usersCount: CLOUDDESK_IDENTITIES.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[AccessCore Seed] Error during identity seeding:', err);
    throw err;
  } finally {
    client.release();
  }
}

// Direct execution from CLI
if (require.main === module) {
  seedIdentities()
    .then(() => closePool())
    .catch(async (err) => {
      console.error(err);
      await closePool();
      process.exit(1);
    });
}

