import { query } from '../db';
import {
  AuthenticatedUser,
  DocumentAccessTarget,
  PermissionCheckResult,
  SensitivityLevel,
} from '../types/identity';
import { DocumentRecord } from '../types/document';

/**
 * Supported authorization actions across the AccessCore platform.
 */
export type AuthzAction =
  | 'read:document'
  | 'download:document'
  | 'preview:document'
  | 'search:retrieval'
  | 'ingest:document'
  | 'read:citation'
  | 'read:tenant'
  | 'manage:tenant'
  | 'admin:manage';

export type ResourceType = 'document' | 'chunk' | 'citation' | 'tenant' | 'ingestion_job';

export interface DocumentResource {
  type: 'document';
  id?: string;
  document_id?: string;
  tenant_id: string;
  allowed_groups: string[];
  sensitivity: SensitivityLevel;
  is_active?: boolean;
  status?: string;
}

export interface ChunkResource {
  type: 'chunk';
  id?: string;
  document_id: string;
  tenant_id: string;
  allowed_groups: string[];
  sensitivity: SensitivityLevel;
  is_active?: boolean;
}

export interface CitationResource {
  type: 'citation';
  document_id: string;
  tenant_id: string;
  sensitivity: SensitivityLevel;
  allowed_groups?: string[];
}

export interface TenantResource {
  type: 'tenant';
  id: string;
}

export interface IngestionJobResource {
  type: 'ingestion_job';
  id: string;
  tenant_id?: string;
}

export type AuthzResource =
  | DocumentResource
  | ChunkResource
  | CitationResource
  | TenantResource
  | IngestionJobResource;

export interface AuthorizationContext {
  active_tenant_id?: string;
  client_ip?: string;
  request_id?: string;
}

/**
 * AccessCore Subphase 2.5 — Central Authorization Service
 *
 * Implements centralized, reusable authorization policy evaluation (ABAC + RBAC)
 * adhering to CloudDesk Company Blueprint (BP-0001, Section 5.2) and phase-2-identity.md.
 *
 * Core evaluation: "Can user U perform action A on resource R in tenant context T?"
 */
export class AuthorizationService {
  /**
   * Helper: Determines if user possesses restricted security clearance.
   * Clearance requires explicit membership in grp_security_restricted or grp_incident_review.
   * Broad groups (grp_all_employees, grp_public) or wildcard tenant scope '*' DO NOT grant clearance.
   */
  hasRestrictedClearance(user: AuthenticatedUser): boolean {
    if (!user || user.status !== 'active') return false;
    return (
      user.groups.includes('grp_security_restricted') ||
      user.groups.includes('grp_incident_review')
    );
  }

