import { Router, Request, Response, NextFunction } from 'express';
import { ragService } from '../services/ragService';
import { traceService } from '../services/traceService';
import { conversationService } from '../services/conversationService';
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
      const {
        question,
        chat_history,
        condense_query,
        top_k,
        min_similarity,
        vector_candidates,
        fts_candidates,
        rrf_k,
        diversity_threshold,
        max_chunks_per_doc,
        tenant_scope,
        model,
        audience,
      } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await ragService.answerQuestion({
        question,
        chat_history: Array.isArray(chat_history) ? chat_history : undefined,
        condense_query: typeof condense_query === 'boolean' ? condense_query : undefined,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        vector_candidates: typeof vector_candidates === 'number' ? vector_candidates : undefined,
        fts_candidates: typeof fts_candidates === 'number' ? fts_candidates : undefined,
        rrf_k: typeof rrf_k === 'number' ? rrf_k : undefined,
        diversity_threshold: typeof diversity_threshold === 'number' ? diversity_threshold : undefined,
        max_chunks_per_doc: typeof max_chunks_per_doc === 'number' ? max_chunks_per_doc : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
        user: req.user,
        model: typeof model === 'string' ? model : undefined,
        audience: typeof audience === 'string' ? audience : undefined,
      });

      const conversationId =
        typeof req.body.conversation_id === 'string' ? req.body.conversation_id : undefined;

      // If conversation_id is provided, automatically persist user prompt and assistant response
      if (conversationId && req.user) {
        try {
          await conversationService.addMessage({
            conversationId,
            userId: req.user.id,
            role: 'user',
            content: question,
            autoTitle: true,
          });

          await conversationService.addMessage({
            conversationId,
            userId: req.user.id,
            role: 'assistant',
            content: result.answer,
            citations: result.citations,
            metadata: {
              audience: result.audience,
              insufficient_evidence: result.insufficient_evidence,
              unauthorized_access: result.unauthorized_access,
              policy_violated: result.policy_violated,
              latency_ms: result.latency_ms,
            },
          });
        } catch (saveErr) {
          console.warn('[RAG Router] Failed to persist message to conversation history:', saveErr);
        }
      }

      res.status(200).json({
        success: true,
        data: {
          ...result,
          conversation_id: conversationId,
        },
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
      const {
        question,
        chat_history,
        condense_query,
        top_k,
        min_similarity,
        vector_candidates,
        fts_candidates,
        rrf_k,
        diversity_threshold,
        max_chunks_per_doc,
        tenant_scope,
        model,
        audience,
      } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const { effectiveTenantScope, effectiveUserGroups } = resolveAuthoritativeScope(
        req,
        tenant_scope
      );

      const result = await ragService.answerQuestion({
        question,
        chat_history: Array.isArray(chat_history) ? chat_history : undefined,
        condense_query: typeof condense_query === 'boolean' ? condense_query : undefined,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        vector_candidates: typeof vector_candidates === 'number' ? vector_candidates : undefined,
        fts_candidates: typeof fts_candidates === 'number' ? fts_candidates : undefined,
        rrf_k: typeof rrf_k === 'number' ? rrf_k : undefined,
        diversity_threshold: typeof diversity_threshold === 'number' ? diversity_threshold : undefined,
        max_chunks_per_doc: typeof max_chunks_per_doc === 'number' ? max_chunks_per_doc : undefined,
        tenant_scope: effectiveTenantScope,
        user_groups: effectiveUserGroups,
        user: req.user,
        model: typeof model === 'string' ? model : undefined,
        audience: typeof audience === 'string' ? audience : undefined,
      });

      const conversationId =
        typeof req.body.conversation_id === 'string' ? req.body.conversation_id : undefined;

      // If conversation_id is provided, automatically persist user prompt and assistant response
      if (conversationId && req.user) {
        try {
          await conversationService.addMessage({
            conversationId,
            userId: req.user.id,
            role: 'user',
            content: question,
            autoTitle: true,
          });

          await conversationService.addMessage({
            conversationId,
            userId: req.user.id,
            role: 'assistant',
            content: result.answer,
            citations: result.citations,
            metadata: {
              audience: result.audience,
              insufficient_evidence: result.insufficient_evidence,
              unauthorized_access: result.unauthorized_access,
              policy_violated: result.policy_violated,
              latency_ms: result.latency_ms,
            },
          });
        } catch (saveErr) {
          console.warn('[RAG Router] Failed to persist message to conversation history:', saveErr);
        }
      }

      res.status(200).json({
        success: true,
        data: {
          ...result,
          conversation_id: conversationId,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

router.use('/traces', requireAuth);

/**
 * GET /api/rag/traces
 * List recent traces with pagination and access controls.
 */
router.get('/traces', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const allTraces = traceService.listTraces({ limit });

    // Sanitize each trace according to requester permissions
    const sanitizedTraces = allTraces
      .map((t) => traceService.sanitizeForViewer(t, user))
      .filter((t) => t !== null);

    res.status(200).json({
      success: true,
      data: {
        traces: sanitizedTraces,
        total: sanitizedTraces.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/rag/traces/:traceId
 * Retrieve single trace by ID.
 */
router.get('/traces/:traceId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const traceId = Array.isArray(req.params.traceId) ? req.params.traceId[0] : req.params.traceId;
    const trace = traceService.getTrace(traceId);

    if (!trace) {
      throw new AppError(`Trace '${traceId}' not found.`, 404, 'TRACE_NOT_FOUND');
    }

    const sanitized = traceService.sanitizeForViewer(trace, user);
    if (!sanitized) {
      throw new AppError('You are not authorized to view this trace.', 403, 'FORBIDDEN');
    }

    res.status(200).json({
      success: true,
      data: sanitized,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
