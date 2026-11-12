import crypto from 'crypto';
import { PoolClient } from 'pg';
import { getClient, query } from '../db';
import { AppError } from '../middleware/errorHandler';
import {
  AuthenticatedUser,
  SensitivityLevel,
  UserRole,
  UserStatus,
  UserType,
} from '../types/identity';
import { authService } from './authService';
import { authorizationService } from './authorizationService';
import { auditService } from './auditService';

export interface RoleDefinition {
  role: UserRole;
  label: string;
  user_type: UserType;
  is_admin: boolean;
  description: string;
  capabilities: string[];
  recommended_groups: string[];
  boundary_note: string;
}

export const ROLE_CATALOG: RoleDefinition[] = [
  {
    role: 'admin',
    label: 'System Administrator',
    user_type: 'employee',
    is_admin: true,
    description: 'Full administrative management of identities, permissions, ingestion, and audit operations.',
    capabilities: [
      'admin:manage',
      'manage:users',
      'manage:roles_groups',
      'manage:tenants',
      'manage:documents',
      'ingest:documents',
      'view:audit_logs',
    ],
    recommended_groups: ['grp_all_employees', 'grp_it_security'],
    boundary_note: 'Administrative capabilities do not grant wildcard document read bypasses; explicit tenant/group ACLs still govern retrieval.',
  },
  {
    role: 'it_security_admin',
    label: 'IT Security Administrator',
    user_type: 'employee',
    is_admin: true,
    description: 'Security and identity governance administrator with access control and audit oversight.',
    capabilities: [
      'admin:manage',
      'manage:users',
      'manage:roles_groups',
      'manage:tenants',
      'manage:documents',
      'ingest:documents',
      'view:audit_logs',
    ],
    recommended_groups: ['grp_all_employees', 'grp_it_security', 'grp_security_restricted'],
    boundary_note: 'Remains isolated from customer-tenant ticket contents unless explicitly granted tenant scopes and document group memberships.',
  },
  {
    role: 'engineering_manager',
    label: 'Engineering Manager',
    user_type: 'employee',
    is_admin: false,
    description: 'Engineering leadership role with cross-tenant technical knowledge access when explicitly cleared.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_engineering', 'grp_eng_oncall', 'grp_incident_review'],
    boundary_note: 'Cannot access Admin Console or modify users, groups, or document permissions.',
  },
  {
    role: 'engineer',
    label: 'Engineer',
    user_type: 'employee',
    is_admin: false,
    description: 'Technical staff accessing internal engineering runbooks and scoped customer tickets.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_engineering'],
    boundary_note: 'Restricted security/incident reports require explicit grp_incident_review or grp_security_restricted membership.',
  },
  {
    role: 'support_lead',
    label: 'Support Lead',
    user_type: 'employee',
    is_admin: false,
    description: 'Customer support leadership across assigned or wildcard customer tenants.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_support', 'grp_support_leads'],
    boundary_note: 'Cannot view restricted security records without explicit restricted clearance.',
  },
  {
    role: 'support_agent',
    label: 'Support Agent',
    user_type: 'employee',
    is_admin: false,
    description: 'Frontline support specialist scoped to specific customer tenants.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_support'],
    boundary_note: 'Strictly blocked from tenants outside user_tenants scope.',
  },
  {
    role: 'cs_manager',
    label: 'Customer Success Manager',
    user_type: 'employee',
    is_admin: false,
    description: 'Customer success leadership overseeing customer accounts and shared playbooks.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_customer_success', 'grp_cs_managers'],
    boundary_note: 'Cannot escalate to admin endpoints or restricted engineering logs.',
  },
  {
    role: 'csm',
    label: 'Customer Success Specialist',
    user_type: 'employee',
    is_admin: false,
    description: 'Customer success representative scoped to assigned customer tenants.',
    capabilities: ['chat:internal', 'chat:customer_safe', 'read:permitted_documents'],
    recommended_groups: ['grp_all_employees', 'grp_customer_success'],
    boundary_note: 'Isolated to explicitly assigned tenant scopes and customer_success/all-employee groups.',
  },
  {
    role: 'customer_user',
    label: 'Customer User',
    user_type: 'customer_user',
    is_admin: false,
    description: 'External tenant principal restricted to customer-safe outputs and a single assigned customer tenant.',
    capabilities: ['chat:customer_safe_only', 'read:assigned_tenant_and_public'],
    recommended_groups: ['grp_public'],
    boundary_note: 'Cannot select internal mode, cannot hold wildcard (*) tenancy, and cannot join internal employee or restricted security groups.',
  },
];