  /**
   * Evaluates if user has permission to access an explicit tenant context.
   */
  authorizeTenantContext(user: AuthenticatedUser, tenantId: string): PermissionCheckResult {
    if (user.status !== 'active') {
      return {
        allowed: false,
        reason: `User account is ${user.status} (must be active)`,
      };
    }

    if (!tenantId || tenantId === 'global') {
      return { allowed: true };
    }

    // Customer users are strictly restricted to their single assigned tenant
    if (user.user_type === 'customer_user') {
      if (user.tenant_scope.includes(tenantId)) {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: `Customer user cannot access external tenant '${tenantId}'`,
      };
    }

    // Employees can access tenants in their scope or all tenants if they have wildcard access
    if (
      user.has_wildcard_tenant ||
      user.tenant_scope.includes('*') ||
      user.tenant_scope.includes(tenantId)
    ) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Tenant access denied: '${tenantId}' is not in user's tenant scope`,
    };
  }

  /**
   * Validates and narrows tenant scope for retrieval or queries.
   */
  getEffectiveTenantScope(user: AuthenticatedUser, requestedTenant?: string): string[] {
    if (user.status !== 'active') return [];

    if (requestedTenant && requestedTenant !== 'global') {
      const authz = this.authorizeTenantContext(user, requestedTenant);
      if (!authz.allowed) {
        return [];
      }
      return [requestedTenant];
    }

    return user.tenant_scope;
  }

  /**
   * Central policy evaluation method.
   * "Can user U perform action A on resource R in tenant context T?"
   */
  can(
    user: AuthenticatedUser,
    action: AuthzAction,
    resource: AuthzResource,
    context?: AuthorizationContext
  ): PermissionCheckResult {
    // 1. Default-Deny: Missing inputs
    if (!user || !action || !resource) {
      return { allowed: false, reason: 'Default deny: Missing user, action, or resource' };
    }

    // 2. Account Status Guard: Inactive / suspended accounts denied across all operations
    if (user.status !== 'active') {
      return {
        allowed: false,
        reason: `User account is ${user.status} (must be active)`,
      };
    }

    // 3. Active Tenant Context Check (if specified in request context)
    if (context?.active_tenant_id) {
      const tenantAuthz = this.authorizeTenantContext(user, context.active_tenant_id);
      if (!tenantAuthz.allowed) {
        return tenantAuthz;
      }
    }

    // 4. Resource-Specific & Action-Specific Evaluation
    switch (resource.type) {
      case 'document':
      case 'chunk':
      case 'citation':
        return this.evaluateDocumentLikeResource(user, action, resource);

      case 'tenant':
        return this.evaluateTenantResource(user, action, resource);

      case 'ingestion_job':
        return this.evaluateIngestionJobResource(user, action, resource);

      default:
        return {
          allowed: false,
          reason: `Default deny: Unrecognized resource type '${(resource as { type: string }).type}'`,
        };
    }
  }

  /**
   * Reusable evaluation for documents, chunks, and citations.
   */
  private evaluateDocumentLikeResource(
    user: AuthenticatedUser,
    action: AuthzAction,
    resource: DocumentResource | ChunkResource | CitationResource
  ): PermissionCheckResult {
    // A. Action validation
    const allowedActions: AuthzAction[] = [
      'read:document',
      'download:document',
      'preview:document',
      'search:retrieval',
      'read:citation',
    ];

    if (!allowedActions.includes(action)) {
      return {
        allowed: false,
        reason: `Default deny: Action '${action}' is not supported on document resources`,
      };
    }

    // B. Lifecycle / Active status check
    if ('is_active' in resource && resource.is_active === false) {
      return {
        allowed: false,
        reason: 'Document resource version is inactive or archived',
      };
    }

    if ('status' in resource && resource.status && resource.status !== 'completed') {
      return {
        allowed: false,
        reason: `Document resource is not in completed state (status: ${resource.status})`,
      };
    }

    // C. Tenant scope check
    const isGlobal = resource.tenant_id === 'global';
    const hasTenant =
      isGlobal ||
      user.has_wildcard_tenant ||
      user.tenant_scope.includes('*') ||
      user.tenant_scope.includes(resource.tenant_id);

    if (!hasTenant) {
      return {
        allowed: false,
        reason: `Tenant access denied: resource tenant '${resource.tenant_id}' is not in user's tenant scope`,
      };
    }

    // Customer user strict quarantine: customer users can NEVER access another customer tenant
    if (
      user.user_type === 'customer_user' &&
      !isGlobal &&
      !user.tenant_scope.includes(resource.tenant_id)
    ) {
      return {
        allowed: false,
        reason: 'Customer user strictly isolated to assigned tenant',
      };
    }

    // D. Restricted sensitivity check (Strict Security Clearance Barrier)
    if (resource.sensitivity === 'restricted') {
      const hasClearance = this.hasRestrictedClearance(user);
      if (!hasClearance) {
        return {
          allowed: false,
          reason:
            'Restricted sensitivity requires explicit security clearance (grp_security_restricted or grp_incident_review)',
        };
      }
    }

    // E. Group membership check
    const allowedGroups = resource.allowed_groups || [];
    const isPublic = allowedGroups.includes('grp_public');
    const hasMatchingGroup =
      isPublic ||
      user.groups.some((grp) => allowedGroups.includes(grp));

    if (!hasMatchingGroup) {
      return {
        allowed: false,
        reason: `Group access denied: user groups do not match document allowed groups`,
      };
    }

    // F. Action-specific rules (e.g. download rules)
    if (action === 'download:document') {
      // Customer users cannot download restricted documents under any circumstances
      if (user.user_type === 'customer_user' && resource.sensitivity === 'restricted') {
        return {
          allowed: false,
          reason: 'Customer users are not permitted to download restricted documents',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Evaluation for tenant resources.
   */
  private evaluateTenantResource(
    user: AuthenticatedUser,
    action: AuthzAction,
    resource: TenantResource
  ): PermissionCheckResult {
    if (action === 'read:tenant') {
      return this.authorizeTenantContext(user, resource.id);
    }

    if (action === 'manage:tenant' || action === 'admin:manage') {
      if (user.role === 'it_security_admin' || user.role === 'admin') {
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Tenant administration requires it_security_admin role',
      };
    }

    return { allowed: false, reason: `Default deny: Action '${action}' on tenant denied` };
  }

  /**
   * Evaluation for ingestion jobs.
   */
  private evaluateIngestionJobResource(
    user: AuthenticatedUser,
    action: AuthzAction,
    resource: IngestionJobResource
  ): PermissionCheckResult {
    if (user.user_type === 'customer_user') {
      return {
        allowed: false,
        reason: 'Customer users cannot access ingestion job diagnostics',
      };
    }

    if (resource.tenant_id) {
      return this.authorizeTenantContext(user, resource.tenant_id);
    }

    return { allowed: true };
  }

  /**
   * Authorizes document ingestion/upload action.
   */
  canIngest(user: AuthenticatedUser, targetTenantId?: string): PermissionCheckResult {
    if (user.status !== 'active') {
      return {
        allowed: false,
        reason: `User account is ${user.status} (must be active)`,
      };
    }

    if (user.user_type === 'customer_user') {
      return {
        allowed: false,
        reason: 'Customer users are not permitted to ingest documents',
      };
    }

    if (targetTenantId && targetTenantId !== 'global') {
      const tenantCheck = this.authorizeTenantContext(user, targetTenantId);
      if (!tenantCheck.allowed) {
        return tenantCheck;
      }
    }

    return { allowed: true };
  }

  /**
   * Adapts DocumentAccessTarget (legacy or route target) to can() evaluation.
   */
  authorizeDocument(
    user: AuthenticatedUser,
    doc: DocumentAccessTarget,
    action: AuthzAction = 'read:document',
    context?: AuthorizationContext
  ): PermissionCheckResult {
    return this.can(
      user,
      action,
      {
        type: 'document',
        document_id: doc.document_id,
        tenant_id: doc.tenant_id,
        allowed_groups: doc.allowed_groups,
        sensitivity: doc.sensitivity || 'internal',
        is_active: doc.is_active,
      },
      context
    );
  }

  /**
   * Authoritatively looks up a document by its document_id in PostgreSQL and evaluates access.
   */
  async authorizeDocumentById(
    user: AuthenticatedUser,
    documentId: string,
    action: AuthzAction = 'read:document'
  ): Promise<PermissionCheckResult & { document?: DocumentRecord }> {
    const res = await query<DocumentRecord>(
      'SELECT id, document_id, title, filename, format, current_version, status, metadata FROM documents WHERE document_id = $1',
      [documentId]
    );

    if (res.rows.length === 0) {
      return {
        allowed: false,
        reason: `Document '${documentId}' not found`,
      };
    }

    const doc = res.rows[0];
    const metadata = doc.metadata || {};

    const authz = this.can(user, action, {
      type: 'document',
      document_id: doc.document_id,
      tenant_id: (metadata.tenant_id as string) || 'global',
      allowed_groups: (metadata.allowed_groups as string[]) || [],
      sensitivity: (metadata.sensitivity as SensitivityLevel) || 'internal',
      status: doc.status,
    });

    return {
      allowed: authz.allowed,
      reason: authz.reason,
      document: authz.allowed ? doc : undefined,
    };
  }

  /**
   * Filters an array of documents against caller's authoritative permissions.
   */
  filterPermittedDocuments<T extends DocumentAccessTarget>(
    user: AuthenticatedUser,
    documents: T[],
    action: AuthzAction = 'read:document'
  ): T[] {
    return documents.filter((doc) => this.authorizeDocument(user, doc, action).allowed);
  }
}

export const authorizationService = new AuthorizationService();

