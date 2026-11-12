import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { authorizationService } from '../services/authorizationService';
import { auditService } from '../services/auditService';
import { UserRole } from '../types/identity';
import { config } from '../config';
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
async function authenticateRequest(req: Request): Promise<void> {
  if (req.user) {
    if (req.user.status !== 'active') {
      throw new AppError(
        `User account is ${req.user.status}. Access denied.`,
        403,
        'ACCOUNT_INACTIVE'
      );
    }
    return;
  }

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

  // 2. Authoritatively resolve the current user from database (prevents token claim tampering)
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

  req.user = user;
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
    await authenticateRequest(req);
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware that enforces administrator-only access (`admin` or `it_security_admin`).
 * Self-contained: ensures authentication first, then enforces central admin policy.
 * Rejects unauthenticated callers with 401 and non-admin callers with 403 FORBIDDEN.
 */
export async function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await authenticateRequest(req);
    const authz = authorizationService.authorizeAdminAccess(req.user);
    if (!authz.allowed) {
      await auditService.recordEvent({
        actor: req.user
          ? { id: req.user.id, email: req.user.email, role: req.user.role }
          : undefined,
        action: 'auth.admin_access.denied',
        targetType: 'system',
        targetId: `${req.method} ${req.originalUrl || req.url}`.slice(0, 120),
        outcome: 'denied',
        correlationId: req.correlationId || null,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        metadata: { reason: authz.reason || 'Administrator access required.' },
      });
      throw new AppError(
        authz.reason || 'Administrator access required.',
        403,
        'ADMIN_FORBIDDEN'
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Middleware factory enforcing membership in one of the specified roles.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      await authenticateRequest(req);
      if (!req.user || !allowedRoles.includes(req.user.role)) {
        throw new AppError(
          `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
          403,
          'FORBIDDEN'
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Protects administrative state-changing requests against CSRF by verifying Origin/Referer
 * headers against trusted frontend origins whenever cookie-based auth is in effect or an
 * untrusted Origin header is supplied.
 */
export function verifyAdminCsrf(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  if (!mutatingMethods.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const allowedOrigins = new Set(
    [config.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'].map((u) =>
      u.replace(/\/+$/, '')
    )
  );

  const originHeader = req.headers.origin?.replace(/\/+$/, '');
  const refererHeader = req.headers.referer;
  const hasBearerAuth = Boolean(req.headers.authorization?.startsWith('Bearer '));

  // Reject any explicit untrusted Origin immediately, even on Bearer requests
  if (originHeader && !allowedOrigins.has(originHeader)) {
    void auditService.recordEvent({
      actor: req.user
        ? { id: req.user.id, email: req.user.email, role: req.user.role }
        : undefined,
      action: 'security.csrf.blocked',
      targetType: 'system',
      targetId: `${req.method} ${req.originalUrl || req.url}`.slice(0, 120),
      outcome: 'denied',
      correlationId: req.correlationId || null,
      ipAddress: req.ip || req.socket.remoteAddress || null,
      metadata: { untrusted_origin: originHeader },
    });
    next(
      new AppError(
        'Cross-origin administrative mutation blocked by CSRF policy.',
        403,
        'CSRF_FORBIDDEN'
      )
    );
    return;
  }

  // If relying exclusively on cookies (no Bearer header), require a matching Origin or Referer
  if (!hasBearerAuth) {
    let refererOrigin: string | null = null;
    if (refererHeader) {
      try {
        refererOrigin = new URL(refererHeader).origin;
      } catch {
        refererOrigin = null;
      }
    }

    if (!originHeader && (!refererOrigin || !allowedOrigins.has(refererOrigin))) {
      next(
        new AppError(
          'Missing or untrusted origin for cookie-authenticated administrative action.',
          403,
          'CSRF_FORBIDDEN'
        )
      );
      return;
    }
  }

  next();
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

