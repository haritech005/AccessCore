import path from 'path';
import { PoolClient } from 'pg';
import { getClient, query } from '../db';
import { AppError } from '../middleware/errorHandler';
import { RequestAuditMeta } from './adminIdentityService';
import { auditService } from './auditService';
import { authService } from './authService';
import { authorizationService } from './authorizationService';
import { ingestionService } from './ingestionService';
import { MAX_FILE_SIZE_BYTES, DocumentParseError } from '../parsers';
import {
  DisclosurePolicy,
  DisclosurePolicyEnum,
  DocumentMetadata,
  DocumentTypeEnum,
  OwnerTeamEnum,
  SensitivityEnum,
} from '../types/document';
import { AuthenticatedUser, SensitivityLevel } from '../types/identity';

const SUPPORTED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.md', '.markdown', '.txt', '.json']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminDocumentSummary {
  id: string;
  document_id: string;
  title: string;
  filename: string;
  format: string;
  current_version: number;
  status: string;
  error_message: string | null;
  tenant_id: string;
  allowed_groups: string[];
  sensitivity: SensitivityLevel;
  disclosure_policy: string;
  document_type: string;
  owner_team: string;
  is_active: boolean;
  active_chunks_count: number;
  has_approved_summary: boolean;
  created_at: string;
  updated_at: string;
}

export interface DocumentEffectiveUserEntry {
  user_id: string;
  name: string;
  email: string;
  role: string;
  user_type: string;
  status: string;
  allowed: boolean;
  reason?: string;
}

export interface ListDocumentsFilters {
  search?: string;
  tenant?: string;
  status?: string;
  sensitivity?: string;
  disclosure_policy?: string;
  document_type?: string;
  is_active?: string;
  page?: number;
  limit?: number;
}

export interface UploadAdminDocumentInput {
  filename: string;
  content: string;
  is_base64?: boolean;
  approved_summary?: string;
  override_metadata?: {
    document_id?: string;
    title?: string;
    document_type?: string;
    tenant_id?: string;
    owner_team?: string;
    allowed_groups?: string[];
    sensitivity?: string;
    disclosure_policy?: string;
    version?: string;
  };
}

export interface UpdateDocumentPermissionsInput {
  title?: string;
  tenant_id?: string;
  allowed_groups?: string[];
  sensitivity?: string;
  disclosure_policy?: string;
  document_type?: string;
  owner_team?: string;
  is_active?: boolean;
  approved_summary?: string;
}

function dedupeStrings(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return Array.from(
    new Set(
      val
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s) => s.length > 0)
    )
  );
}

