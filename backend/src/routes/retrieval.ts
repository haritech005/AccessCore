import { Router, Request, Response, NextFunction } from 'express';
import { retrievalService } from '../services/retrievalService';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Enforce authentication on all retrieval endpoints
router.use('/retrieval', requireAuth);

/**
 * Resolves authoritative tenant and group scope for the authenticated user,
 * preventing client-side privilege escalation.
 */
function resolveAuthoritativeScope(
  req: Request,
  clientTenantScope?: unknown
): { effectiveTenantScope?: string[]; effectiveUserGroups: string[] } {
  const user = req.user!;
  const effectiveUserGroups = user.groups;

  let effectiveTenantScope: string[] | undefined;
  if (user.has_wildcard_tenant) {
    effectiveTenantScope =
      Array.isArray(clientTenantScope) && clientTenantScope.length > 0
        ? (clientTenantScope as string[])
        : undefined;
  } else {
    if (Array.isArray(clientTenantScope) && clientTenantScope.length > 0) {
      effectiveTenantScope = (clientTenantScope as string[]).filter((t) =>
        user.tenant_scope.includes(t)
      );
    } else {
      effectiveTenantScope = user.tenant_scope;
    }
  }

  return { effectiveTenantScope, effectiveUserGroups };
}

/**
 * POST /api/retrieval
 * Semantic vector retrieval using pgvector cosine distance.
 * Returns top-k matching chunks with similarity scores and citation metadata.
 */
router.post(
  '/retrieval',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query: userQuery, top_k, min_similarity, tenant_scope } = req.body;

      if (!userQuery || typeof userQuery !== 'string') {
        throw new AppError('Field \'query\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await retrievalService.retrieveChunks({
        query: userQuery,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

// Alias: POST /api/retrieval/search
router.post(
  '/retrieval/search',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query: userQuery, top_k, min_similarity, tenant_scope } = req.body;

      if (!userQuery || typeof userQuery !== 'string') {
        throw new AppError('Field \'query\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await retrievalService.retrieveChunks({
        query: userQuery,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
