import { query } from '../db';
import { embeddingService } from './embeddingService';
import { authorizationService } from './authorizationService';
import { RetrievalQuery, RetrievedChunk } from '../types/rag';
import { AuthenticatedUser, SensitivityLevel } from '../types/identity';
import { AppError } from '../middleware/errorHandler';

export interface RetrievalResult {
  query: string;
  chunks: RetrievedChunk[];
  total_retrieved: number;
  latency_ms: number;
  has_blocked_top_match?: boolean;
}

export class RetrievalService {
  /**
   * Retrieves the most semantically relevant document chunks using pgvector similarity search
   * while strictly enforcing server-side authorization boundaries before evidence reaches the LLM.
   *
   * Security Guarantees:
   * 1. Inactive or suspended accounts cannot retrieve any knowledge.
   * 2. Cross-tenant retrieval is strictly excluded at the SQL level.
   * 3. Customer users are quarantined to their assigned customer tenant.
   * 4. Restricted sensitivity requires explicit security clearance.
   * 5. Top unfiltered match pre-check prevents fallback leakage.
   * 6. Defense-in-depth: Each returned chunk is validated through authorizationService before leaving.
   */
  async retrieveChunks(options: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const { query: userQuery, top_k = 5, min_similarity = 0.0, tenant_scope, user_groups, user } = options;

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
      throw new AppError('Retrieval query must be a non-empty string.', 400, 'INVALID_QUERY');
    }

    const cleanQuery = userQuery.trim();
    if (cleanQuery.length > 2000) {
      throw new AppError('Retrieval query exceeds maximum allowed length of 2000 characters.', 400, 'QUERY_TOO_LONG');
    }

    // 0. Account Status Guard: Inactive / suspended accounts cannot retrieve any knowledge
    if (user && user.status !== 'active') {
      return {
        query: cleanQuery,
        chunks: [],
        total_retrieved: 0,
        latency_ms: Date.now() - startTime,
      };
    }

    const effectiveTopK = Math.min(Math.max(1, top_k), 50);

    // Resolve authoritative security scopes
    let effectiveTenantScope: string[] | undefined = tenant_scope;
    let effectiveUserGroups: string[] | undefined = user_groups;
    let hasRestrictedClearance = false;

    if (user) {
      effectiveTenantScope = authorizationService.getEffectiveTenantScope(
        user,
        tenant_scope && tenant_scope.length > 0 ? tenant_scope[0] : undefined
      );
      effectiveUserGroups = user.groups;
      hasRestrictedClearance = authorizationService.hasRestrictedClearance(user);
    } else if (user_groups) {
      hasRestrictedClearance =
        user_groups.includes('grp_security_restricted') ||
        user_groups.includes('grp_incident_review');
    }

    // 1. Generate 768-dimensional query vector using local embedding model
    const queryEmbedding = await embeddingService.generateEmbedding(cleanQuery);
    const queryVectorLiteral = `[${queryEmbedding.join(',')}]`;

    // 1b. Pre-check: Check whether the primary matching indexed evidence (or an explicitly cited document ID)
    // is blocked by the caller's authorization. If blocked, short-circuit immediately without sending fallback chunks.
    if ((effectiveTenantScope && effectiveTenantScope.length > 0) || (effectiveUserGroups && effectiveUserGroups.length > 0) || user) {
      const docIdMatches = [...cleanQuery.matchAll(/\b([A-Z]{2,5}-[0-9]{3,5})\b/g)].map((m) => m[1]);

      const topCheckParams: unknown[] = [queryVectorLiteral];
      let docIdClause = '';
      if (docIdMatches.length > 0) {
        topCheckParams.push(docIdMatches);
        docIdClause = `OR d.document_id = ANY($${topCheckParams.length}::text[])`;
      }
      topCheckParams.push(min_similarity > 0 ? min_similarity : 0.35);

      const topCheckSql = `
        SELECT 
          d.document_id,
          c.metadata->>'tenant_id' as tenant_id,
          c.metadata->'allowed_groups' as allowed_groups,
          c.metadata->>'sensitivity' as sensitivity,
          (1 - (c.embedding <=> $1::vector)) as similarity
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN document_versions v ON c.version_id = v.id
        WHERE c.is_active = true AND d.status = 'completed' AND v.status = 'active'
          AND (
            (1 - (c.embedding <=> $1::vector)) >= $${topCheckParams.length}
            ${docIdClause}
          )
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT 1
      `;

      const topCheckRes = await query<{
        document_id: string;
        tenant_id: string;
        allowed_groups: string[];
        sensitivity: string;
        similarity: number;
      }>(topCheckSql, topCheckParams);

      if (topCheckRes.rows.length > 0) {
        const top = topCheckRes.rows[0];

        let isTopAllowed = false;
        if (user) {
          isTopAllowed = authorizationService.can(user, 'search:retrieval', {
            type: 'chunk',
            document_id: top.document_id,
            tenant_id: top.tenant_id,
            allowed_groups: Array.isArray(top.allowed_groups) ? top.allowed_groups : [],
            sensitivity: (top.sensitivity as SensitivityLevel) || 'internal',
          }).allowed;
        } else {
          const hasTenant =
            top.tenant_id === 'global' ||
            (effectiveTenantScope && (effectiveTenantScope.includes('*') || effectiveTenantScope.includes(top.tenant_id)));
          const hasGroup =
            !effectiveUserGroups ||
            effectiveUserGroups.length === 0 ||
            (Array.isArray(top.allowed_groups) &&
              (top.allowed_groups.includes('grp_public') ||
                effectiveUserGroups.some((g) => top.allowed_groups.includes(g))));
          const hasClearance =
            top.sensitivity !== 'restricted' || hasRestrictedClearance;
          isTopAllowed = !!(hasTenant && hasGroup && hasClearance);
        }

        if (!isTopAllowed) {
          // The most relevant document for this question is blocked by authorization.
          // Do NOT return lower-ranked fallback chunks from other tenants to the LLM.
          return {
            query: cleanQuery,
            chunks: [],
            total_retrieved: 0,
            latency_ms: Date.now() - startTime,
            has_blocked_top_match: true,
          };
        }
      }
    }