const VALID_ROLES = new Set<UserRole>(ROLE_CATALOG.map((r) => r.role));
const VALID_STATUSES = new Set<UserStatus>(['active', 'inactive', 'suspended']);
const VALID_TENANT_STATUSES = new Set(['active', 'suspended', 'archived']);

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  user_type: UserType;
  status: UserStatus;
  groups: string[];
  tenant_scope: string[];
  created_at: string;
  updated_at: string;
}

export interface UserEffectiveAccess {
  user_id: string;
  is_active: boolean;
  is_admin: boolean;
  has_restricted_clearance: boolean;
  has_wildcard_tenant: boolean;
  effective_groups: string[];
  effective_tenants: { id: string; name: string; status: string }[];
  accessible_documents: {
    id: string;
    document_id: string;
    title: string;
    tenant_id: string;
    sensitivity: string;
    disclosure_policy: string;
    allowed_groups: string[];
  }[];
  denied_summary: {
    total_denied: number;
    by_reason: Record<string, number>;
  };
}

export interface RequestAuditMeta {
  correlationId?: string | null;
  ipAddress?: string | null;
}

export interface ListUsersFilters {
  search?: string;
  role?: string;
  status?: string;
  user_type?: string;
  group?: string;
  tenant?: string;
  page?: number;
  limit?: number;
}

export interface CreateUserInput {
  id?: string;
  email: string;
  name: string;
  role: UserRole;
  user_type: UserType;
  status?: UserStatus;
  password: string;
  groups?: string[];
  tenant_scope?: string[];
}

export interface UpdateUserInput {
  email?: string;
  name?: string;
  role?: UserRole;
  user_type?: UserType;
  status?: UserStatus;
  groups?: string[];
  tenant_scope?: string[];
}

function isAdminRole(role: string): boolean {
  return role === 'admin' || role === 'it_security_admin';
}

function isCustomerPermittedGroup(groupId: string): boolean {
  return groupId === 'grp_public' || groupId.startsWith('cust_');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 255) {
    throw new AppError('Please provide a valid email address.', 400, 'INVALID_EMAIL');
  }
  return normalized;
}

function validateUserTypeAndRole(userType: string, role: string): { userType: UserType; role: UserRole } {
  if (userType !== 'employee' && userType !== 'customer_user') {
    throw new AppError(`Invalid user_type '${userType}'. Must be 'employee' or 'customer_user'.`, 400, 'INVALID_USER_TYPE');
  }
  if (!VALID_ROLES.has(role as UserRole)) {
    throw new AppError(`Invalid role '${role}'.`, 400, 'INVALID_ROLE');
  }
  if (userType === 'customer_user' && role !== 'customer_user') {
    throw new AppError(
      `Privilege escalation blocked: customer_user accounts can only hold the 'customer_user' role, not '${role}'.`,
      400,
      'PRIVILEGE_ESCALATION_BLOCKED'
    );
  }
  if (userType === 'employee' && role === 'customer_user') {
    throw new AppError(
      `Invalid role mapping: employee accounts cannot hold the 'customer_user' role.`,
      400,
      'INVALID_ROLE_ASSIGNMENT'
    );
  }
  return { userType, role: role as UserRole };
}

function validateStatus(status: string): UserStatus {
  if (!VALID_STATUSES.has(status as UserStatus)) {
    throw new AppError(`Invalid status '${status}'. Must be active, inactive, or suspended.`, 400, 'INVALID_STATUS');
  }
  return status as UserStatus;
}

function validatePasswordStrength(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new AppError('Password must be between 8 and 128 characters long.', 400, 'WEAK_PASSWORD');
  }
  return password;
}

function dedupeStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return Array.from(
    new Set(
      arr
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0)
    )
  );
}

