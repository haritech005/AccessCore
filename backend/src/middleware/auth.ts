import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { AppError } from './errorHandler';

/**
 * Extracts session token from Authorization Bearer header or common Auth.js session cookies.
 */
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) return token;
  }

  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookieNames = [
      'accesscore.session-token',
      'authjs.session-token',
      '__Secure-authjs.session-token',
      'next-auth.session-token',
      '__Secure-next-auth.session-token',
    ];
    for (const name of cookieNames) {
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }
  }

  return null;
}

/**
 * Middleware that requires a valid, authenticated, active user session.
 * Rejects with:
 * - 401 UNAUTHORIZED if missing token
 * - 401 INVALID_SESSION if token expired or invalid
 * - 401 USER_NOT_FOUND if user record no longer exists
 * - 403 ACCOUNT_INACTIVE if user account is inactive or suspended
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new AppError(
        'Authentication required. Please provide a valid session token.',
        401,
        'UNAUTHORIZED'
      );
    }

    // 1. Verify token signature and expiration
    const payload = await authService.verifyToken(token);

    // 2. Authoritatively resolve the current user from database
    const user = await authService.resolveAuthenticatedUser(payload.sub);
    if (!user) {
      throw new AppError(
        'Authenticated user account could not be found.',
        401,
        'USER_NOT_FOUND'
      );
    }

    // 3. Verify user account status
    if (user.status !== 'active') {
      throw new AppError(
        `User account is ${user.status}. Access denied.`,
        403,
        'ACCOUNT_INACTIVE'
      );
    }

    // 4. Attach resolved principal to request
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional authentication middleware: if a token is provided and valid, attaches user;
 * otherwise leaves req.user undefined without rejecting.
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (token) {
      try {
        const payload = await authService.verifyToken(token);
        const user = await authService.resolveAuthenticatedUser(payload.sub);
        if (user && user.status === 'active') {
          req.user = user;
        }
      } catch {
        // Silently ignore invalid tokens for optional auth routes
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