    // 2. Build pgvector cosine similarity search query with authoritative server-side filtering
    let sql = `
      SELECT 
        c.id,
        d.document_id,
        c.version_id,
        c.chunk_index,
        c.content,
        c.metadata,
        c.is_active,
        (c.embedding <=> $1::vector) AS cosine_distance,
        (1 - (c.embedding <=> $1::vector)) AS similarity
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      JOIN document_versions v ON c.version_id = v.id
      WHERE c.is_active = true
        AND d.status = 'completed'
        AND v.status = 'active'
    `;

    const params: unknown[] = [queryVectorLiteral];

    // Minimum similarity threshold
    if (min_similarity > 0) {
      params.push(min_similarity);
      sql += ` AND (1 - (c.embedding <=> $1::vector)) >= $${params.length}`;
    }

    // Tenant scope filter (global + user's authorized tenant scope)
    if (user && user.has_wildcard_tenant && (!tenant_scope || tenant_scope.length === 0)) {
      // Wildcard user with no specific tenant requested searches all customer tenants + global
    } else if (effectiveTenantScope && effectiveTenantScope.length > 0) {
      params.push(effectiveTenantScope);
      sql += ` AND (c.metadata->>'tenant_id' = ANY($${params.length}) OR c.metadata->>'tenant_id' = 'global')`;
    }

    // User groups filter
    if (effectiveUserGroups && effectiveUserGroups.length > 0) {
      params.push(effectiveUserGroups);
      sql += ` AND (c.metadata->'allowed_groups' ?| $${params.length} OR c.metadata->'allowed_groups' ? 'grp_public')`;
    }

    // Restricted sensitivity clearance check:
    // If caller does not belong to security restricted clearance groups, strictly exclude restricted sensitivity chunks
    if (!hasRestrictedClearance) {
      sql += ` AND (c.metadata->>'sensitivity' IS DISTINCT FROM 'restricted')`;
    }

    params.push(effectiveTopK);
    sql += `
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $${params.length}
    `;

    // 3. Execute vector search in PostgreSQL
    const res = await query<{
      id: string;
      document_id: string;
      version_id: string;
      chunk_index: number;
      content: string;
      metadata: Record<string, unknown>;
      is_active: boolean;
      cosine_distance: string | number;
      similarity: string | number;
    }>(sql, params);

    const retrievedChunks: RetrievedChunk[] = res.rows.map((row) => {
      const cosineDistance = typeof row.cosine_distance === 'string' ? parseFloat(row.cosine_distance) : row.cosine_distance;
      const similarity = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity;

      return {
        id: row.id,
        document_id: row.document_id,
        version_id: row.version_id,
        chunk_index: row.chunk_index,
        content: row.content,
        similarity: Math.max(0, Math.min(1, similarity)),
        cosine_distance: Math.max(0, cosineDistance),
        metadata: {
          document_id: String(row.metadata?.document_id || row.document_id),
          title: String(row.metadata?.title || 'Untitled'),
          tenant_id: String(row.metadata?.tenant_id || 'global'),
          allowed_groups: Array.isArray(row.metadata?.allowed_groups) ? (row.metadata.allowed_groups as string[]) : [],
          sensitivity: (row.metadata?.sensitivity as any) || 'internal',
          disclosure_policy: (row.metadata?.disclosure_policy as any) || 'internal_only',
          section_heading: row.metadata?.section_heading ? String(row.metadata.section_heading) : undefined,
          start_char: typeof row.metadata?.start_char === 'number' ? row.metadata.start_char : undefined,
          end_char: typeof row.metadata?.end_char === 'number' ? row.metadata.end_char : undefined,
          page_number: typeof row.metadata?.page_number === 'number' ? row.metadata.page_number : undefined,
        },
        is_active: row.is_active,
      };
    });