async function validateClassificationAndAcls(
  client: PoolClient | null,
  input: {
    tenant_id: string;
    allowed_groups: string[];
    sensitivity: string;
    disclosure_policy: string;
    document_type?: string;
    owner_team?: string;
  }
): Promise<void> {
  const runQuery = client
    ? <T extends Record<string, any>>(sql: string, params?: unknown[]) => client.query<T>(sql, params)
    : <T extends Record<string, any>>(sql: string, params?: unknown[]) => query<T>(sql, params);

  const sensCheck = SensitivityEnum.safeParse(input.sensitivity);
  if (!sensCheck.success) {
    throw new AppError(`Invalid sensitivity '${input.sensitivity}'.`, 400, 'INVALID_SENSITIVITY');
  }

  const discCheck = DisclosurePolicyEnum.safeParse(input.disclosure_policy);
  if (!discCheck.success) {
    throw new AppError(
      `Invalid disclosure_policy '${input.disclosure_policy}'.`,
      400,
      'INVALID_DISCLOSURE_POLICY'
    );
  }

  if (input.document_type) {
    const dt = DocumentTypeEnum.safeParse(input.document_type);
    if (!dt.success) {
      throw new AppError(`Invalid document_type '${input.document_type}'.`, 400, 'INVALID_DOCUMENT_TYPE');
    }
  }

  if (input.owner_team) {
    const ot = OwnerTeamEnum.safeParse(input.owner_team);
    if (!ot.success) {
      throw new AppError(`Invalid owner_team '${input.owner_team}'.`, 400, 'INVALID_OWNER_TEAM');
    }
  }

  // Enforce CloudDesk Blueprint classification matrix
  if (input.sensitivity === 'public') {
    if (input.disclosure_policy !== 'customer_shareable' && input.disclosure_policy !== 'direct') {
      throw new AppError(
        "Public sensitivity documents must use 'customer_shareable' or 'direct' disclosure policy.",
        400,
        'POLICY_CONFLICT'
      );
    }
  }
  if (input.sensitivity === 'confidential' || input.sensitivity === 'restricted') {
    if (
      input.disclosure_policy !== 'internal_only' &&
      input.disclosure_policy !== 'approved_summary_only' &&
      input.disclosure_policy !== 'restricted'
    ) {
      throw new AppError(
        `${input.sensitivity} documents cannot use customer-open '${input.disclosure_policy}' disclosure policy.`,
        400,
        'POLICY_CONFLICT'
      );
    }
  }

  if (!input.allowed_groups || input.allowed_groups.length === 0) {
    throw new AppError(
      'At least one authorized group (allowed_groups) must be specified.',
      400,
      'EMPTY_ALLOWED_GROUPS'
    );
  }

  if (input.sensitivity === 'restricted') {
    const invalidGroups = input.allowed_groups.filter(
      (g) => g === 'grp_public' || g === 'grp_all_employees' || g.startsWith('cust_')
    );
    if (invalidGroups.length > 0) {
      throw new AppError(
        `Restricted sensitivity documents cannot grant access to broad or customer groups (${invalidGroups.join(', ')}).`,
        400,
        'RESTRICTED_GROUP_VIOLATION'
      );
    }
  }

  if (!input.tenant_id || !input.tenant_id.trim()) {
    throw new AppError('A valid tenant_id is required.', 400, 'INVALID_TENANT');
  }

  const tenRes = await runQuery<{ id: string }>(
    `SELECT id FROM tenants WHERE id = $1`,
    [input.tenant_id.trim()]
  );
  if (tenRes.rows.length === 0) {
    throw new AppError(`Unknown tenant_id '${input.tenant_id}'.`, 400, 'INVALID_TENANT');
  }

  const grpRes = await runQuery<{ id: string }>(
    `SELECT id FROM groups WHERE id = ANY($1::varchar[])`,
    [input.allowed_groups]
  );
  const existingSet = new Set(grpRes.rows.map((r) => r.id));
  const missingGroups = input.allowed_groups.filter((g) => !existingSet.has(g));
  if (missingGroups.length > 0) {
    throw new AppError(`Unknown group ID(s): ${missingGroups.join(', ')}`, 400, 'INVALID_GROUP');
  }
}

async function resolveDocumentRow(idOrCode: string) {
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
    created_at: string;
    updated_at: string;
    perm_tenant_id: string | null;
    perm_allowed_groups: string[] | null;
    perm_sensitivity: string | null;
    perm_disclosure_policy: string | null;
    perm_is_active: boolean | null;
  }>(
    `
    SELECT
      d.id,
      d.document_id,
      d.title,
      d.filename,
      d.format,
      d.current_version,
      d.status,
      d.error_message,
      d.metadata,
      d.created_at,
      d.updated_at,
      dp.tenant_id AS perm_tenant_id,
      dp.allowed_groups AS perm_allowed_groups,
      dp.sensitivity AS perm_sensitivity,
      dp.disclosure_policy AS perm_disclosure_policy,
      dp.is_active AS perm_is_active
    FROM documents d
    LEFT JOIN document_permissions dp ON dp.document_id = d.id
    WHERE ${isUuid ? 'd.id = $1' : 'd.document_id = $1'}
    LIMIT 1
    `,
    [idOrCode]
  );

  if (res.rows.length === 0) {
    throw new AppError(`Document '${idOrCode}' not found.`, 404, 'DOCUMENT_NOT_FOUND');
  }

  return res.rows[0];
}

