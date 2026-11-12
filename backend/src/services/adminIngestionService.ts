import fs from 'fs';
import path from 'path';
import { getClient, query } from '../db';
import { AppError } from '../middleware/errorHandler';
import { AuthenticatedUser } from '../types/identity';
import { RequestAuditMeta } from './adminIdentityService';
import { auditService } from './auditService';
import { ingestionService, sanitizeIngestionError } from './ingestionService';
import { DocumentMetadata } from '../types/document';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSETS_DIR = path.resolve(__dirname, '../../../assets');
const MAX_BATCH_REINDEX = 25;

export interface IngestionHealthMetrics {
  total_documents: number;
  completed_documents: number;
  failed_documents: number;
  active_jobs: number;
  failed_jobs: number;
  stale_processing_jobs: number;
  stale_active_chunks: number;
  obsolete_inactive_chunks: number;
  acl_desynced_documents: number;
}

export interface AdminIngestionJobSummary {
  id: string;
  document_uuid: string;
  document_id: string;
  document_title: string;
  filename: string;
  format: string;
  version: number | null;
  version_status: string | null;
  status: string;
  job_type: string;
  attempt_count: number;
  max_attempts: number;
  parent_job_id: string | null;
  initiated_by: string | null;
  chunks_total: number;
  chunks_reused: number;
  active_chunks_count: number;
  has_recovery_snapshot: boolean;
  can_retry: boolean;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface ListIngestionJobsFilters {
  status?: string;
  job_type?: string;
  search?: string;
  page?: number;
  limit?: number;
}

function findFileRecursively(dir: string, targetFilename: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursively(full, targetFilename);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === targetFilename) {
      return full;
    }
  }
  return null;
}

async function resolveDocumentByIdOrCode(idOrCode: string) {
  const isUuid = UUID_REGEX.test(idOrCode);
  const res = await query<{
    id: string;
    document_id: string;
    title: string;
    filename: string;
    format: string;
    current_version: number;
    status: string;
    error_message: string | null;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id, document_id, title, filename, format, current_version, status, error_message, metadata
     FROM documents
     WHERE ${isUuid ? 'id = $1' : 'document_id = $1'}
     LIMIT 1`,
    [idOrCode]
  );

  if (res.rows.length === 0) {
    throw new AppError(`Document '${idOrCode}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
  }
  return res.rows[0];
}

async function ensureNoConcurrentActiveJob(docUuid: string, excludeJobId?: string): Promise<void> {
  const params: unknown[] = [docUuid];
  let excludeClause = '';
  if (excludeJobId) {
    params.push(excludeJobId);
    excludeClause = ` AND id != $2`;
  }

  const activeRes = await query<{ id: string }>(
    `SELECT id FROM ingestion_jobs
     WHERE document_id = $1
       AND status IN ('pending', 'processing', 'chunking', 'embedding')
       AND started_at > NOW() - INTERVAL '15 minutes'
       ${excludeClause}
     LIMIT 1`,
    params
  );

  if (activeRes.rows.length > 0) {
    throw new AppError(
      'An ingestion or re-indexing job is already in progress for this document.',
      409,
      'INGESTION_IN_PROGRESS'
    );
  }
}

async function buildChunkFallbackSource(
  docRow: {
    id: string;
    document_id: string;
    title: string;
    filename: string;
    format: string;
    metadata: Record<string, unknown>;
  }
): Promise<{ filename: string; buffer: Buffer; overrideMetadata: Partial<DocumentMetadata> }> {
  const chunksRes = await query<{ content: string }>(
    `SELECT c.content
     FROM document_chunks c
     LEFT JOIN document_versions v ON v.id = c.version_id
     WHERE c.document_id = $1
       AND (v.status = 'active' OR c.is_active = true)
     ORDER BY COALESCE(v.version, 0) DESC, c.chunk_index ASC`,
    [docRow.id]
  );

  if (chunksRes.rows.length === 0) {
    throw new AppError(
      `No source file or active chunks are available to re-index document '${docRow.document_id}'. Upload a new file version instead.`,
      422,
      'REINDEX_SOURCE_UNAVAILABLE'
    );
  }

  const combinedText = chunksRes.rows.map((r) => r.content.trim()).filter(Boolean).join('\n\n');
  const safeExt = path.extname(docRow.filename).toLowerCase();
  const parseFilename =
    safeExt === '.md' || safeExt === '.markdown' || safeExt === '.txt'
      ? docRow.filename
      : `${docRow.document_id}.txt`;

  const meta = (docRow.metadata || {}) as Partial<DocumentMetadata>;
  return {
    filename: parseFilename,
    buffer: Buffer.from(combinedText, 'utf-8'),
    overrideMetadata: {
      document_id: docRow.document_id,
      title: docRow.title,
      document_type: meta.document_type,
      tenant_id: meta.tenant_id,
      owner_team: meta.owner_team,
      allowed_groups: meta.allowed_groups,
      sensitivity: meta.sensitivity,
      disclosure_policy: meta.disclosure_policy,
    },
  };
}