    // 4. Defense-in-depth: Authoritative post-retrieval verification before leaving retrieval service
    let verifiedChunks = retrievedChunks;
    if (user) {
      verifiedChunks = retrievedChunks.filter((chunk) => {
        return authorizationService.can(user, 'search:retrieval', {
          type: 'chunk',
          document_id: chunk.document_id,
          tenant_id: chunk.metadata.tenant_id,
          allowed_groups: chunk.metadata.allowed_groups,
          sensitivity: chunk.metadata.sensitivity,
          is_active: chunk.is_active,
        }).allowed;
      });
    }

    const latencyMs = Date.now() - startTime;

    return {
      query: cleanQuery,
      chunks: verifiedChunks,
      total_retrieved: verifiedChunks.length,
      latency_ms: latencyMs,
    };
  }

  /**
   * Helper check: Determines if matching indexed evidence exists in PostgreSQL that is blocked by authorization.
   */
  async hasBlockedMatchingEvidence(options: {
    query: string;
    min_similarity?: number;
    tenant_scope?: string[];
    user_groups?: string[];
    user?: AuthenticatedUser;
  }): Promise<boolean> {
    const { query: userQuery, min_similarity = 0.35, tenant_scope = [], user_groups = [], user } = options;

    if (!userQuery || userQuery.trim().length === 0) {
      return false;
    }

    // 1. Generate query embedding
    const queryEmbedding = await embeddingService.generateEmbedding(userQuery.trim());
    const queryVectorLiteral = `[${queryEmbedding.join(',')}]`;

    // 2. Extract any document IDs directly mentioned in the question (e.g., TKT-10421, PDOC-0001)
    const docIdMatches = [...userQuery.matchAll(/\b([A-Z]{2,5}-[0-9]{3,5})\b/g)].map((m) => m[1]);

    let effectiveTenantScope = tenant_scope;
    let effectiveUserGroups = user_groups;
    let hasRestrictedClearance = false;

    if (user) {
      effectiveTenantScope = authorizationService.getEffectiveTenantScope(user);
      effectiveUserGroups = user.groups;
      hasRestrictedClearance = authorizationService.hasRestrictedClearance(user);
    } else {
      hasRestrictedClearance =
        user_groups.includes('grp_security_restricted') ||
        user_groups.includes('grp_incident_review');
    }

    // 3. Query PostgreSQL for matching chunks that are EXCLUDED by the user's authorization bounds
    const params: unknown[] = [queryVectorLiteral, min_similarity];

    let docIdFilter = '';
    if (docIdMatches.length > 0) {
      params.push(docIdMatches);
      docIdFilter = `OR d.document_id = ANY($${params.length}::text[])`;
    }

    params.push(effectiveTenantScope);
    const tenantParamIdx = params.length;

    params.push(effectiveUserGroups);
    const groupsParamIdx = params.length;

    params.push(hasRestrictedClearance);
    const clearanceParamIdx = params.length;

    const sql = `
      SELECT 1
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      JOIN document_versions v ON c.version_id = v.id
      WHERE c.is_active = true
        AND d.status = 'completed'
        AND v.status = 'active'
        AND (
          (1 - (c.embedding <=> $1::vector)) >= $2
          ${docIdFilter}
        )
        AND (
          -- Excluded by tenant scope (not global, and not in user's tenant_scope)
          (c.metadata->>'tenant_id' != 'global' AND NOT (c.metadata->>'tenant_id' = ANY($${tenantParamIdx}::text[])))
          OR
          -- Excluded by group permissions (no matching group and not grp_public)
          (
            NOT (c.metadata->'allowed_groups' ?| $${groupsParamIdx}::text[])
            AND NOT (c.metadata->'allowed_groups' ? 'grp_public')
          )
          OR
          -- Excluded by restricted sensitivity clearance
          (
            c.metadata->>'sensitivity' = 'restricted'
            AND NOT ($${clearanceParamIdx}::boolean)
          )
        )
      LIMIT 1
    `;

    const res = await query(sql, params);
    return res.rows.length > 0;
  }
}

export const retrievalService = new RetrievalService();