async function validateGroupsForUser(
  client: PoolClient,
  groupIds: string[],
  userType: UserType
): Promise<void> {
  if (groupIds.length === 0) return;

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM groups WHERE id = ANY($1::varchar[])`,
    [groupIds]
  );
  const existingSet = new Set(existing.rows.map((r) => r.id));
  const missing = groupIds.filter((g) => !existingSet.has(g));
  if (missing.length > 0) {
    throw new AppError(`Unknown group ID(s): ${missing.join(', ')}`, 400, 'INVALID_GROUP');
  }

  if (userType === 'customer_user') {
    const forbidden = groupIds.filter((g) => !isCustomerPermittedGroup(g));
    if (forbidden.length > 0) {
      throw new AppError(
        `Privilege escalation blocked: customer_user accounts cannot be assigned to internal or security groups (${forbidden.join(', ')}).`,
        400,
        'PRIVILEGE_ESCALATION_BLOCKED'
      );
    }
  }
}

async function validateTenantsForUser(
  client: PoolClient,
  tenantIds: string[],
  userType: UserType
): Promise<void> {
  if (userType === 'customer_user') {
    if (tenantIds.includes('*')) {
      throw new AppError(
        'Privilege escalation blocked: customer_user accounts cannot be assigned wildcard (*) tenant scope.',
        400,
        'PRIVILEGE_ESCALATION_BLOCKED'
      );
    }
    if (tenantIds.includes('global')) {
      throw new AppError(
        "Invalid tenant scope: customer_user accounts must be scoped to their specific customer tenant, not 'global'.",
        400,
        'INVALID_TENANT_SCOPE'
      );
    }
    if (tenantIds.length !== 1) {
      throw new AppError(
        'Customer isolation rule: customer_user accounts must be assigned to exactly one customer tenant.',
        400,
        'CUSTOMER_MULTI_TENANT_FORBIDDEN'
      );
    }
  }

  const nonWildcard = tenantIds.filter((t) => t !== '*');
  if (nonWildcard.length > 0) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM tenants WHERE id = ANY($1::varchar[])`,
      [nonWildcard]
    );
    const existingSet = new Set(existing.rows.map((r) => r.id));
    const missing = nonWildcard.filter((t) => !existingSet.has(t));
    if (missing.length > 0) {
      throw new AppError(`Unknown tenant ID(s): ${missing.join(', ')}`, 400, 'INVALID_TENANT');
    }
  }
}

