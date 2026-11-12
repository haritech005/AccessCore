import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, requireAdmin, verifyAdminCsrf } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { adminIdentityService } from '../services/adminIdentityService';
import { adminDocumentService } from '../services/adminDocumentService';

function extractAuditMeta(req: Request) {
  const correlationId =
    (typeof req.headers['x-request-id'] === 'string' && req.headers['x-request-id']) ||
    (typeof req.headers['x-correlation-id'] === 'string' && req.headers['x-correlation-id']) ||
    null;
  const ipAddress = req.ip || req.socket.remoteAddress || null;
  return { correlationId, ipAddress };
}

const router = Router();

/**
 * Enforce strict server-side authentication, admin authorization, and CSRF origin checks
 * across EVERY administrative route before any endpoint handler or 404 can execute.
 */
router.use(requireAuth, requireAdmin, verifyAdminCsrf);

/**
 * GET /api/admin/access-check
 * Server-authoritative verification of the current administrator session and capabilities.
 */
router.get('/access-check', (req: Request, res: Response): void => {
  const admin = req.user!;
  res.status(200).json({
    success: true,
    data: {
      authorized: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
        user_type: admin.user_type,
        groups: admin.groups,
      },
      capabilities: {
        can_manage_users: true,
        can_manage_roles: true,
        can_manage_documents: true,
        can_ingest: true,
        can_view_audit_logs: true,
      },
    },
  });
});

/**
 * GET /api/admin/overview
 * Returns live system statistics, security posture metrics, and recent ingestion statuses.
 * Strictly excludes password hashes, raw chunk text, and private prompt contents.
 */
