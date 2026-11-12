import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { auditService } from '../services/auditService';
import { requireAuth, extractToken } from '../middleware/auth';
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
    const correlationId = req.correlationId || null;
    const ipAddress = req.ip || req.socket.remoteAddress || null;
    const { email, userId, password } = req.body || {};
    const identifier = email || userId;

    try {
      if (!identifier || typeof identifier !== 'string') {
        throw new AppError("Field 'email' or 'userId' is required.", 400, 'INVALID_INPUT');
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

      await auditService.recordEvent({
        actor: { id: user.id, email: user.email, role: user.role },
        action: 'auth.login.succeeded',
        targetType: 'user',
        targetId: user.id,
        outcome: 'success',
        correlationId,
        ipAddress,
        metadata: { user_type: user.user_type },
      });

      res.status(200).json({
        success: true,
        data: {
          user,
          token,
        },
      });
    } catch (err) {
      await auditService.recordEvent({
        actor: {
          id: null,
          email: typeof identifier === 'string' ? identifier.trim().toLowerCase() : null,
          role: null,
        },
        action: 'auth.login.failed',
        targetType: 'user',
        targetId: typeof identifier === 'string' ? identifier.trim().toLowerCase() : 'unknown',
        outcome: 'denied',
        correlationId,
        ipAddress,
        metadata: {
          reason: err instanceof Error ? err.message : 'Authentication failed',
          code: (err as any)?.code || 'AUTH_FAILED',
        },
      });
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
  async (req: Request, res: Response): Promise<void> => {
    let actorId: string | null = null;
    let actorEmail: string | null = null;
    try {
      const token = extractToken(req);
      if (token) {
        const payload = await authService.verifyToken(token);
        actorId = payload.sub;
        actorEmail = payload.email;
      }
    } catch {
      // Ignore expired/invalid tokens on logout
    }

    await auditService.recordEvent({
      actor: { id: actorId, email: actorEmail, role: null },
      action: 'auth.logout',
      targetType: 'user',
      targetId: actorId || 'anonymous',
      outcome: 'success',
      correlationId: req.correlationId || null,
      ipAddress: req.ip || req.socket.remoteAddress || null,
    });

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

