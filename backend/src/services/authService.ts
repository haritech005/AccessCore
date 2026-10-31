import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { query } from '../db';
import { config } from '../config';
import { AuthenticatedUser, UserRecord } from '../types/identity';
import { AppError } from '../middleware/errorHandler';

export class AuthService {
  private secretKey: Uint8Array;

  constructor() {
    this.secretKey = new TextEncoder().encode(config.AUTH_SECRET);
  }

  /**
   * Hashes a plaintext password using bcrypt with standard salt rounds.
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  /**
   * Compares a plaintext password against a bcrypt hash.
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generates a signed, tamper-proof JWE/JWT session token using AUTH_SECRET.
   * Default expiration: 24 hours.
   */
  async createToken(
    userId: string,
    email: string,
    expiresIn: string = '24h'
  ): Promise<string> {
    return new SignJWT({
      sub: userId,
      email: email,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secretKey);
  }

  /**
   * Verifies and decodes a session JWT using AUTH_SECRET.
   * Rejects expired, tampered, or malformed tokens.
   */
  async verifyToken(token: string): Promise<{ sub: string; email: string }> {
    try {
      const { payload } = await jwtVerify(token, this.secretKey, {
        algorithms: ['HS256'],
      });

      if (!payload.sub || typeof payload.sub !== 'string') {
        throw new AppError('Invalid token subject claim.', 401, 'INVALID_TOKEN');
      }

      return {
        sub: payload.sub,
        email: (payload.email as string) || '',
      };
    } catch (err: unknown) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : 'Invalid session token.';
      throw new AppError(`Authentication session invalid or expired: ${message}`, 401, 'INVALID_SESSION');
    }
  }

  /**
   * Resolves the full authenticated principal context from PostgreSQL by user ID.
   * Queries users, user_groups, and user_tenants to build an authoritative security context.
   */
  async resolveAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    // 1. Query user record
    const userRes = await query<UserRecord>(
      `SELECT id, email, name, role, user_type, status, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (userRes.rows.length === 0) {
      return null;
    }

    const user = userRes.rows[0];

    // 2. Query user group memberships
    const groupsRes = await query<{ group_id: string }>(
      `SELECT group_id FROM user_groups WHERE user_id = $1 ORDER BY group_id ASC`,
      [userId]
    );
    const groups = groupsRes.rows.map((r) => r.group_id);

    // 3. Query user tenant scopes
    const tenantsRes = await query<{ tenant_id: string }>(
      `SELECT tenant_id FROM user_tenants WHERE user_id = $1 ORDER BY tenant_id ASC`,
      [userId]
    );
    const tenantScope = tenantsRes.rows.map((r) => r.tenant_id);
    const hasWildcardTenant = tenantScope.includes('*');

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      user_type: user.user_type,
      status: user.status,
      groups,
      tenant_scope: tenantScope,
      has_wildcard_tenant: hasWildcardTenant,
    };
  }

  /**
   * Authenticates user credentials (email or user ID + password),
   * verifies account status, and issues a signed session token.
   */
  async login(
    emailOrId: string,
    password: string
  ): Promise<{ user: AuthenticatedUser; token: string }> {
    const userRes = await query<UserRecord & { password_hash: string }>(
      `SELECT id, email, name, role, user_type, status, password_hash
       FROM users
       WHERE email = $1 OR id = $1`,
      [emailOrId.trim().toLowerCase()]
    );

    if (userRes.rows.length === 0) {
      throw new AppError('Invalid credentials. Account not found.', 401, 'INVALID_CREDENTIALS');
    }

    const rawUser = userRes.rows[0];

    // Check account status
    if (rawUser.status !== 'active') {
      throw new AppError(
        `Account is ${rawUser.status}. Please contact an administrator.`,
        403,
        'ACCOUNT_INACTIVE'
      );
    }

    // Verify password if hash exists
    if (rawUser.password_hash) {
      const isMatch = await this.comparePassword(password, rawUser.password_hash);
      if (!isMatch) {
        throw new AppError('Invalid credentials. Incorrect password.', 401, 'INVALID_CREDENTIALS');
      }
    } else {
      // If user has no password_hash set, allow development login only in non-production
      if (config.NODE_ENV === 'production') {
        throw new AppError('Account has no password configured.', 401, 'INVALID_CREDENTIALS');
      }
    }

    // Resolve full principal context
    const user = await this.resolveAuthenticatedUser(rawUser.id);
    if (!user) {
      throw new AppError('Failed to resolve user security profile.', 500, 'USER_RESOLUTION_FAILED');
    }

    const token = await this.createToken(user.id, user.email);

    return { user, token };
  }
}

export const authService = new AuthService();