router.get(
  '/overview',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [
        usersAgg,
        groupsCount,
        tenantsCount,
        docsAgg,
        chunksCount,
        jobsAgg,
        conversationsCount,
        recentJobsRes,
      ] = await Promise.all([
        query<{
          total: string;
          active: string;
          disabled: string;
          admins: string;
          customers: string;
        }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'active')::text AS active,
            COUNT(*) FILTER (WHERE status <> 'active')::text AS disabled,
            COUNT(*) FILTER (WHERE role IN ('admin', 'it_security_admin') AND status = 'active')::text AS admins,
            COUNT(*) FILTER (WHERE user_type = 'customer_user')::text AS customers
          FROM users
        `),
        query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM groups`),
        query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tenants`),
        query<{
          total: string;
          completed: string;
          pending_or_processing: string;
          failed: string;
        }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
            COUNT(*) FILTER (WHERE status IN ('pending', 'processing'))::text AS pending_or_processing,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
          FROM documents
        `),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM document_chunks WHERE is_active = true`
        ),
        query<{
          total: string;
          completed: string;
          failed: string;
          in_progress: string;
        }>(`
          SELECT
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
            COUNT(*) FILTER (WHERE status NOT IN ('completed', 'failed'))::text AS in_progress
          FROM ingestion_jobs
        `),
        query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM conversations`),
        query<{
          id: string;
          document_code: string;
          title: string;
          status: string;
          error_message: string | null;
          started_at: string;
          completed_at: string | null;
        }>(`
          SELECT
            j.id,
            d.document_id AS document_code,
            d.title,
            j.status,
            j.error_message,
            j.started_at,
            j.completed_at
          FROM ingestion_jobs j
          JOIN documents d ON j.document_id = d.id
          ORDER BY j.started_at DESC
          LIMIT 5
        `),
      ]);

      const u = usersAgg.rows[0];
      const d = docsAgg.rows[0];
      const j = jobsAgg.rows[0];

      res.status(200).json({
        success: true,
        data: {
          admin: {
            id: req.user!.id,
            name: req.user!.name,
            email: req.user!.email,
            role: req.user!.role,
          },
          metrics: {
            users: {
              total: parseInt(u?.total || '0', 10),
              active: parseInt(u?.active || '0', 10),
              disabled: parseInt(u?.disabled || '0', 10),
              admins: parseInt(u?.admins || '0', 10),
              customers: parseInt(u?.customers || '0', 10),
            },
            groups: parseInt(groupsCount.rows[0]?.count || '0', 10),
            tenants: parseInt(tenantsCount.rows[0]?.count || '0', 10),
            documents: {
              total: parseInt(d?.total || '0', 10),
              completed: parseInt(d?.completed || '0', 10),
              pending_or_processing: parseInt(d?.pending_or_processing || '0', 10),
              failed: parseInt(d?.failed || '0', 10),
              active_chunks: parseInt(chunksCount.rows[0]?.count || '0', 10),
            },
            ingestion_jobs: {
              total: parseInt(j?.total || '0', 10),
              completed: parseInt(j?.completed || '0', 10),
              failed: parseInt(j?.failed || '0', 10),
              in_progress: parseInt(j?.in_progress || '0', 10),
            },
            conversations: parseInt(conversationsCount.rows[0]?.count || '0', 10),
          },
          recent_ingestion_jobs: recentJobsRes.rows,
          security_posture: {
            server_guard: 'requireAuth + requireAdmin',
            csrf_protection: 'Origin + SameSite verification active',
            tenant_isolation: 'Database-level & RBAC/ABAC pre-filtering active',
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * =========================================================================
 * Subphase 5.4 — User, Role, Group, and Tenant Management Routes
 * =========================================================================
 */

/**
 * GET /api/admin/users
 * Paginated, filterable user directory (never returns password hashes).
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminIdentityService.listUsers({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      role: typeof req.query.role === 'string' ? req.query.role : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      user_type: typeof req.query.user_type === 'string' ? req.query.user_type : undefined,
      group: typeof req.query.group === 'string' ? req.query.group : undefined,
      tenant: typeof req.query.tenant === 'string' ? req.query.tenant : undefined,
      page: typeof req.query.page === 'string' ? parseInt(req.query.page, 10) : 1,
      limit: typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 25,
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users
 * Create a new user account with validated role, group, and tenant boundaries.
 */
router.post('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const created = await adminIdentityService.createUser(
      req.user!,
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(201).json({ success: true, data: { user: created } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id
 * Fetch user profile + server-computed effective access inspection.
 */
router.get('/users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = String(req.params.id);
    const [user, effectiveAccess] = await Promise.all([
      adminIdentityService.getUserById(userId),
      adminIdentityService.getUserEffectiveAccess(userId),
    ]);
    res.status(200).json({
      success: true,
      data: { user, effective_access: effectiveAccess },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id/effective-access
 * Dedicated endpoint to inspect effective tenants, clearances, and accessible documents.
 */
router.get(
  '/users/:id/effective-access',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const effectiveAccess = await adminIdentityService.getUserEffectiveAccess(
        String(req.params.id)
      );
      res.status(200).json({ success: true, data: { effective_access: effectiveAccess } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/admin/users/:id
 * Update user profile, role, status, groups, or tenant scope with lockout & escalation guards.
 */
router.patch('/users/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = String(req.params.id);
    const updated = await adminIdentityService.updateUser(
      req.user!,
      userId,
      req.body || {},
      extractAuditMeta(req)
    );
    const effectiveAccess = await adminIdentityService.getUserEffectiveAccess(userId);
    res.status(200).json({
      success: true,
      data: { user: updated, effective_access: effectiveAccess },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/users/:id/reset-password
 * Securely resets a user's password hash without returning or logging secrets.
 */
router.post(
  '/users/:id/reset-password',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await adminIdentityService.resetUserPassword(
        req.user!,
        String(req.params.id),
        req.body?.password,
        extractAuditMeta(req)
      );
      res.status(200).json({
        success: true,
        data: { message: 'User password reset successfully.' },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/roles
 * Lists available roles, associated permissions, boundary notes, and user counts.
 */
router.get('/roles', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const roles = await adminIdentityService.listRoles();
    res.status(200).json({ success: true, data: { roles } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/groups
 * Lists all security groups with member counts and member summaries.
 */
router.get('/groups', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const groups = await adminIdentityService.listGroups();
    res.status(200).json({ success: true, data: { groups } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/groups
 * Creates a new security group.
 */
router.post('/groups', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const group = await adminIdentityService.createGroup(
      req.user!,
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(201).json({ success: true, data: { group } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/groups/:id
 * Updates a group's name or description.
 */
router.patch('/groups/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const group = await adminIdentityService.updateGroup(
      req.user!,
      String(req.params.id),
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(200).json({ success: true, data: { group } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/groups/:id/members
 * Atomically replaces member list for a group while enforcing privilege escalation checks.
 */
router.put(
  '/groups/:id/members',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const group = await adminIdentityService.setGroupMembers(
        req.user!,
        String(req.params.id),
        req.body?.user_ids,
        extractAuditMeta(req)
      );
      res.status(200).json({ success: true, data: { group } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/admin/tenants
 * Lists configured tenants along with assigned user and document counts.
 */
router.get('/tenants', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenants = await adminIdentityService.listTenants();
    res.status(200).json({ success: true, data: { tenants } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/tenants
 * Creates a new customer tenant boundary.
 */
router.post('/tenants', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await adminIdentityService.createTenant(
      req.user!,
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(201).json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/tenants/:id
 * Updates a tenant's display name or lifecycle status.
 */
router.patch('/tenants/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenant = await adminIdentityService.updateTenant(
      req.user!,
      String(req.params.id),
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(200).json({ success: true, data: { tenant } });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/documents
 * Lists document governance metadata with search, filter, and pagination.
 */
router.get('/documents', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminDocumentService.listDocuments({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      tenant: typeof req.query.tenant === 'string' ? req.query.tenant : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      sensitivity: typeof req.query.sensitivity === 'string' ? req.query.sensitivity : undefined,
      disclosure_policy:
        typeof req.query.disclosure_policy === 'string' ? req.query.disclosure_policy : undefined,
      document_type:
        typeof req.query.document_type === 'string' ? req.query.document_type : undefined,
      is_active: typeof req.query.is_active === 'string' ? req.query.is_active : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25,
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/documents/upload
 * Admin-only document upload with strict format, size, and ACL validation.
 */
router.post('/documents/upload', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await adminDocumentService.uploadDocument(
      req.user!,
      req.body || {},
      extractAuditMeta(req)
    );
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/documents/:id
 * Returns full document governance metadata, versions, effective access preview, and audit history.
 */
router.get('/documents/:id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const detail = await adminDocumentService.getDocumentDetail(String(req.params.id));
    res.status(200).json({ success: true, data: detail });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/documents/:id/permissions
 * Atomically updates document permissions, synced chunk metadata, and optional approved summary.
 */
router.patch(
  '/documents/:id/permissions',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const detail = await adminDocumentService.updateDocumentPermissions(
        req.user!,
        String(req.params.id),
        req.body || {},
        extractAuditMeta(req)
      );
      res.status(200).json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/admin/documents/:id/archive
 * Archives or restores a document and immediately toggles active retrieval chunk eligibility.
 */
router.post(
  '/documents/:id/archive',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (typeof req.body?.is_active !== 'boolean') {
        throw new AppError(
          'Explicit boolean field "is_active" is required to archive or restore a document.',
          400,
          'INVALID_ARCHIVE_STATE'
        );
      }

      const detail = await adminDocumentService.updateDocumentPermissions(
        req.user!,
        String(req.params.id),
        { is_active: req.body.is_active },
        extractAuditMeta(req)
      );
      res.status(200).json({ success: true, data: detail });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Catch-all inside adminRouter: guarantees unauthorized callers to unknown /api/admin/* paths
 * already got 401/403 from router.use(...) before reaching 404.
 */
router.use((_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Administrative endpoint not found.',
    },
  });
});

export default router;

