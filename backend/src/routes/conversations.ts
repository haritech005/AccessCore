import { Router, Request, Response, NextFunction } from 'express';
import { conversationService } from '../services/conversationService';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

// All conversation routes require authentication
router.use('/conversations', requireAuth);

/**
 * GET /api/conversations
 * List all conversations belonging to the authenticated user.
 */
router.get(
  '/conversations',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const list = await conversationService.listConversations(user.id);
      res.status(200).json({
        success: true,
        data: list,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/conversations
 * Create a new conversation thread.
 */
router.post(
  '/conversations',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { title } = req.body;
      const conversation = await conversationService.createConversation(
        user.id,
        typeof title === 'string' && title.trim() ? title.trim() : 'New Chat'
      );

      res.status(201).json({
        success: true,
        data: conversation,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/conversations/:id
 * Get a specific conversation and all its messages.
 */
router.get(
  '/conversations/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        throw new AppError('Valid conversation id is required.', 400, 'INVALID_INPUT');
      }

      const conversation = await conversationService.getConversation(user.id, id);
      res.status(200).json({
        success: true,
        data: conversation,
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/conversations/:id
 * Delete a specific conversation and its messages.
 */
router.delete(
  '/conversations/:id',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const { id } = req.params;

      if (!id || typeof id !== 'string') {
        throw new AppError('Valid conversation id is required.', 400, 'INVALID_INPUT');
      }

      await conversationService.deleteConversation(user.id, id);
      res.status(200).json({
        success: true,
        message: 'Conversation deleted successfully.',
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;

