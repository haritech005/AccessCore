import { Router, Request, Response, NextFunction } from 'express';
import { ragService } from '../services/ragService';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/**
 * POST /api/chat
 * Primary RAG endpoint: accepts question, retrieves grounded evidence, invokes local LLM,
 * validates citations, and returns grounded answer with source provenance.
 */
router.post(
  '/chat',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { question, top_k, min_similarity, tenant_scope, user_groups, model } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const result = await ragService.answerQuestion({
        question,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: Array.isArray(tenant_scope) ? tenant_scope : undefined,
        user_groups: Array.isArray(user_groups) ? user_groups : undefined,
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
      const { question, top_k, min_similarity, tenant_scope, user_groups, model } = req.body;

      if (!question || typeof question !== 'string') {
        throw new AppError('Field \'question\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const result = await ragService.answerQuestion({
        question,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: Array.isArray(tenant_scope) ? tenant_scope : undefined,
        user_groups: Array.isArray(user_groups) ? user_groups : undefined,
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