class AdminIngestionService {
  async getHealthMetrics(): Promise<IngestionHealthMetrics> {
    const [docsRes, jobsRes, staleChunksRes, obsoleteChunksRes, desyncRes] = await Promise.all([
      query<{
        total: string;
        completed: string;
        failed: string;
      }>(`
        SELECT
          COUNT(*)::text AS total,
          COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
          COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
        FROM documents
      `),
      query<{
        active_jobs: string;
        failed_jobs: string;
        stale_processing_jobs: string;
      }>(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'chunking', 'embedding'))::text AS active_jobs,
          COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_jobs,
          COUNT(*) FILTER (
            WHERE status IN ('pending', 'processing', 'chunking', 'embedding')
              AND started_at < NOW() - INTERVAL '15 minutes'
          )::text AS stale_processing_jobs
        FROM ingestion_jobs
      `),
      query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM document_chunks c
        JOIN document_versions v ON v.id = c.version_id
        JOIN documents d ON d.id = c.document_id
        LEFT JOIN document_permissions dp ON dp.document_id = d.id
        WHERE c.is_active = true
          AND (
            v.status != 'active'
            OR d.status != 'completed'
            OR COALESCE(dp.is_active, (d.metadata->>'is_active') IS DISTINCT FROM 'false') = false
          )
      `),
      query<{ count: string }>(`
        SELECT COUNT(*)::text AS count
        FROM document_chunks c
        JOIN document_versions v ON v.id = c.version_id
        WHERE c.is_active = false
          AND v.status IN ('archived', 'failed')
      `),
      query<{ count: string }>(`
        SELECT COUNT(DISTINCT d.id)::text AS count
        FROM documents d
        JOIN document_permissions dp ON dp.document_id = d.id
        JOIN document_chunks c ON c.document_id = d.id AND c.is_active = true
        WHERE d.status = 'completed'
          AND dp.is_active = true
          AND (
            (c.metadata->>'tenant_id') IS DISTINCT FROM dp.tenant_id
            OR (c.metadata->>'sensitivity') IS DISTINCT FROM dp.sensitivity
            OR (c.metadata->>'disclosure_policy') IS DISTINCT FROM dp.disclosure_policy
            OR (c.metadata->'allowed_groups') IS DISTINCT FROM to_jsonb(dp.allowed_groups)
          )
      `),
    ]);

    return {
      total_documents: parseInt(docsRes.rows[0]?.total || '0', 10),
      completed_documents: parseInt(docsRes.rows[0]?.completed || '0', 10),
      failed_documents: parseInt(docsRes.rows[0]?.failed || '0', 10),
      active_jobs: parseInt(jobsRes.rows[0]?.active_jobs || '0', 10),
      failed_jobs: parseInt(jobsRes.rows[0]?.failed_jobs || '0', 10),
      stale_processing_jobs: parseInt(jobsRes.rows[0]?.stale_processing_jobs || '0', 10),
      stale_active_chunks: parseInt(staleChunksRes.rows[0]?.count || '0', 10),
      obsolete_inactive_chunks: parseInt(obsoleteChunksRes.rows[0]?.count || '0', 10),
      acl_desynced_documents: parseInt(desyncRes.rows[0]?.count || '0', 10),
    };
  }

  async listJobsAndHealth(filters: ListIngestionJobsFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status && filters.status !== 'all') {
      params.push(filters.status.trim());
      conditions.push(`j.status = $${params.length}`);
    }

    if (filters.job_type && filters.job_type !== 'all') {
      params.push(filters.job_type.trim());
      conditions.push(`j.job_type = $${params.length}`);
    }

    if (filters.search && filters.search.trim().length > 0) {
      params.push(`%${filters.search.trim()}%`);
      const idx = params.length;
      conditions.push(
        `(d.document_id ILIKE $${idx} OR d.title ILIKE $${idx} OR d.filename ILIKE $${idx} OR COALESCE(j.error_message, '') ILIKE $${idx})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rowsRes, countRes, health] = await Promise.all([
      query<any>(
        `
        SELECT
          j.id,
          j.document_id AS document_uuid,
          d.document_id,
          d.title AS document_title,
          d.filename,
          d.format,
          v.version,
          v.status AS version_status,
          j.status,
          j.job_type,
          j.attempt_count,
          j.max_attempts,
          j.parent_job_id,
          j.initiated_by,
          j.chunks_total,
          j.chunks_reused,
          (j.source_snapshot IS NOT NULL) AS has_recovery_snapshot,
          j.error_message,
          j.started_at,
          j.completed_at,
          (
            SELECT COUNT(*)::int FROM document_chunks c
            WHERE c.document_id = d.id AND c.is_active = true
          ) AS active_chunks_count
        FROM ingestion_jobs j
        JOIN documents d ON d.id = j.document_id
        LEFT JOIN document_versions v ON v.id = j.version_id
        ${whereClause}
        ORDER BY j.started_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `,
        [...params, limit, offset]
      ),
      query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
        FROM ingestion_jobs j
        JOIN documents d ON d.id = j.document_id
        ${whereClause}
        `,
        params
      ),
      this.getHealthMetrics(),
    ]);

    const jobs: AdminIngestionJobSummary[] = rowsRes.rows.map((r) => {
      const started = r.started_at instanceof Date ? r.started_at : new Date(r.started_at);
      const completed = r.completed_at
        ? r.completed_at instanceof Date
          ? r.completed_at
          : new Date(r.completed_at)
        : null;
      const durationMs =
        completed && !Number.isNaN(completed.getTime())
          ? Math.max(0, completed.getTime() - started.getTime())
          : null;

      return {
        id: r.id,
        document_uuid: r.document_uuid,
        document_id: r.document_id,
        document_title: r.document_title,
        filename: r.filename,
        format: r.format,
        version: r.version !== null && r.version !== undefined ? Number(r.version) : null,
        version_status: r.version_status || null,
        status: r.status,
        job_type: r.job_type || 'ingest',
        attempt_count: Number(r.attempt_count || 1),
        max_attempts: Number(r.max_attempts || 3),
        parent_job_id: r.parent_job_id || null,
        initiated_by: r.initiated_by || null,
        chunks_total: Number(r.chunks_total || 0),
        chunks_reused: Number(r.chunks_reused || 0),
        active_chunks_count: Number(r.active_chunks_count || 0),
        has_recovery_snapshot: Boolean(r.has_recovery_snapshot),
        can_retry:
          r.status === 'failed' && Number(r.attempt_count || 1) < Number(r.max_attempts || 3),
        error_message: r.error_message ? sanitizeIngestionError(String(r.error_message)) : null,
        started_at: started.toISOString(),
        completed_at: completed ? completed.toISOString() : null,
        duration_ms: durationMs,
      };
    });

    return {
      jobs,
      total: parseInt(countRes.rows[0]?.count || '0', 10),
      page,
      limit,
      health,
    };
  }

  async getJobDetail(jobId: string) {
    if (!UUID_REGEX.test(jobId)) {
      throw new AppError(`Invalid job UUID '${jobId}'.`, 400, 'INVALID_JOB_ID');
    }

    const res = await query<any>(
      `
      SELECT
        j.id,
        j.document_id AS document_uuid,
        d.document_id,
        d.title AS document_title,
        d.filename,
        d.format,
        d.current_version,
        d.status AS document_status,
        v.version,
        v.status AS version_status,
        j.status,
        j.job_type,
        j.attempt_count,
        j.max_attempts,
        j.parent_job_id,
        j.initiated_by,
        j.chunks_total,
        j.chunks_reused,
        (j.source_snapshot IS NOT NULL) AS has_recovery_snapshot,
        j.error_message,
        j.started_at,
        j.completed_at
      FROM ingestion_jobs j
      JOIN documents d ON d.id = j.document_id
      LEFT JOIN document_versions v ON v.id = j.version_id
      WHERE j.id = $1
      LIMIT 1
      `,
      [jobId]
    );

    if (res.rows.length === 0) {
      throw new AppError(`Ingestion job '${jobId}' not found.`, 404, 'JOB_NOT_FOUND');
    }

    const row = res.rows[0];
    const [versionsRes, auditRes] = await Promise.all([
      query(
        `SELECT id, version, content_hash, status, error_message, created_at, published_at
         FROM document_versions WHERE document_id = $1 ORDER BY version DESC LIMIT 10`,
        [row.document_uuid]
      ),
      query(
        `SELECT id, created_at, actor_email, actor_role, action, outcome, metadata
         FROM audit_logs
         WHERE target_id = ANY($1::varchar[])
         ORDER BY created_at DESC LIMIT 20`,
        [[row.document_id, row.document_uuid, row.id]]
      ),
    ]);

    const attemptCount = Number(row.attempt_count || 1);
    const maxAttempts = Number(row.max_attempts || 3);
    let retryBlockReason: string | null = null;
    if (row.status !== 'failed') {
      retryBlockReason = `Job status is '${row.status}'; only failed jobs can be retried.`;
    } else if (attemptCount >= maxAttempts) {
      retryBlockReason = `Maximum retry attempts (${maxAttempts}) reached.`;
    }

    return {
      job: {
        id: row.id,
        document_uuid: row.document_uuid,
        document_id: row.document_id,
        document_title: row.document_title,
        filename: row.filename,
        format: row.format,
        document_status: row.document_status,
        current_version: Number(row.current_version),
        version: row.version !== null ? Number(row.version) : null,
        version_status: row.version_status || null,
        status: row.status,
        job_type: row.job_type || 'ingest',
        attempt_count: attemptCount,
        max_attempts: maxAttempts,
        parent_job_id: row.parent_job_id || null,
        initiated_by: row.initiated_by || null,
        chunks_total: Number(row.chunks_total || 0),
        chunks_reused: Number(row.chunks_reused || 0),
        has_recovery_snapshot: Boolean(row.has_recovery_snapshot),
        can_retry: retryBlockReason === null,
        retry_block_reason: retryBlockReason,
        error_message: row.error_message ? sanitizeIngestionError(String(row.error_message)) : null,
        started_at: row.started_at,
        completed_at: row.completed_at,
      },
      versions: versionsRes.rows,
      audit_history: auditRes.rows,
    };
  }

  async retryFailedJob(
    actor: AuthenticatedUser,
    jobId: string,
    reqMeta: RequestAuditMeta,
    options?: { content?: string; is_base64?: boolean; simulate_failure?: boolean }
  ) {
    if (!UUID_REGEX.test(jobId)) {
      throw new AppError(`Invalid job UUID '${jobId}'.`, 400, 'INVALID_JOB_ID');
    }

    const jobRes = await query<{
      id: string;
      document_id: string;
      status: string;
      attempt_count: number;
      max_attempts: number;
      source_snapshot: {
        filename?: string;
        content_base64?: string;
        override_metadata?: Partial<DocumentMetadata>;
      } | null;
      doc_code: string;
      doc_title: string;
      doc_filename: string;
      doc_metadata: Record<string, unknown>;
    }>(
      `SELECT
         j.id, j.document_id, j.status, j.attempt_count, j.max_attempts, j.source_snapshot,
         d.document_id AS doc_code, d.title AS doc_title, d.filename AS doc_filename, d.metadata AS doc_metadata
       FROM ingestion_jobs j
       JOIN documents d ON d.id = j.document_id
       WHERE j.id = $1
       LIMIT 1`,
      [jobId]
    );

    if (jobRes.rows.length === 0) {
      throw new AppError(`Ingestion job '${jobId}' not found.`, 404, 'JOB_NOT_FOUND');
    }

    const job = jobRes.rows[0];
    if (job.status !== 'failed') {
      throw new AppError(
        `Ingestion job '${jobId}' cannot be retried because its status is '${job.status}'.`,
        409,
        'JOB_NOT_FAILED'
      );
    }

    if (job.attempt_count >= job.max_attempts) {
      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.ingestion.retry_blocked',
        targetType: 'document',
        targetId: job.doc_code,
        outcome: 'denied',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          job_id: job.id,
          attempt_count: job.attempt_count,
          max_attempts: job.max_attempts,
          reason: 'Maximum retry attempts exceeded',
        },
      });
      throw new AppError(
        `Retry limit reached (${job.attempt_count}/${job.max_attempts} attempts). Upload a corrected document version instead.`,
        429,
        'RETRY_LIMIT_EXCEEDED'
      );
    }

    await ensureNoConcurrentActiveJob(job.document_id, job.id);

    let filename = job.doc_filename;
    let buffer: Buffer | null = null;
    let overrideMetadata: Partial<DocumentMetadata> | undefined;

    if (options?.content && typeof options.content === 'string') {
      buffer = options.is_base64
        ? Buffer.from(options.content, 'base64')
        : Buffer.from(options.content, 'utf-8');
      overrideMetadata = (job.doc_metadata || {}) as Partial<DocumentMetadata>;
    } else if (job.source_snapshot?.content_base64) {
      filename = job.source_snapshot.filename || job.doc_filename;
      buffer = Buffer.from(job.source_snapshot.content_base64, 'base64');
      overrideMetadata = job.source_snapshot.override_metadata;
    } else {
      const assetPath = findFileRecursively(ASSETS_DIR, job.doc_filename);
      if (assetPath) {
        buffer = fs.readFileSync(assetPath);
        overrideMetadata = (job.doc_metadata || {}) as Partial<DocumentMetadata>;
      }
    }

    if (!buffer || buffer.length === 0) {
      throw new AppError(
        `Recovery source unavailable for job '${jobId}'. Please upload the document file again.`,
        422,
        'RETRY_SOURCE_UNAVAILABLE'
      );
    }

    try {
      const result = await ingestionService.ingestDocument({
        filename,
        buffer,
        overrideMetadata,
        forceReembed: true,
        jobType: 'retry',
        attemptCount: job.attempt_count + 1,
        maxAttempts: job.max_attempts,
        parentJobId: job.id,
        initiatedBy: actor.id,
        preserveExistingPermissions: true,
        simulateProcessingFailure: options?.simulate_failure,
      });

      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.ingestion.retry_succeeded',
        targetType: 'document',
        targetId: result.document_id,
        outcome: 'success',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          parent_job_id: job.id,
          new_job_id: result.job_id,
          attempt_count: job.attempt_count + 1,
          version: result.version,
          chunks_count: result.chunks_count,
        },
      });

      return result;
    } catch (err) {
      const msg = sanitizeIngestionError(err instanceof Error ? err.message : String(err));
      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.ingestion.retry_failed',
        targetType: 'document',
        targetId: job.doc_code,
        outcome: 'error',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          parent_job_id: job.id,
          attempt_count: job.attempt_count + 1,
          error_summary: msg,
        },
      });
      throw err;
    }
  }

  async reindexDocument(
    actor: AuthenticatedUser,
    idOrCode: string,
    reqMeta: RequestAuditMeta,
    options?: {
      content?: string;
      is_base64?: boolean;
      force_reembed?: boolean;
      simulate_failure?: boolean;
    }
  ) {
    const docRow = await resolveDocumentByIdOrCode(idOrCode);
    await ensureNoConcurrentActiveJob(docRow.id);

    let filename = docRow.filename;
    let buffer: Buffer | null = null;
    let overrideMetadata: Partial<DocumentMetadata> | undefined = {
      ...(docRow.metadata as Partial<DocumentMetadata>),
      document_id: docRow.document_id,
      title: docRow.title,
    };

    if (options?.content && typeof options.content === 'string') {
      buffer = options.is_base64
        ? Buffer.from(options.content, 'base64')
        : Buffer.from(options.content, 'utf-8');
    } else {
      const assetPath = findFileRecursively(ASSETS_DIR, docRow.filename);
      if (assetPath) {
        buffer = fs.readFileSync(assetPath);
      } else {
        const fallback = await buildChunkFallbackSource(docRow);
        filename = fallback.filename;
        buffer = fallback.buffer;
        overrideMetadata = fallback.overrideMetadata;
      }
    }

    try {
      const result = await ingestionService.ingestDocument({
        filename,
        buffer,
        overrideMetadata,
        forceReembed: options?.force_reembed !== false,
        jobType: 'reindex',
        initiatedBy: actor.id,
        preserveExistingPermissions: true,
        simulateProcessingFailure: options?.simulate_failure,
      });

      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.document.reindexed',
        targetType: 'document',
        targetId: result.document_id,
        outcome: 'success',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          job_id: result.job_id,
          version: result.version,
          chunks_count: result.chunks_count,
          force_reembed: options?.force_reembed !== false,
        },
      });

      return result;
    } catch (err) {
      const msg = sanitizeIngestionError(err instanceof Error ? err.message : String(err));
      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.document.reindex_failed',
        targetType: 'document',
        targetId: docRow.document_id,
        outcome: 'error',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          error_summary: msg,
        },
      });
      throw err;
    }
  }

  async batchReindex(
    actor: AuthenticatedUser,
    reqMeta: RequestAuditMeta,
    options: { document_ids?: string[]; tenant_id?: string; force_reembed?: boolean }
  ) {
    let targetIds: string[] = [];

    if (Array.isArray(options.document_ids) && options.document_ids.length > 0) {
      targetIds = Array.from(
        new Set(options.document_ids.map((id) => String(id).trim()).filter(Boolean))
      ).slice(0, MAX_BATCH_REINDEX);
    } else {
      const params: unknown[] = [];
      let whereClause = `WHERE d.status = 'completed'`;
      if (options.tenant_id && options.tenant_id !== 'all') {
        params.push(options.tenant_id);
        whereClause += ` AND COALESCE(dp.tenant_id, d.metadata->>'tenant_id') = $1`;
      }
      const docsRes = await query<{ document_id: string }>(
        `SELECT d.document_id
         FROM documents d
         LEFT JOIN document_permissions dp ON dp.document_id = d.id
         ${whereClause}
         ORDER BY d.updated_at DESC
         LIMIT ${MAX_BATCH_REINDEX}`,
        params
      );
      targetIds = docsRes.rows.map((r) => r.document_id);
    }

    if (targetIds.length === 0) {
      throw new AppError(
        'No eligible completed documents matched the batch re-index selection.',
        400,
        'NO_REINDEX_TARGETS'
      );
    }

    const results: Array<{
      document_id: string;
      status: 'succeeded' | 'failed';
      job_id?: string;
      version?: number;
      chunks_count?: number;
      error?: string;
    }> = [];

    for (const idOrCode of targetIds) {
      try {
        const res = await this.reindexDocument(actor, idOrCode, reqMeta, {
          force_reembed: options.force_reembed !== false,
        });
        results.push({
          document_id: res.document_id,
          status: 'succeeded',
          job_id: res.job_id,
          version: res.version,
          chunks_count: res.chunks_count,
        });
      } catch (err) {
        results.push({
          document_id: idOrCode,
          status: 'failed',
          error: sanitizeIngestionError(err instanceof Error ? err.message : String(err)),
        });
      }
    }

    const succeeded = results.filter((r) => r.status === 'succeeded').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    await auditService.recordEvent({
      actor: { id: actor.id, email: actor.email, role: actor.role },
      action: 'admin.ingestion.batch_reindex',
      targetType: 'system',
      targetId: 'ingestion_batch',
      outcome: failed > 0 && succeeded === 0 ? 'error' : 'success',
      correlationId: reqMeta.correlationId,
      ipAddress: reqMeta.ipAddress,
      metadata: {
        total_requested: targetIds.length,
        succeeded,
        failed,
        document_ids: results.map((r) => r.document_id),
      },
    });

    return {
      total_requested: targetIds.length,
      succeeded,
      failed,
      results,
    };
  }

  async cleanupStaleIndexes(
    actor: AuthenticatedUser,
    reqMeta: RequestAuditMeta,
    options?: { stale_threshold_minutes?: number }
  ) {
    const thresholdMinutes = Math.max(
      0,
      Number.isFinite(Number(options?.stale_threshold_minutes))
        ? Number(options?.stale_threshold_minutes)
        : 15
    );

    const client = await getClient();
    let deactivatedStaleChunks = 0;
    let resyncedAclChunks = 0;
    let purgedObsoleteChunks = 0;
    let recoveredStaleJobs = 0;

    try {
      await client.query('BEGIN');

      // 1. Deactivate any chunks mistakenly flagged is_active=true on non-active versions, failed docs, or archived docs
      const staleDeactRes = await client.query(`
        UPDATE document_chunks c
        SET is_active = false
        FROM document_versions v, documents d
        LEFT JOIN document_permissions dp ON dp.document_id = d.id
        WHERE c.version_id = v.id
          AND c.document_id = d.id
          AND c.is_active = true
          AND (
            v.status != 'active'
            OR d.status != 'completed'
            OR COALESCE(dp.is_active, (d.metadata->>'is_active') IS DISTINCT FROM 'false') = false
          )
      `);
      deactivatedStaleChunks = staleDeactRes.rowCount || 0;

      // 2. Re-synchronize ACL metadata onto active chunks where document_permissions drifted
      const resyncRes = await client.query(`
        UPDATE document_chunks c
        SET metadata = c.metadata || jsonb_build_object(
          'tenant_id', dp.tenant_id,
          'allowed_groups', to_jsonb(dp.allowed_groups),
          'sensitivity', dp.sensitivity,
          'disclosure_policy', dp.disclosure_policy
        )
        FROM document_permissions dp, documents d
        WHERE c.document_id = d.id
          AND dp.document_id = d.id
          AND c.is_active = true
          AND d.status = 'completed'
          AND dp.is_active = true
          AND (
            (c.metadata->>'tenant_id') IS DISTINCT FROM dp.tenant_id
            OR (c.metadata->>'sensitivity') IS DISTINCT FROM dp.sensitivity
            OR (c.metadata->>'disclosure_policy') IS DISTINCT FROM dp.disclosure_policy
            OR (c.metadata->'allowed_groups') IS DISTINCT FROM to_jsonb(dp.allowed_groups)
          )
      `);
      resyncedAclChunks = resyncRes.rowCount || 0;

      // 3. Purge obsolete inactive chunks from archived/failed versions (keeps active version chunks & version history intact)
      const purgeRes = await client.query(`
        DELETE FROM document_chunks c
        USING document_versions v
        WHERE c.version_id = v.id
          AND c.is_active = false
          AND v.status IN ('archived', 'failed')
      `);
      purgedObsoleteChunks = purgeRes.rowCount || 0;

      // 4. Recover orphaned stale processing jobs exceeding threshold
      const staleJobsRes = await client.query<{ id: string; version_id: string | null }>(
        `
        UPDATE ingestion_jobs
        SET
          status = 'failed',
          error_message = COALESCE(error_message, 'Stale ingestion job timed out and was recovered by administrator cleanup.'),
          completed_at = NOW()
        WHERE status IN ('pending', 'processing', 'chunking', 'embedding')
          AND started_at <= NOW() - ($1 * INTERVAL '1 minute')
        RETURNING id, version_id
        `,
        [thresholdMinutes]
      );
      recoveredStaleJobs = staleJobsRes.rowCount || 0;

      const orphanedVersionIds = staleJobsRes.rows
        .map((r) => r.version_id)
        .filter((v): v is string => Boolean(v));
      if (orphanedVersionIds.length > 0) {
        await client.query(
          `UPDATE document_versions
           SET status = 'failed',
               error_message = COALESCE(error_message, 'Staged version orphaned by timed-out ingestion job.')
           WHERE id = ANY($1::uuid[]) AND status IN ('pending', 'processing')`,
          [orphanedVersionIds]
        );
      }

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: 'admin.ingestion.cleanup',
          targetType: 'system',
          targetId: 'vector_fts_index',
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            deactivated_stale_chunks: deactivatedStaleChunks,
            resynced_acl_chunks: resyncedAclChunks,
            purged_obsolete_chunks: purgedObsoleteChunks,
            recovered_stale_jobs: recoveredStaleJobs,
          },
        },
        client
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const health = await this.getHealthMetrics();
    return {
      cleaned: {
        deactivated_stale_chunks: deactivatedStaleChunks,
        resynced_acl_chunks: resyncedAclChunks,
        purged_obsolete_chunks: purgedObsoleteChunks,
        recovered_stale_jobs: recoveredStaleJobs,
      },
      health,
    };
  }
}

export const adminIngestionService = new AdminIngestionService();

