import { PoolClient } from 'pg';
import { query } from '../db';

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditActor {
  id?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface AuditEventInput {
  actor?: AuditActor | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  outcome: AuditOutcome;
  correlationId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN = /(password|hash|secret|token|authorization|cookie|apikey|api_key|raw_content|prompt)/i;

/**
 * Recursively strips sensitive keys so credentials, hashes, tokens, or raw secrets
 * can never accidentally be persisted into audit_logs.
 */
export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || value === undefined) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = sanitizeAuditMetadata(val, depth + 1);
      }
    }
    return out;
  }

  if (typeof value === 'string' && value.length > 500) {
    return `${value.slice(0, 497)}...`;
  }

  return value;
}

class AuditService {
  /**
   * Appends a structured security/administrative event to the audit_logs table.
   * Uses the supplied PoolClient when executed inside a transaction, or the shared pool otherwise.
   * Logging failures are isolated so they never expose secrets or crash business requests.
   */
  async recordEvent(event: AuditEventInput, client?: PoolClient): Promise<void> {
    const sanitizedMetadata = sanitizeAuditMetadata(event.metadata || {});
    const sql = `
      INSERT INTO audit_logs (
        actor_id,
        actor_email,
        actor_role,
        action,
        target_type,
        target_id,
        outcome,
        correlation_id,
        ip_address,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `;

    const params = [
      event.actor?.id || null,
      event.actor?.email || null,
      event.actor?.role || null,
      event.action,
      event.targetType,
      event.targetId || null,
      event.outcome,
      event.correlationId || null,
      event.ipAddress || null,
      JSON.stringify(sanitizedMetadata),
    ];

    try {
      if (client) {
        await client.query(sql, params);
      } else {
        await query(sql, params);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown audit logging failure';
      console.error(`[AuditService] Failed to record '${event.action}' audit event: ${msg}`);
    }
  }
}

export const auditService = new AuditService();

