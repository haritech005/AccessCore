import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db';
import { requireAuth, requireAdmin, verifyAdminCsrf } from '../middleware/auth';

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

