import { Router, Request, Response, NextFunction } from 'express';
import { ragService } from '../services/ragService';
import { AppError } from '../middleware/errorHandler';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Enforce authentication on all RAG query endpoints
router.use('/chat', requireAuth);
router.use('/rag', requireAuth);

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
 * POST /api/chat
 * Primary RAG endpoint: accepts question, retrieves grounded evidence, invokes local LLM,
 * validates citations, and returns grounded answer with source provenance.
 */
router.post(
  '/chat',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { question, top_k, min_similarity, tenant_scope, model } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await ragService.answerQuestion({
        question,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
        user: req.user,
        model: typeof model === 'string' ? model : undefined,
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

// Alias: POST /api/rag/query
router.post(
  '/rag/query',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { question, top_k, min_similarity, tenant_scope, model } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await ragService.answerQuestion({
        question,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
        user: req.user,
        model: typeof model === 'string' ? model : undefined,
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