function mapSummaryRow(row: any): AdminDocumentSummary {
  const meta = (row.metadata || {}) as Record<string, unknown>;
  const tenantId = row.perm_tenant_id || (meta.tenant_id as string) || 'global';
  const allowedGroups =
    row.perm_allowed_groups ||
    (meta.allowed_groups as string[]) ||
    (meta.authorized_groups as string[]) ||
    [];
  const sensitivity = ((row.perm_sensitivity || meta.sensitivity || 'internal') as SensitivityLevel);
  const disclosurePolicy =
    row.perm_disclosure_policy || (meta.disclosure_policy as string) || 'internal_only';
  const isActive = row.perm_is_active !== null && row.perm_is_active !== undefined
    ? Boolean(row.perm_is_active)
    : meta.is_active !== false;

  return {
    id: row.id,
    document_id: row.document_id,
    title: row.title,
    filename: row.filename,
    format: row.format,
    current_version: row.current_version,
    status: row.status,
    error_message: row.error_message || null,
    tenant_id: tenantId,
    allowed_groups: allowedGroups,
    sensitivity,
    disclosure_policy: disclosurePolicy,
    document_type: (meta.document_type as string) || 'product_doc',
    owner_team: (meta.owner_team as string) || 'engineering',
    is_active: isActive,
    active_chunks_count: parseInt(row.active_chunks_count || '0', 10),
    has_approved_summary: Boolean(row.has_approved_summary),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

class AdminDocumentService {
  async listDocuments(filters: ListDocumentsFilters): Promise<{
    documents: AdminDocumentSummary[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.search && filters.search.trim()) {
      params.push(`%${filters.search.trim()}%`);
      const idx = params.length;
      conditions.push(`(d.document_id ILIKE $${idx} OR d.title ILIKE $${idx} OR d.filename ILIKE $${idx})`);
    }
    if (filters.tenant && filters.tenant !== 'all') {
      params.push(filters.tenant);
      conditions.push(`COALESCE(dp.tenant_id, d.metadata->>'tenant_id', 'global') = $${params.length}`);
    }
    if (filters.status && filters.status !== 'all') {
      params.push(filters.status);
      conditions.push(`d.status = $${params.length}`);
    }
    if (filters.sensitivity && filters.sensitivity !== 'all') {
      params.push(filters.sensitivity);
      conditions.push(`COALESCE(dp.sensitivity, d.metadata->>'sensitivity', 'internal') = $${params.length}`);
    }
    if (filters.disclosure_policy && filters.disclosure_policy !== 'all') {
      params.push(filters.disclosure_policy);
      conditions.push(
        `COALESCE(dp.disclosure_policy, d.metadata->>'disclosure_policy', 'internal_only') = $${params.length}`
      );
    }
    if (filters.document_type && filters.document_type !== 'all') {
      params.push(filters.document_type);
      conditions.push(`COALESCE(d.metadata->>'document_type', 'product_doc') = $${params.length}`);
    }
    if (filters.is_active === 'true' || filters.is_active === 'false') {
      params.push(filters.is_active === 'true');
      conditions.push(`COALESCE(dp.is_active, true) = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id
      ${whereClause}
      `,
      params
    );
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    const listParams = [...params, limit, offset];
    const limitIdx = listParams.length - 1;
    const offsetIdx = listParams.length;

    const rowsRes = await query(
      `
      SELECT
        d.id,
        d.document_id,
        d.title,
        d.filename,
        d.format,
        d.current_version,
        d.status,
        d.error_message,
        d.metadata,
        d.created_at,
        d.updated_at,
        dp.tenant_id AS perm_tenant_id,
        dp.allowed_groups AS perm_allowed_groups,
        dp.sensitivity AS perm_sensitivity,
        dp.disclosure_policy AS perm_disclosure_policy,
        dp.is_active AS perm_is_active,
        (SELECT COUNT(*)::text FROM document_chunks c WHERE c.document_id = d.id AND c.is_active = true) AS active_chunks_count,
        EXISTS (
          SELECT 1 FROM approved_summaries s
          WHERE s.document_id = d.id AND s.audience = 'customer' AND s.status = 'approved'
        ) AS has_approved_summary
      FROM documents d
      LEFT JOIN document_permissions dp ON dp.document_id = d.id
      ${whereClause}
      ORDER BY d.updated_at DESC, d.document_id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `,
      listParams
    );

    return {
      documents: rowsRes.rows.map(mapSummaryRow),
      total,
      page,
      limit,
    };
  }

  async getDocumentDetail(idOrCode: string) {
    const row = await resolveDocumentRow(idOrCode);

    const [chunksCountRes, versionsRes, jobsRes, summaryRes, usersRes, auditRes] = await Promise.all([
      query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM document_chunks WHERE document_id = $1 AND is_active = true`,
        [row.id]
      ),
      query(
        `SELECT id, version, content_hash, status, error_message, created_at, published_at
         FROM document_versions WHERE document_id = $1 ORDER BY version DESC`,
        [row.id]
      ),
      query(
        `SELECT id, version_id, status, error_message, started_at, completed_at
         FROM ingestion_jobs WHERE document_id = $1 ORDER BY started_at DESC LIMIT 10`,
        [row.id]
      ),
      query<{ summary_text: string; status: string; approved_at: string; approved_by: string | null }>(
        `SELECT summary_text, status, approved_at, approved_by
         FROM approved_summaries WHERE document_id = $1 AND audience = 'customer' LIMIT 1`,
        [row.id]
      ),
      query<{ id: string }>(`SELECT id FROM users ORDER BY created_at ASC, id ASC`),
      query(
        `SELECT id, created_at, actor_id, actor_email, actor_role, action, outcome, metadata
         FROM audit_logs
         WHERE target_type = 'document' AND (target_id = $1 OR target_id = $2)
         ORDER BY created_at DESC LIMIT 20`,
        [row.document_id, row.id]
      ),
    ]);

    const summaryDoc = mapSummaryRow({
      ...row,
      active_chunks_count: chunksCountRes.rows[0]?.count || '0',
      has_approved_summary:
        summaryRes.rows.length > 0 && summaryRes.rows[0].status === 'approved',
    });

    // Compute per-user effective access preview using central authorizationService
    const effectiveUsers: DocumentEffectiveUserEntry[] = [];
    for (const uRow of usersRes.rows) {
      const resolved = await authService.resolveAuthenticatedUser(uRow.id);
      if (!resolved) continue;
      const evalRes = authorizationService.can(resolved, 'read:document', {
        type: 'document',
        document_id: summaryDoc.document_id,
        tenant_id: summaryDoc.tenant_id,
        allowed_groups: summaryDoc.allowed_groups,
        sensitivity: summaryDoc.sensitivity,
        disclosure_policy: summaryDoc.disclosure_policy,
        is_active: summaryDoc.is_active,
        status: summaryDoc.status,
      });
      effectiveUsers.push({
        user_id: resolved.id,
        name: resolved.name,
        email: resolved.email,
        role: resolved.role,
        user_type: resolved.user_type,
        status: resolved.status,
        allowed: evalRes.allowed,
        reason: evalRes.reason,
      });
    }

    return {
      document: summaryDoc,
      approved_summary: summaryRes.rows[0] || null,
      versions: versionsRes.rows,
      ingestion_jobs: jobsRes.rows,
      effective_access: {
        permitted_count: effectiveUsers.filter((u) => u.allowed).length,
        denied_count: effectiveUsers.filter((u) => !u.allowed).length,
        users: effectiveUsers,
      },
      audit_history: auditRes.rows,
    };
  }

  async uploadDocument(
    actor: AuthenticatedUser,
    input: UploadAdminDocumentInput,
    reqMeta: RequestAuditMeta
  ) {
    const authz = authorizationService.authorizeAdminAccess(actor);
    if (!authz.allowed) {
      throw new AppError(authz.reason || 'Administrator access required.', 403, 'ADMIN_FORBIDDEN');
    }

    if (!input.filename || typeof input.filename !== 'string') {
      throw new AppError("Field 'filename' is required.", 400, 'INVALID_FILENAME');
    }

    const safeFilename = path.basename(input.filename.trim());
    if (!safeFilename || safeFilename !== input.filename.trim()) {
      throw new AppError('Invalid filename: path traversal characters are not allowed.', 400, 'INVALID_FILENAME');
    }

    const ext = path.extname(safeFilename).toLowerCase();
    if (!SUPPORTED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new AppError(
        `Unsupported file extension '${ext}'. Supported formats: .md, .markdown, .txt, .json, .pdf.`,
        415,
        'UNSUPPORTED_FORMAT'
      );
    }

    if (typeof input.content !== 'string' || input.content.length === 0) {
      throw new AppError('Uploaded file content cannot be empty.', 400, 'FILE_EMPTY');
    }

    const treatAsBase64 = Boolean(input.is_base64) || ext === '.pdf';
    const buffer = treatAsBase64
      ? Buffer.from(input.content, 'base64')
      : Buffer.from(input.content, 'utf-8');

    if (buffer.length === 0) {
      throw new AppError(`File '${safeFilename}' is empty (0 bytes).`, 400, 'FILE_EMPTY');
    }

    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new AppError(
        `File '${safeFilename}' exceeds maximum allowed size of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
        413,
        'FILE_TOO_LARGE'
      );
    }

    const ov = input.override_metadata;
    if (ov) {
      await validateClassificationAndAcls(null, {
        tenant_id: ov.tenant_id || 'global',
        allowed_groups: dedupeStrings(ov.allowed_groups?.length ? ov.allowed_groups : ['grp_engineering']),
        sensitivity: ov.sensitivity || 'internal',
        disclosure_policy: ov.disclosure_policy || 'internal_only',
        document_type: ov.document_type,
        owner_team: ov.owner_team,
      });
    }

    const cleanOverride: Partial<DocumentMetadata> | undefined = ov
      ? {
          ...(ov.document_id ? { document_id: ov.document_id.trim().toUpperCase() } : {}),
          ...(ov.title ? { title: ov.title.trim() } : {}),
          ...(ov.document_type ? { document_type: ov.document_type as any } : {}),
          ...(ov.tenant_id ? { tenant_id: ov.tenant_id.trim() } : {}),
          ...(ov.owner_team ? { owner_team: ov.owner_team as any } : {}),
          ...(ov.allowed_groups ? { allowed_groups: dedupeStrings(ov.allowed_groups) } : {}),
          ...(ov.sensitivity ? { sensitivity: ov.sensitivity as any } : {}),
          ...(ov.disclosure_policy ? { disclosure_policy: ov.disclosure_policy as any } : {}),
          ...(ov.version ? { version: ov.version } : {}),
        }
      : undefined;

    try {
      const result = await ingestionService.ingestDocument({
        filename: safeFilename,
        buffer,
        overrideMetadata: cleanOverride,
      });

      // Optionally store approved customer summary if provided
      if (input.approved_summary && input.approved_summary.trim().length > 0) {
        await query(
          `INSERT INTO approved_summaries (
            document_id, version_id, audience, summary_text, status, approved_by, approved_at
          ) VALUES ($1, $2, 'customer', $3, 'approved', $4, NOW())
          ON CONFLICT (document_id, audience) DO UPDATE SET
            version_id = EXCLUDED.version_id,
            summary_text = EXCLUDED.summary_text,
            status = 'approved',
            approved_by = EXCLUDED.approved_by,
            approved_at = NOW(),
            updated_at = NOW()`,
          [result.doc_uuid, result.version_uuid, input.approved_summary.trim(), actor.id]
        );
      }

      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.document.uploaded',
        targetType: 'document',
        targetId: result.document_id,
        outcome: 'success',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          filename: safeFilename,
          version: result.version,
          chunks_count: result.chunks_count,
          tenant_id: cleanOverride?.tenant_id || 'from_document',
          sensitivity: cleanOverride?.sensitivity || 'from_document',
          disclosure_policy: cleanOverride?.disclosure_policy || 'from_document',
        },
      });

      return {
        ingestion: result,
        detail: await this.getDocumentDetail(result.document_id),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Document ingestion failed.';
      await auditService.recordEvent({
        actor: { id: actor.id, email: actor.email, role: actor.role },
        action: 'admin.document.upload_failed',
        targetType: 'document',
        targetId: cleanOverride?.document_id || safeFilename,
        outcome: 'error',
        correlationId: reqMeta.correlationId,
        ipAddress: reqMeta.ipAddress,
        metadata: {
          filename: safeFilename,
          reason: message,
        },
      });

      if (err instanceof DocumentParseError) {
        throw new AppError(err.message, err.statusCode, err.code);
      }
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(message, 500, 'UPLOAD_INGESTION_FAILED');
    }
  }

  async updateDocumentPermissions(
    actor: AuthenticatedUser,
    idOrCode: string,
    patch: UpdateDocumentPermissionsInput,
    reqMeta: RequestAuditMeta
  ) {
    const row = await resolveDocumentRow(idOrCode);
    const meta = (row.metadata || {}) as Record<string, unknown>;

    const nextTitle = patch.title !== undefined ? patch.title.trim() : row.title;
    if (nextTitle.length < 1) {
      throw new AppError('Document title cannot be empty.', 400, 'INVALID_TITLE');
    }

    const nextTenantId =
      patch.tenant_id !== undefined
        ? patch.tenant_id.trim()
        : row.perm_tenant_id || (meta.tenant_id as string) || 'global';
    const nextAllowedGroups =
      patch.allowed_groups !== undefined
        ? dedupeStrings(patch.allowed_groups)
        : row.perm_allowed_groups || (meta.allowed_groups as string[]) || [];
    const nextSensitivity =
      patch.sensitivity !== undefined
        ? patch.sensitivity.trim()
        : row.perm_sensitivity || (meta.sensitivity as string) || 'internal';
    const nextDisclosure =
      patch.disclosure_policy !== undefined
        ? patch.disclosure_policy.trim()
        : row.perm_disclosure_policy || (meta.disclosure_policy as string) || 'internal_only';
    const nextDocType =
      patch.document_type !== undefined
        ? patch.document_type.trim()
        : (meta.document_type as string) || 'product_doc';
    const nextOwnerTeam =
      patch.owner_team !== undefined
        ? patch.owner_team.trim()
        : (meta.owner_team as string) || 'engineering';
    const prevIsActive =
      row.perm_is_active !== null && row.perm_is_active !== undefined
        ? Boolean(row.perm_is_active)
        : meta.is_active !== false;
    const nextIsActive = patch.is_active !== undefined ? Boolean(patch.is_active) : prevIsActive;

    const client = await getClient();
    try {
      await client.query('BEGIN');

      await validateClassificationAndAcls(client, {
        tenant_id: nextTenantId,
        allowed_groups: nextAllowedGroups,
        sensitivity: nextSensitivity,
        disclosure_policy: nextDisclosure as DisclosurePolicy,
        document_type: nextDocType,
        owner_team: nextOwnerTeam,
      });

      // 1. Sync document_permissions
      await client.query(
        `
        INSERT INTO document_permissions (
          document_id, tenant_id, allowed_groups, sensitivity, disclosure_policy, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (document_id) DO UPDATE SET
          tenant_id = EXCLUDED.tenant_id,
          allowed_groups = EXCLUDED.allowed_groups,
          sensitivity = EXCLUDED.sensitivity,
          disclosure_policy = EXCLUDED.disclosure_policy,
          is_active = EXCLUDED.is_active,
          updated_at = NOW()
        `,
        [
          row.id,
          nextTenantId,
          nextAllowedGroups,
          nextSensitivity,
          nextDisclosure,
          nextIsActive,
        ]
      );

      // 2. Sync documents.metadata & title
      const updatedMeta = {
        ...meta,
        title: nextTitle,
        tenant_id: nextTenantId,
        allowed_groups: nextAllowedGroups,
        sensitivity: nextSensitivity,
        disclosure_policy: nextDisclosure,
        document_type: nextDocType,
        owner_team: nextOwnerTeam,
        is_active: nextIsActive,
        updated_at: new Date().toISOString(),
      };

      await client.query(
        `UPDATE documents SET title = $1, metadata = $2::jsonb, updated_at = NOW() WHERE id = $3`,
        [nextTitle, JSON.stringify(updatedMeta), row.id]
      );

      // 3. Synchronize active-version document_chunks so pgvector, FTS, and hybrid search immediately enforce updates
      const chunkAclPatch = {
        title: nextTitle,
        tenant_id: nextTenantId,
        allowed_groups: nextAllowedGroups,
        sensitivity: nextSensitivity,
        disclosure_policy: nextDisclosure,
      };
      await client.query(
        `
        UPDATE document_chunks c
        SET
          metadata = c.metadata || $1::jsonb,
          is_active = CASE WHEN v.status = 'active' THEN $2 ELSE false END
        FROM document_versions v
        WHERE c.version_id = v.id AND c.document_id = $3
        `,
        [JSON.stringify(chunkAclPatch), nextIsActive, row.id]
      );

      // 4. Optional approved customer summary update
      if (patch.approved_summary !== undefined && patch.approved_summary.trim().length > 0) {
        await client.query(
          `
          INSERT INTO approved_summaries (
            document_id, audience, summary_text, status, approved_by, approved_at
          ) VALUES ($1, 'customer', $2, 'approved', $3, NOW())
          ON CONFLICT (document_id, audience) DO UPDATE SET
            summary_text = EXCLUDED.summary_text,
            status = 'approved',
            approved_by = EXCLUDED.approved_by,
            approved_at = NOW(),
            updated_at = NOW()
          `,
          [row.id, patch.approved_summary.trim(), actor.id]
        );
      }

      const actionName =
        prevIsActive !== nextIsActive
          ? nextIsActive
            ? 'admin.document.reactivated'
            : 'admin.document.archived'
          : 'admin.document.permissions_updated';

      await auditService.recordEvent(
        {
          actor: { id: actor.id, email: actor.email, role: actor.role },
          action: actionName,
          targetType: 'document',
          targetId: row.document_id,
          outcome: 'success',
          correlationId: reqMeta.correlationId,
          ipAddress: reqMeta.ipAddress,
          metadata: {
            previous: {
              tenant_id: row.perm_tenant_id || meta.tenant_id || 'global',
              allowed_groups: row.perm_allowed_groups || meta.allowed_groups || [],
              sensitivity: row.perm_sensitivity || meta.sensitivity || 'internal',
              disclosure_policy: row.perm_disclosure_policy || meta.disclosure_policy || 'internal_only',
              is_active: prevIsActive,
            },
            next: {
              tenant_id: nextTenantId,
              allowed_groups: nextAllowedGroups,
              sensitivity: nextSensitivity,
              disclosure_policy: nextDisclosure,
              is_active: nextIsActive,
            },
          },
        },
        client
      );

      await client.query('COMMIT');
      return await this.getDocumentDetail(row.id);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const adminDocumentService = new AdminDocumentService();
