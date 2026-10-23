import { Router, Request, Response, NextFunction } from 'express';
import { retrievalService } from '../services/retrievalService';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/**
 * POST /api/retrieval
 * Semantic vector retrieval using pgvector cosine distance.
 * Returns top-k matching chunks with similarity scores and citation metadata.
 */
router.post(
  '/retrieval',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { query: userQuery, top_k, min_similarity, tenant_scope, user_groups } = req.body;

      if (!userQuery || typeof userQuery !== 'string') {
        throw new AppError('Field \'query\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const result = await retrievalService.retrieveChunks({
        query: userQuery,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: Array.isArray(tenant_scope) ? tenant_scope : undefined,
        user_groups: Array.isArray(user_groups) ? user_groups : undefined,
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
      const { query: userQuery, top_k, min_similarity, tenant_scope, user_groups } = req.body;

      if (!userQuery || typeof userQuery !== 'string') {
        throw new AppError('Field \'query\' is required and must be a string.', 400, 'INVALID_INPUT');
      }

      const result = await retrievalService.retrieveChunks({
        query: userQuery,
        top_k: typeof top_k === 'number' ? top_k : undefined,
        min_similarity: typeof min_similarity === 'number' ? min_similarity : undefined,
        tenant_scope: Array.isArray(tenant_scope) ? tenant_scope : undefined,
        user_groups: Array.isArray(user_groups) ? user_groups : undefined,
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
