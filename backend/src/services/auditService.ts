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

export interface AuditLogRecord {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: AuditOutcome;
  correlation_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
}

export interface ListAuditEventsFilters {
  action?: string;
  outcome?: string;
  target_type?: string;
  target_id?: string;
  actor_id?: string;
  search?: string;
  start_date?: string;
  end_date?: string;
  correlation_id?: string;
  page?: number;
  limit?: number;
}

export interface AuditStatsReport {
  total: number;
  outcomes: {
    success: number;
    denied: number;
    error: number;
  };
  recent_24h_count: number;
  top_actions: Array<{ action: string; count: number }>;
  top_actors: Array<{ actor_id: string; actor_email: string; count: number }>;
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

  /**
   * Lists audit events with security filtering, search, and pagination.
   */
  async listAuditEvents(filters: ListAuditEventsFilters): Promise<{
    events: AuditLogRecord[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.action && filters.action !== 'all') {
      params.push(filters.action.trim());
      conditions.push(`action = $${params.length}`);
    }

    if (filters.outcome && filters.outcome !== 'all') {
      params.push(filters.outcome.trim());
      conditions.push(`outcome = $${params.length}`);
    }

    if (filters.target_type && filters.target_type !== 'all') {
      params.push(filters.target_type.trim());
      conditions.push(`target_type = $${params.length}`);
    }

    if (filters.target_id) {
      params.push(filters.target_id.trim());
      conditions.push(`target_id = $${params.length}`);
    }

    if (filters.actor_id) {
      params.push(filters.actor_id.trim());
      conditions.push(`actor_id = $${params.length}`);
    }

    if (filters.correlation_id) {
      params.push(filters.correlation_id.trim());
      conditions.push(`correlation_id = $${params.length}`);
    }

    if (filters.start_date) {
      params.push(filters.start_date.trim());
      conditions.push(`created_at >= $${params.length}::timestamptz`);
    }

    if (filters.end_date) {
      params.push(filters.end_date.trim());
      conditions.push(`created_at <= $${params.length}::timestamptz`);
    }

    if (filters.search && filters.search.trim().length > 0) {
      params.push(`%${filters.search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(action ILIKE $${idx} OR COALESCE(actor_email, '') ILIKE $${idx} OR COALESCE(actor_id, '') ILIKE $${idx} OR COALESCE(target_id, '') ILIKE $${idx} OR COALESCE(correlation_id, '') ILIKE $${idx})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rowsRes, countRes] = await Promise.all([
      query<any>(
        `
        SELECT
          id,
          created_at,
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
        FROM audit_logs
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM audit_logs
        ${whereClause}
        `,
        params
      ),
    ]);

    const events: AuditLogRecord[] = rowsRes.rows.map((r) => ({
      id: r.id,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      actor_id: r.actor_id || null,
      actor_email: r.actor_email || null,
      actor_role: r.actor_role || null,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id || null,
      outcome: r.outcome as AuditOutcome,
      correlation_id: r.correlation_id || null,
      ip_address: r.ip_address || null,
      metadata: (r.metadata || {}) as Record<string, unknown>,
    }));

    return {
      events,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      page,
      limit,
    };
  }

  /**
   * Generates summary statistics across audit telemetry.
   */
  async getAuditStats(): Promise<AuditStatsReport> {
    const [countsRes, actionsRes, actorsRes] = await Promise.all([
      query<{
        total: string;
        success_count: string;
        denied_count: string;
        error_count: string;
        recent_24h: string;
      }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE outcome = 'success')::text AS success_count,
          COUNT(*) FILTER (WHERE outcome = 'denied')::text AS denied_count,
          COUNT(*) FILTER (WHERE outcome = 'error')::text AS error_count,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::text AS recent_24h
        FROM audit_logs
      `),
      query<{ action: string; count: string }>(`
        SELECT action, COUNT(*)::text AS count
        FROM audit_logs
        GROUP BY action
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `),
      query<{ actor_id: string; actor_email: string; count: string }>(`
        SELECT
          COALESCE(actor_id, 'anonymous') AS actor_id,
          COALESCE(actor_email, 'anonymous') AS actor_email,
          COUNT(*)::text AS count
        FROM audit_logs
        GROUP BY COALESCE(actor_id, 'anonymous'), COALESCE(actor_email, 'anonymous')
        ORDER BY COUNT(*) DESC
        LIMIT 10
      `),
    ]);

    const row = countsRes.rows[0] || {
      total: '0',
      success_count: '0',
      denied_count: '0',
      error_count: '0',
      recent_24h: '0',
    };

    return {
      total: parseInt(row.total || '0', 10),
      outcomes: {
        success: parseInt(row.success_count || '0', 10),
        denied: parseInt(row.denied_count || '0', 10),
        error: parseInt(row.error_count || '0', 10),
      },
      recent_24h_count: parseInt(row.recent_24h || '0', 10),
      top_actions: actionsRes.rows.map((r) => ({
        action: r.action,
        count: parseInt(r.count, 10),
      })),
      top_actors: actorsRes.rows.map((r) => ({
        actor_id: r.actor_id,
        actor_email: r.actor_email,
        count: parseInt(r.count, 10),
      })),
    };
  }

  /**
   * Generates a downloadable compliance export in JSON or CSV format.
   */
  async exportAuditEvents(
    format: 'json' | 'csv' = 'json',
    filters: ListAuditEventsFilters = {}
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const { events } = await this.listAuditEvents({ ...filters, limit: 1000, page: 1 });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'csv') {
      const headers = [
        '"timestamp"',
        '"action"',
        '"actor_email"',
        '"actor_role"',
        '"outcome"',
        '"target_type"',
        '"target_id"',
        '"correlation_id"',
        '"ip_address"',
      ];
      const rows = events.map((e) => [
        `"${e.created_at}"`,
        `"${e.action}"`,
        `"${e.actor_email || ''}"`,
        `"${e.actor_role || ''}"`,
        `"${e.outcome}"`,
        `"${e.target_type}"`,
        `"${e.target_id || ''}"`,
        `"${e.correlation_id || ''}"`,
        `"${e.ip_address || ''}"`,
      ]);
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      return {
        content: csv,
        contentType: 'text/csv; charset=utf-8',
        filename: `accesscore-audit-export-${timestamp}.csv`,
      };
    }

    return {
      content: JSON.stringify(events, null, 2),
      contentType: 'application/json; charset=utf-8',
      filename: `accesscore-audit-export-${timestamp}.json`,
    };
  }
}

export const auditService = new AuditService();

