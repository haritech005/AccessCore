/**
 * AccessCore Phase 2 - Identity, Tenancy, and Access Control Types
 * Based on CloudDesk Company Blueprint (BP-0001) and phase-2-identity.md
 */

export type UserRole =
  | 'support_agent'
  | 'support_lead'
  | 'csm'
  | 'cs_manager'
  | 'engineer'
  | 'engineering_manager'
  | 'it_security_admin'
  | 'customer_user'
  | 'admin';

export type UserType = 'employee' | 'customer_user';

export type UserStatus = 'active' | 'inactive' | 'suspended';

export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'restricted';

export interface TenantRecord {
  id: string; // e.g. 'global', 'ten_brightwave', 'ten_harborpine', 'ten_lumenfield'
  name: string;
  status: 'active' | 'suspended' | 'archived';
  created_at: Date;
}

export interface GroupRecord {
  id: string; // e.g. 'grp_all_employees', 'grp_support', 'grp_customer_success'
  name: string;
  description?: string;
  created_at: Date;
}

export interface UserRecord {
  id: string; // e.g. 'emp_001', 'cu_001'
  email: string;
  name: string;
  role: UserRole;
  user_type: UserType;
  status: UserStatus;
  password_hash?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentPermissionRecord {
  id: string;
  document_id: string;
  tenant_id: string;
  allowed_groups: string[];
  sensitivity: SensitivityLevel;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Resolved, authenticated principal representation used throughout backend authorization.
 * Derived from verified sessions and database identity resolution.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  user_type: UserType;
  status: UserStatus;
  groups: string[]; // e.g. ['grp_all_employees', 'grp_support']
  tenant_scope: string[]; // e.g. ['ten_brightwave', 'ten_lumenfield'] or ['*']
  has_wildcard_tenant: boolean;
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface DocumentAccessTarget {
  document_id?: string;
  tenant_id: string;
  allowed_groups: string[];
  sensitivity?: SensitivityLevel;
  is_active?: boolean;
}

/**
 * Centralized authorization evaluation rule engine implementing Section 5.2 of the CloudDesk Blueprint:
 *
 * 1. User account must be active.
 * 2. Tenant check: document tenant is 'global' OR in user's tenant_scope (or user has '*').
 * 3. Group check: at least one of user's groups matches document's allowed_groups (or allowed_groups includes 'grp_public').
 * 4. Restricted check: if sensitivity is 'restricted', broad groups (grp_all_employees, grp_public) are not sufficient.
 * 5. Default-deny: Any failure results in denial.
 */
export function evaluateDocumentAccess(
  user: AuthenticatedUser,
  doc: DocumentAccessTarget
): PermissionCheckResult {
  // 1. Account status check
  if (user.status !== 'active') {
    return {
      allowed: false,
      reason: `User account is ${user.status} (must be active)`,
    };
  }

  // 2. Active document check (if document version/state is specified)
  if (doc.is_active === false) {
    return {
      allowed: false,
      reason: 'Document version is inactive or unarchived',
    };
  }

  // 3. Tenant scope check
  const isGlobalDoc = doc.tenant_id === 'global';
  const hasTenantAccess =
    isGlobalDoc ||
    user.has_wildcard_tenant ||
    user.tenant_scope.includes('*') ||
    user.tenant_scope.includes(doc.tenant_id);

  if (!hasTenantAccess) {
    return {
      allowed: false,
      reason: `Tenant access denied: user tenant scope does not include '${doc.tenant_id}'`,
    };
  }

  // Customer user protection: customer users can NEVER access documents from another tenant
  if (user.user_type === 'customer_user' && !isGlobalDoc && !user.tenant_scope.includes(doc.tenant_id)) {
    return {
      allowed: false,
      reason: 'Customer user isolated to assigned tenant only',
    };
  }

  // 4. Restricted sensitivity verification (strict security clearance barrier)
  if (doc.sensitivity === 'restricted') {
    const hasRestrictedClearance =
      user.groups.includes('grp_security_restricted') ||
      user.groups.includes('grp_incident_review');

    if (!hasRestrictedClearance) {
      return {
        allowed: false,
        reason: 'Restricted sensitivity requires explicit security clearance (grp_security_restricted or grp_incident_review)',
      };
    }
  }

  // 5. Group access check
  const docGroups = doc.allowed_groups || [];
  
  // Public document check (accessible to anyone if in valid tenant scope)
  const isPublicDoc = docGroups.includes('grp_public');
  
  const hasMatchingGroup =
    isPublicDoc ||
    user.groups.some((grp) => docGroups.includes(grp));

  if (!hasMatchingGroup) {
    return {
      allowed: false,
      reason: `Group access denied: user groups [${user.groups.join(', ')}] do not match document allowed groups [${docGroups.join(', ')}]`,
    };
  }

  return { allowed: true };
}