function generateUserId(userType: UserType): string {
  const prefix = userType === 'customer_user' ? 'cu' : 'emp';
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

class AdminIdentityService {
  async listUsers(filters: ListUsersFilters): Promise<{
    users: AdminUserSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim()}%`);
      const idx = params.length;
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.id ILIKE $${idx})`);
    }
    if (filters.role && filters.role !== 'all') {
      params.push(filters.role);
      conditions.push(`u.role = $${params.length}`);
    }
    if (filters.status && filters.status !== 'all') {
      params.push(filters.status);
      conditions.push(`u.status = $${params.length}`);
    }
    if (filters.user_type && filters.user_type !== 'all') {
      params.push(filters.user_type);
      conditions.push(`u.user_type = $${params.length}`);
    }
    if (filters.group && filters.group !== 'all') {
      params.push(filters.group);
      conditions.push(`EXISTS (SELECT 1 FROM user_groups ug_f WHERE ug_f.user_id = u.id AND ug_f.group_id = $${params.length})`);
    }
    if (filters.tenant && filters.tenant !== 'all') {
      params.push(filters.tenant);
      conditions.push(`EXISTS (SELECT 1 FROM user_tenants ut_f WHERE ut_f.user_id = u.id AND ut_f.tenant_id = $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM users u ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;

    const rowsRes = await query<AdminUserSummary>(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.user_type,
        u.status,
        COALESCE(
          (SELECT ARRAY_AGG(ug.group_id ORDER BY ug.group_id) FROM user_groups ug WHERE ug.user_id = u.id),
          '{}'::varchar[]
        ) AS groups,
        COALESCE(
          (SELECT ARRAY_AGG(ut.tenant_id ORDER BY ut.tenant_id) FROM user_tenants ut WHERE ut.user_id = u.id),
          '{}'::varchar[]
        ) AS tenant_scope,
        u.created_at,
        u.updated_at
      FROM users u
      ${whereClause}
      ORDER BY u.created_at ASC, u.id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      listParams
    );

    return {
      users: rowsRes.rows,
      total,
      page,
      limit,
    };
  }

  async getUserById(userId: string): Promise<AdminUserSummary> {
    const res = await query<AdminUserSummary>(
      `
      SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.user_type,
        u.status,
        COALESCE(
          (SELECT ARRAY_AGG(ug.group_id ORDER BY ug.group_id) FROM user_groups ug WHERE ug.user_id = u.id),
          '{}'::varchar[]
        ) AS groups,
        COALESCE(
          (SELECT ARRAY_AGG(ut.tenant_id ORDER BY ut.tenant_id) FROM user_tenants ut WHERE ut.user_id = u.id),
          '{}'::varchar[]
        ) AS tenant_scope,
        u.created_at,
        u.updated_at
      FROM users u
      WHERE u.id = $1
      `,
      [userId]
    );

    if (res.rows.length === 0) {
      throw new AppError(`User '${userId}' not found.`, 404, 'USER_NOT_FOUND');
    }

    return res.rows[0];
  }

  async getUserEffectiveAccess(userId: string): Promise<UserEffectiveAccess> {
    const resolvedUser = await authService.resolveAuthenticatedUser(userId);
    if (!resolvedUser) {
      throw new AppError(`User '${userId}' not found.`, 404, 'USER_NOT_FOUND');
    }

    const [tenantsRes, docsRes] = await Promise.all([
      query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM tenants ORDER BY id ASC`
      ),
      query<{
        id: string;
        document_id: string;
        title: string;
        status: string;
        metadata: Record<string, unknown>;
        perm_tenant_id: string | null;
        perm_allowed_groups: string[] | null;
        perm_sensitivity: string | null;
        perm_disclosure_policy: string | null;
        perm_is_active: boolean | null;
      }>(`
        SELECT
          d.id,
          d.document_id,
          d.title,
          d.status,
          d.metadata,
          dp.tenant_id AS perm_tenant_id,
          dp.allowed_groups AS perm_allowed_groups,
          dp.sensitivity AS perm_sensitivity,
          dp.disclosure_policy AS perm_disclosure_policy,
          dp.is_active AS perm_is_active
        FROM documents d
        LEFT JOIN document_permissions dp ON dp.document_id = d.id
        ORDER BY d.document_id ASC
      `),
    ]);

    const effectiveTenants = tenantsRes.rows.filter(
      (t) => authorizationService.authorizeTenantContext(resolvedUser, t.id).allowed
    );

    const accessibleDocs: UserEffectiveAccess['accessible_documents'] = [];
    const denialReasons: Record<string, number> = {};
    let totalDenied = 0;

    for (const row of docsRes.rows) {
      const meta = row.metadata || {};
      const tenantId = row.perm_tenant_id || (meta.tenant_id as string) || 'global';
      const allowedGroups =
        row.perm_allowed_groups ||
        (meta.allowed_groups as string[]) ||
        (meta.authorized_groups as string[]) ||
        [];
      const sensitivity = ((row.perm_sensitivity || meta.sensitivity || 'internal') as SensitivityLevel);
      const disclosurePolicy =
        row.perm_disclosure_policy || (meta.disclosure_policy as string) || 'internal_only';
      const isActive =
        row.perm_is_active !== null ? row.perm_is_active : row.status === 'completed';

      const evalResult = authorizationService.can(resolvedUser, 'read:document', {
        type: 'document',
        document_id: row.document_id,
        tenant_id: tenantId,
        allowed_groups: allowedGroups,
        sensitivity,
        disclosure_policy: disclosurePolicy,
        is_active: isActive,
        status: row.status,
      });

      if (evalResult.allowed) {
        accessibleDocs.push({
          id: row.id,
          document_id: row.document_id,
          title: row.title,
          tenant_id: tenantId,
          sensitivity,
          disclosure_policy: disclosurePolicy,
          allowed_groups: allowedGroups,
        });
      } else {
        totalDenied += 1;
        const reason = evalResult.reason || 'Denied by default policy';
        denialReasons[reason] = (denialReasons[reason] || 0) + 1;
      }
    }

    return {
      user_id: resolvedUser.id,
      is_active: resolvedUser.status === 'active',
      is_admin: authorizationService.isAdmin(resolvedUser),
      has_restricted_clearance: authorizationService.hasRestrictedClearance(resolvedUser),
      has_wildcard_tenant:
        resolvedUser.has_wildcard_tenant || resolvedUser.tenant_scope.includes('*'),
      effective_groups: resolvedUser.groups,
      effective_tenants: effectiveTenants,
      accessible_documents: accessibleDocs,
      denied_summary: {
        total_denied: totalDenied,
        by_reason: denialReasons,
      },
    };
  }

  async createUser(
    actor: AuthenticatedUser,
    input: CreateUserInput,
    reqMeta: RequestAuditMeta
  ): Promise<AdminUserSummary> {
    if (!input.name || typeof input.name !== 'string' || input.name.trim().length < 2) {
      throw new AppError('Name must be at least 2 characters.', 400, 'INVALID_NAME');
    }

    const email = validateEmail(input.email || '');
    const { userType, role } = validateUserTypeAndRole(input.user_type, input.role);
    const status = validateStatus(input.status || 'active');
    const password = validatePasswordStrength(input.password);
    const groups = dedupeStrings(input.groups);
    const tenantScope = dedupeStrings(input.tenant_scope);

    const userId =
      input.id && input.id.trim()
        ? input.id.trim().toLowerCase()
        : generateUserId(userType);

    if (!/^[a-z0-9_]{3,50}$/.test(userId)) {
      throw new AppError(
        'User ID must be 3-50 lowercase letters, numbers, or underscores.',
        400,
        'INVALID_USER_ID'
      );
    }

    const passwordHash = await authService.hashPassword(password);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: string; email: string }>(
        `SELECT id, email FROM users WHERE id = $1 OR LOWER(email) = LOWER($2)`,
        [userId, email]
      );
      if (existing.rows.length > 0) {
        throw new AppError(
          `A user with that ID or email already exists.`,
          409,
          'USER_ALREADY_EXISTS'
        );
      }

      await validateGroupsForUser(client, groups, userType);
      await validateTenantsForUser(client, tenantScope, userType);

      await client.query(
        `
        INSERT INTO users (id, email, name, role, user_type, status, password_hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        `,
        [userId, email, input.name.trim(), role, userType, status, passwordHash]
      );

      for (const groupId of groups) {
        await client.query(
          `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, groupId]
        );
      }

      for (const tenantId of tenantScope) {
        await client.query(
          `INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, tenantId]
        );
      }

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.user.created',
          targetType: 'user',
          targetId: userId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            email,
            role,
            user_type: userType,
            status,
            groups,
            tenant_scope: tenantScope,
          },
        },
        client
      );

      await client.query('COMMIT');
      return await this.getUserById(userId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateUser(
    actor: AuthenticatedUser,
    userId: string,
    patch: UpdateUserInput,
    reqMeta: RequestAuditMeta
  ): Promise<AdminUserSummary> {
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Lock active administrators and the target user to prevent concurrent lockout races
      const activeAdminsRes = await client.query<{ id: string }>(
        `
        SELECT id FROM users
        WHERE (user_type = 'employee' AND status = 'active' AND role IN ('admin', 'it_security_admin'))
           OR id = $1
        FOR UPDATE
        `,
        [userId]
      );

      const targetRes = await client.query<{
        id: string;
        email: string;
        name: string;
        role: UserRole;
        user_type: UserType;
        status: UserStatus;
      }>(
        `SELECT id, email, name, role, user_type, status FROM users WHERE id = $1`,
        [userId]
      );

      if (targetRes.rows.length === 0) {
        throw new AppError(`User '${userId}' not found.`, 404, 'USER_NOT_FOUND');
      }

      const current = targetRes.rows[0];
      const nextName = patch.name !== undefined ? patch.name.trim() : current.name;
      if (nextName.length < 2) {
        throw new AppError('Name must be at least 2 characters.', 400, 'INVALID_NAME');
      }

      const nextEmail = patch.email !== undefined ? validateEmail(patch.email) : current.email;
      const { userType: nextUserType, role: nextRole } = validateUserTypeAndRole(
        patch.user_type !== undefined ? patch.user_type : current.user_type,
        patch.role !== undefined ? patch.role : current.role
      );
      const nextStatus = validateStatus(patch.status !== undefined ? patch.status : current.status);

      // Protect the last active administrator from accidental lockout or demotion
      const wasActiveAdmin =
        current.user_type === 'employee' &&
        current.status === 'active' &&
        isAdminRole(current.role);
      const willRemainActiveAdmin =
        nextUserType === 'employee' &&
        nextStatus === 'active' &&
        isAdminRole(nextRole);

      if (wasActiveAdmin && !willRemainActiveAdmin) {
        const otherActiveAdmins = activeAdminsRes.rows.filter(
          (r) => r.id !== userId
        );
        // Re-verify active admin count excluding target directly
        const remainingCountRes = await client.query<{ count: string }>(
          `
          SELECT COUNT(*)::text AS count FROM users
          WHERE id <> $1
            AND user_type = 'employee'
            AND status = 'active'
            AND role IN ('admin', 'it_security_admin')
          `,
          [userId]
        );
        const remainingCount = Math.min(
          otherActiveAdmins.length,
          parseInt(remainingCountRes.rows[0]?.count || '0', 10)
        );
        if (remainingCount === 0) {
          await client.query('ROLLBACK');
          await auditService.recordEvent({
            actor: { id: actor.id, email: actor.email, role: actor.role },
            action: 'admin.user.lockout_prevented',
            targetType: 'user',
            targetId: userId,
            outcome: 'denied',
            correlationId: reqMeta.correlationId,
            ipAddress: reqMeta.ipAddress,
            metadata: {
              attempted_role: nextRole,
              attempted_status: nextStatus,
              attempted_user_type: nextUserType,
            },
          });
          throw new AppError(
            'Cannot deactivate, suspend, or remove administrator privileges from the last active administrator account.',
            409,
            'LAST_ADMIN_LOCKOUT_PREVENTED'
          );
        }
      }

      if (nextEmail !== current.email) {
        const emailCheck = await client.query<{ id: string }>(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2`,
          [nextEmail, userId]
        );
        if (emailCheck.rows.length > 0) {
          throw new AppError(`Email '${nextEmail}' is already assigned to another account.`, 409, 'EMAIL_IN_USE');
        }
      }

      // Fetch current groups & tenants if patch omits them, so invariants still hold on type/role change
      const curGroupsRes = await client.query<{ group_id: string }>(
        `SELECT group_id FROM user_groups WHERE user_id = $1`,
        [userId]
      );
      const curTenantsRes = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM user_tenants WHERE user_id = $1`,
        [userId]
      );

      const nextGroups =
        patch.groups !== undefined
          ? dedupeStrings(patch.groups)
          : curGroupsRes.rows.map((r) => r.group_id);
      const nextTenants =
        patch.tenant_scope !== undefined
          ? dedupeStrings(patch.tenant_scope)
          : curTenantsRes.rows.map((r) => r.tenant_id);

      await validateGroupsForUser(client, nextGroups, nextUserType);
      await validateTenantsForUser(client, nextTenants, nextUserType);

      await client.query(
        `
        UPDATE users
        SET name = $1, email = $2, role = $3, user_type = $4, status = $5, updated_at = NOW()
        WHERE id = $6
        `,
        [nextName, nextEmail, nextRole, nextUserType, nextStatus, userId]
      );

      if (patch.groups !== undefined) {
        await client.query(`DELETE FROM user_groups WHERE user_id = $1`, [userId]);
        for (const groupId of nextGroups) {
          await client.query(
            `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`,
            [userId, groupId]
          );
        }
      }

      if (patch.tenant_scope !== undefined) {
        await client.query(`DELETE FROM user_tenants WHERE user_id = $1`, [userId]);
        for (const tenantId of nextTenants) {
          await client.query(
            `INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2)`,
            [userId, tenantId]
          );
        }
      }

      const actionName =
        patch.status !== undefined && patch.status !== current.status
          ? 'admin.user.status_changed'
          : patch.role !== undefined && patch.role !== current.role
            ? 'admin.user.role_changed'
            : 'admin.user.updated';

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: actionName,
          targetType: 'user',
          targetId: userId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            previous_role: current.role,
            new_role: nextRole,
            previous_status: current.status,
            new_status: nextStatus,
            groups_updated: patch.groups !== undefined,
            tenants_updated: patch.tenant_scope !== undefined,
          },
        },
        client
      );

      await client.query('COMMIT');
      return await this.getUserById(userId);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Already rolled back
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async resetUserPassword(
    actor: AuthenticatedUser,
    userId: string,
    newPassword: unknown,
    reqMeta: RequestAuditMeta
  ): Promise<void> {
    const validatedPassword = validatePasswordStrength(newPassword);
    const passwordHash = await authService.hashPassword(validatedPassword);

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const res = await client.query<{ id: string; email: string }>(
        `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email`,
        [passwordHash, userId]
      );

      if (res.rows.length === 0) {
        throw new AppError(`User '${userId}' not found.`, 404, 'USER_NOT_FOUND');
      }

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.user.password_reset',
          targetType: 'user',
          targetId: userId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            target_email: res.rows[0].email,
          },
        },
        client
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listRoles(): Promise<(RoleDefinition & { user_count: number; active_user_count: number })[]> {
    const countsRes = await query<{
      role: string;
      user_count: string;
      active_user_count: string;
    }>(`
      SELECT
        role,
        COUNT(*)::text AS user_count,
        COUNT(*) FILTER (WHERE status = 'active')::text AS active_user_count
      FROM users
      GROUP BY role
    `);

    const countMap = new Map<string, { total: number; active: number }>();
    for (const r of countsRes.rows) {
      countMap.set(r.role, {
        total: parseInt(r.user_count, 10),
        active: parseInt(r.active_user_count, 10),
      });
    }

    return ROLE_CATALOG.map((def) => {
      const counts = countMap.get(def.role) || { total: 0, active: 0 };
      return {
        ...def,
        user_count: counts.total,
        active_user_count: counts.active,
      };
    });
  }

  async listGroups(): Promise<
    {
      id: string;
      name: string;
      description: string | null;
      created_at: string;
      member_count: number;
      members: { id: string; name: string; email: string; role: string; user_type: string; status: string }[];
    }[]
  > {
    const groupsRes = await query<{
      id: string;
      name: string;
      description: string | null;
      created_at: string;
    }>(`SELECT id, name, description, created_at FROM groups ORDER BY id ASC`);

    const membersRes = await query<{
      group_id: string;
      id: string;
      name: string;
      email: string;
      role: string;
      user_type: string;
      status: string;
    }>(`
      SELECT ug.group_id, u.id, u.name, u.email, u.role, u.user_type, u.status
      FROM user_groups ug
      JOIN users u ON ug.user_id = u.id
      ORDER BY u.name ASC
    `);

    const membersByGroup = new Map<
      string,
      { id: string; name: string; email: string; role: string; user_type: string; status: string }[]
    >();
    for (const row of membersRes.rows) {
      const list = membersByGroup.get(row.group_id) || [];
      list.push({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        user_type: row.user_type,
        status: row.status,
      });
      membersByGroup.set(row.group_id, list);
    }

    return groupsRes.rows.map((g) => {
      const members = membersByGroup.get(g.id) || [];
      return {
        ...g,
        member_count: members.length,
        members,
      };
    });
  }

  async createGroup(
    actor: AuthenticatedUser,
    input: { id: string; name: string; description?: string },
    reqMeta: RequestAuditMeta
  ) {
    const id = (input.id || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,50}$/.test(id)) {
      throw new AppError(
        'Group ID must be 3-50 lowercase letters, numbers, or underscores (e.g. grp_compliance).',
        400,
        'INVALID_GROUP_ID'
      );
    }
    const name = (input.name || '').trim();
    if (name.length < 2) {
      throw new AppError('Group name must be at least 2 characters.', 400, 'INVALID_GROUP_NAME');
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(`SELECT id FROM groups WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        throw new AppError(`Group '${id}' already exists.`, 409, 'GROUP_ALREADY_EXISTS');
      }

      const res = await client.query(
        `INSERT INTO groups (id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
        [id, name, (input.description || '').trim() || null]
      );

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.group.created',
          targetType: 'group',
          targetId: id,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: { name },
        },
        client
      );

      await client.query('COMMIT');
      return { ...res.rows[0], member_count: 0, members: [] };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateGroup(
    actor: AuthenticatedUser,
    groupId: string,
    patch: { name?: string; description?: string },
    reqMeta: RequestAuditMeta
  ) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: string; name: string; description: string | null }>(
        `SELECT id, name, description FROM groups WHERE id = $1`,
        [groupId]
      );
      if (existing.rows.length === 0) {
        throw new AppError(`Group '${groupId}' not found.`, 404, 'GROUP_NOT_FOUND');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : existing.rows[0].name;
      if (nextName.length < 2) {
        throw new AppError('Group name must be at least 2 characters.', 400, 'INVALID_GROUP_NAME');
      }
      const nextDescription =
        patch.description !== undefined
          ? patch.description.trim() || null
          : existing.rows[0].description;

      await client.query(`UPDATE groups SET name = $1, description = $2 WHERE id = $3`, [
        nextName,
        nextDescription,
        groupId,
      ]);

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.group.updated',
          targetType: 'group',
          targetId: groupId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: { name: nextName },
        },
        client
      );

      await client.query('COMMIT');
      const all = await this.listGroups();
      return all.find((g) => g.id === groupId)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setGroupMembers(
    actor: AuthenticatedUser,
    groupId: string,
    userIdsInput: unknown,
    reqMeta: RequestAuditMeta
  ) {
    const userIds = dedupeStrings(userIdsInput);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const grpRes = await client.query<{ id: string }>(`SELECT id FROM groups WHERE id = $1`, [groupId]);
      if (grpRes.rows.length === 0) {
        throw new AppError(`Group '${groupId}' not found.`, 404, 'GROUP_NOT_FOUND');
      }

      if (userIds.length > 0) {
        const usersRes = await client.query<{ id: string; user_type: UserType; email: string }>(
          `SELECT id, user_type, email FROM users WHERE id = ANY($1::varchar[])`,
          [userIds]
        );
        const foundMap = new Map(usersRes.rows.map((u) => [u.id, u]));
        const missing = userIds.filter((id) => !foundMap.has(id));
        if (missing.length > 0) {
          throw new AppError(`Unknown user ID(s): ${missing.join(', ')}`, 400, 'INVALID_USER');
        }

        if (!isCustomerPermittedGroup(groupId)) {
          const customerViolations = usersRes.rows
            .filter((u) => u.user_type === 'customer_user')
            .map((u) => u.id);
          if (customerViolations.length > 0) {
            throw new AppError(
              `Privilege escalation blocked: customer_user account(s) (${customerViolations.join(', ')}) cannot join internal or restricted group '${groupId}'.`,
              400,
              'PRIVILEGE_ESCALATION_BLOCKED'
            );
          }
        }
      }

      const prevMembersRes = await client.query<{ user_id: string }>(
        `SELECT user_id FROM user_groups WHERE group_id = $1`,
        [groupId]
      );
      const prevSet = new Set(prevMembersRes.rows.map((r) => r.user_id));
      const nextSet = new Set(userIds);

      const added = userIds.filter((id) => !prevSet.has(id));
      const removed = [...prevSet].filter((id) => !nextSet.has(id));

      await client.query(`DELETE FROM user_groups WHERE group_id = $1`, [groupId]);
      for (const uid of userIds) {
        await client.query(
          `INSERT INTO user_groups (user_id, group_id) VALUES ($1, $2)`,
          [uid, groupId]
        );
      }

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.group.members_updated',
          targetType: 'group',
          targetId: groupId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            added,
            removed,
            total_members: userIds.length,
          },
        },
        client
      );

      await client.query('COMMIT');
      const all = await this.listGroups();
      return all.find((g) => g.id === groupId)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listTenants() {
    const res = await query<{
      id: string;
      name: string;
      status: string;
      created_at: string;
      user_count: string;
      document_count: string;
    }>(`
      SELECT
        t.id,
        t.name,
        t.status,
        t.created_at,
        (SELECT COUNT(DISTINCT ut.user_id)::text FROM user_tenants ut WHERE ut.tenant_id = t.id) AS user_count,
        (SELECT COUNT(DISTINCT dp.document_id)::text FROM document_permissions dp WHERE dp.tenant_id = t.id) AS document_count
      FROM tenants t
      ORDER BY CASE WHEN t.id = 'global' THEN 0 ELSE 1 END, t.id ASC
    `);

    return res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      created_at: r.created_at,
      user_count: parseInt(r.user_count || '0', 10),
      document_count: parseInt(r.document_count || '0', 10),
    }));
  }

  async createTenant(
    actor: AuthenticatedUser,
    input: { id: string; name: string; status?: string },
    reqMeta: RequestAuditMeta
  ) {
    const id = (input.id || '').trim().toLowerCase();
    if (!/^ten_[a-z0-9_]{2,45}$/.test(id)) {
      throw new AppError(
        'Tenant ID must start with "ten_" followed by 2-45 lowercase letters, numbers, or underscores.',
        400,
        'INVALID_TENANT_ID'
      );
    }
    const name = (input.name || '').trim();
    if (name.length < 2) {
      throw new AppError('Tenant name must be at least 2 characters.', 400, 'INVALID_TENANT_NAME');
    }
    const status = (input.status || 'active').trim();
    if (!VALID_TENANT_STATUSES.has(status)) {
      throw new AppError('Invalid tenant status.', 400, 'INVALID_TENANT_STATUS');
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query(`SELECT id FROM tenants WHERE id = $1`, [id]);
      if (existing.rows.length > 0) {
        throw new AppError(`Tenant '${id}' already exists.`, 409, 'TENANT_ALREADY_EXISTS');
      }

      await client.query(
        `INSERT INTO tenants (id, name, status) VALUES ($1, $2, $3)`,
        [id, name, status]
      );

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.tenant.created',
          targetType: 'tenant',
          targetId: id,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: { name, status },
        },
        client
      );

      await client.query('COMMIT');
      const all = await this.listTenants();
      return all.find((t) => t.id === id)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async updateTenant(
    actor: AuthenticatedUser,
    tenantId: string,
    patch: { name?: string; status?: string },
    reqMeta: RequestAuditMeta
  ) {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: string; name: string; status: string }>(
        `SELECT id, name, status FROM tenants WHERE id = $1`,
        [tenantId]
      );
      if (existing.rows.length === 0) {
        throw new AppError(`Tenant '${tenantId}' not found.`, 404, 'TENANT_NOT_FOUND');
      }

      const nextName = patch.name !== undefined ? patch.name.trim() : existing.rows[0].name;
      if (nextName.length < 2) {
        throw new AppError('Tenant name must be at least 2 characters.', 400, 'INVALID_TENANT_NAME');
      }
      const nextStatus = patch.status !== undefined ? patch.status.trim() : existing.rows[0].status;
      if (!VALID_TENANT_STATUSES.has(nextStatus)) {
        throw new AppError('Invalid tenant status.', 400, 'INVALID_TENANT_STATUS');
      }

      if (tenantId === 'global' && nextStatus !== 'active') {
        throw new AppError(
          "The system 'global' tenant cannot be suspended or archived.",
          400,
          'CANNOT_DISABLE_GLOBAL_TENANT'
        );
      }

      await client.query(`UPDATE tenants SET name = $1, status = $2 WHERE id = $3`, [
        nextName,
        nextStatus,
        tenantId,
      ]);

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.tenant.updated',
          targetType: 'tenant',
          targetId: tenantId,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: { name: nextName, status: nextStatus },
        },
        client
      );

      await client.query('COMMIT');
      const all = await this.listTenants();
      return all.find((t) => t.id === tenantId)!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const adminIdentityService = new AdminIdentityService();

