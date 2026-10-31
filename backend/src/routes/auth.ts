import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

const router = Router();

/**
 * POST /api/auth/login
 * Authenticates user credentials, resolves roles and tenant scopes from DB,
 * issues a signed session token, and sets a secure cookie.
 */
router.post(
  '/auth/login',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, userId, password } = req.body;
      const identifier = email || userId;

      if (!identifier || typeof identifier !== 'string') {
        throw new AppError('Field \'email\' or \'userId\' is required.', 400, 'INVALID_INPUT');
      }

      // Password can be empty in local dev if user has no password_hash
      const pwd = typeof password === 'string' ? password : '';

      const { user, token } = await authService.login(identifier, pwd);

      // Set cookie for browser sessions
      res.cookie('accesscore.session-token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        path: '/',
      });

      res.status(200).json({
        success: true,
        data: {
          user,
          token,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/auth/logout
 * Clears the session cookie.
 */
router.post(
  '/auth/logout',
  (_req: Request, res: Response): void => {
    res.clearCookie('accesscore.session-token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  }
);

/**
 * GET /api/auth/me
 * Returns the currently authenticated user's authoritative principal context.
 */
router.get(
  '/auth/me',
  requireAuth,
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    });
  }
);

/**
 * GET /api/auth/verify
 * Validates the caller's session token and verifies real-time active status in PostgreSQL.
 */
router.get(
  '/auth/verify',
  requireAuth,
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      data: {
        valid: true,
        user: req.user,
      },
    });
  }
);

export default router;

