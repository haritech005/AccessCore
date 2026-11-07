import { query } from '../db';
import { authorizationService } from './authorizationService';
import { FullTextQuery, FullTextSearchResult, FullTextChunk } from '../types/rag';
import { AuthenticatedUser, SensitivityLevel } from '../types/identity';
import { AppError } from '../middleware/errorHandler';

export class FullTextSearchService {
  /**
   * Executes sparse lexical full-text search using PostgreSQL's built-in tsvector and GIN index.
   * Specializes in exact matches for technical terms, error codes (e.g. CD-API-429, CD-WHK-504),
   * identifiers, and keyword queries while strictly maintaining Phase 2/3 security boundaries.
   *
   * Security Guarantees:
   * 1. Inactive or suspended accounts cannot retrieve any knowledge.
   * 2. Cross-tenant retrieval is strictly excluded at the SQL level.
   * 3. Customer users are quarantined to their assigned customer tenant.
   * 4. Restricted sensitivity requires explicit security clearance.
   * 5. Top unfiltered match pre-check prevents fallback leakage.
   * 6. Defense-in-depth: Each returned chunk is verified via authorizationService.
   */
  async searchChunks(options: FullTextQuery): Promise<FullTextSearchResult> {
    const startTime = Date.now();
    const { query: userQuery, top_k = 5, tenant_scope, user_groups, user, audience } = options;

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
      throw new AppError('Full-text search query must be a non-empty string.', 400, 'INVALID_QUERY');
    }

    const cleanQuery = userQuery.trim();
    if (cleanQuery.length > 2000) {
      throw new AppError('Full-text search query exceeds maximum allowed length of 2000 characters.', 400, 'QUERY_TOO_LONG');
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
      if (Array.isArray(tenant_scope) && tenant_scope.length === 1) {
        effectiveTenantScope = authorizationService.getEffectiveTenantScope(user, tenant_scope[0]);
      } else if (Array.isArray(tenant_scope) && tenant_scope.length > 1) {
        effectiveTenantScope = user.has_wildcard_tenant
          ? tenant_scope
          : user.tenant_scope.filter((t) => tenant_scope.includes(t));
      } else {
        effectiveTenantScope = user.tenant_scope;
      }
      effectiveUserGroups = user.groups;
      hasRestrictedClearance = authorizationService.hasRestrictedClearance(user);
    } else if (user_groups) {
      hasRestrictedClearance =
        user_groups.includes('grp_security_restricted') ||
        user_groups.includes('grp_incident_review');
    }

    // 1. Pre-check: Check whether an explicitly cited document ID in the query is blocked by authorization
    if ((effectiveTenantScope && effectiveTenantScope.length > 0) || (effectiveUserGroups && effectiveUserGroups.length > 0) || user) {
      const docIdMatches = [...cleanQuery.matchAll(/\b([A-Z]{2,5}-[0-9]{3,5})\b/g)].map((m) => m[1]);

      if (docIdMatches.length > 0) {
        const citedDocsRes = await query<{
          document_id: string;
          tenant_id: string;
          allowed_groups: string[];
          sensitivity: string;
          disclosure_policy: string;
        }>(
          `SELECT DISTINCT d.document_id, c.metadata->>'tenant_id' as tenant_id, c.metadata->'allowed_groups' as allowed_groups, c.metadata->>'sensitivity' as sensitivity, c.metadata->>'disclosure_policy' as disclosure_policy
           FROM document_chunks c
           JOIN documents d ON c.document_id = d.id
           JOIN document_versions v ON c.version_id = v.id
           WHERE c.is_active = true AND d.status = 'completed' AND v.status = 'active'
             AND d.document_id = ANY($1::text[])`,
          [docIdMatches]
        );

        for (const citedDoc of citedDocsRes.rows) {
          let isDocAllowed = false;
          if (user) {
            isDocAllowed = authorizationService.can(user, 'search:retrieval', {
              type: 'chunk',
              document_id: citedDoc.document_id,
              tenant_id: citedDoc.tenant_id,
              allowed_groups: Array.isArray(citedDoc.allowed_groups) ? citedDoc.allowed_groups : [],
              sensitivity: (citedDoc.sensitivity as SensitivityLevel) || 'internal',
              disclosure_policy: citedDoc.disclosure_policy as any,
            }).allowed;
          } else {
            const hasTenant =
              citedDoc.tenant_id === 'global' ||
              (effectiveTenantScope && (effectiveTenantScope.includes('*') || effectiveTenantScope.includes(citedDoc.tenant_id)));
            const hasGroup =
              !effectiveUserGroups ||
              effectiveUserGroups.length === 0 ||
              (Array.isArray(citedDoc.allowed_groups) &&
                (citedDoc.allowed_groups.includes('grp_public') ||
                  effectiveUserGroups.some((g) => citedDoc.allowed_groups.includes(g))));
            const hasClearance =
              citedDoc.sensitivity !== 'restricted' || hasRestrictedClearance;
            isDocAllowed = !!(hasTenant && hasGroup && hasClearance);
          }

          if (!isDocAllowed) {
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

      // Check whether top matching chunk in the whole database is blocked
      const topCheckSql = `
        WITH q AS (
          SELECT 
            websearch_to_tsquery('english', $1) as web_q,
            CASE 
              WHEN plainto_tsquery('english', $1)::text <> '' 
              THEN to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | '))
              ELSE NULL 
            END as or_q
        )
        SELECT 
          d.document_id,
          c.metadata->>'tenant_id' as tenant_id,
          c.metadata->'allowed_groups' as allowed_groups,
          c.metadata->>'sensitivity' as sensitivity,
          c.metadata->>'disclosure_policy' as disclosure_policy,
          (
            CASE WHEN q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q THEN 2.0 ELSE 0.0 END +
            CASE WHEN q.or_q IS NOT NULL THEN ts_rank_cd(c.tsv, q.or_q) ELSE 0.0 END
          ) AS rank
        FROM document_chunks c
        JOIN documents d ON c.document_id = d.id
        JOIN document_versions v ON c.version_id = v.id, q
        WHERE c.is_active = true AND d.status = 'completed' AND v.status = 'active'
          AND (
            (q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q)
            OR (q.or_q IS NOT NULL AND c.tsv @@ q.or_q)
          )
        ORDER BY rank DESC
        LIMIT 1
      `;

      const topCheckRes = await query<{
        document_id: string;
        tenant_id: string;
        allowed_groups: string[];
        sensitivity: string;
        disclosure_policy: string;
        rank: number;
      }>(topCheckSql, [cleanQuery]);

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
            disclosure_policy: top.disclosure_policy as any,
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
          // If top match across whole database is not allowed, check if caller has any allowed match with comparable rank
          let allowedTenantClause = "c.metadata->>'tenant_id' = 'global'";
          const allowedCheckParams: unknown[] = [cleanQuery];
          if (effectiveTenantScope && effectiveTenantScope.length > 0 && !effectiveTenantScope.includes('*')) {
            allowedCheckParams.push(effectiveTenantScope);
            allowedTenantClause = `(c.metadata->>'tenant_id' = 'global' OR c.metadata->>'tenant_id' = ANY($${allowedCheckParams.length}::text[]))`;
          } else if (effectiveTenantScope && effectiveTenantScope.includes('*')) {
            allowedTenantClause = 'TRUE';
          }

          const topAllowedRes = await query<{ rank: number }>(
            `WITH q AS (
               SELECT 
                 websearch_to_tsquery('english', $1) as web_q,
                 CASE 
                   WHEN plainto_tsquery('english', $1)::text <> '' 
                   THEN to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | '))
                   ELSE NULL 
                 END as or_q
             )
             SELECT (
               CASE WHEN q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q THEN 2.0 ELSE 0.0 END +
               CASE WHEN q.or_q IS NOT NULL THEN ts_rank_cd(c.tsv, q.or_q) ELSE 0.0 END
             ) AS rank
             FROM document_chunks c
             JOIN documents d ON c.document_id = d.id
             JOIN document_versions v ON c.version_id = v.id, q
             WHERE c.is_active = true AND d.status = 'completed' AND v.status = 'active'
               AND (
                 (q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q)
                 OR (q.or_q IS NOT NULL AND c.tsv @@ q.or_q)
               )
               AND ${allowedTenantClause}
             ORDER BY rank DESC
             LIMIT 1`,
            allowedCheckParams
          );

          const topAllowedRank = topAllowedRes.rows.length > 0 ? topAllowedRes.rows[0].rank : 0;
          if (top.rank - topAllowedRank > 0.5) {
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
    }

    // 2. Build PostgreSQL Full-Text Search Query with Authoritative Security Filtering
    const params: unknown[] = [cleanQuery];

    let sql = `
      WITH q AS (
        SELECT 
          websearch_to_tsquery('english', $1) as web_q,
          CASE 
            WHEN plainto_tsquery('english', $1)::text <> '' 
            THEN to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | '))
            ELSE NULL 
          END as or_q
      )
      SELECT 
        c.id,
        d.document_id,
        c.version_id,
        c.chunk_index,
        c.content,
        c.metadata,
        c.is_active,
        (
          CASE WHEN q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q THEN 2.0 ELSE 0.0 END +
          CASE WHEN q.or_q IS NOT NULL THEN ts_rank_cd(c.tsv, q.or_q) ELSE 0.0 END
        ) AS rank,
        CASE 
          WHEN q.or_q IS NOT NULL THEN ts_headline('english', c.content, q.or_q, 'StartSel=<b>, StopSel=</b>, MaxWords=35, MinWords=15')
          ELSE substring(c.content, 1, 150)
        END as headline
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      JOIN document_versions v ON c.version_id = v.id, q
      WHERE c.is_active = true
        AND d.status = 'completed'
        AND v.status = 'active'
        AND (
          (q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q)
          OR (q.or_q IS NOT NULL AND c.tsv @@ q.or_q)
        )
    `;

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

    // Restricted sensitivity clearance check
    if (!hasRestrictedClearance) {
      sql += ` AND (c.metadata->>'sensitivity' IS DISTINCT FROM 'restricted')`;
    }

    params.push(effectiveTopK);
    sql += `
      ORDER BY rank DESC
      LIMIT $${params.length}
    `;

    // 3. Execute Full-Text Search in PostgreSQL
    const res = await query<{
      id: string;
      document_id: string;
      version_id: string;
      chunk_index: number;
      content: string;
      metadata: Record<string, unknown>;
      is_active: boolean;
      rank: string | number;
      headline: string;
    }>(sql, params);

    const fullTextChunks: FullTextChunk[] = res.rows.map((row) => {
      const rankNum = typeof row.rank === 'string' ? parseFloat(row.rank) : row.rank;

      return {
        id: row.id,
        document_id: row.document_id,
        version_id: row.version_id,
        chunk_index: row.chunk_index,
        content: row.content,
        rank: Math.max(0, rankNum),
        headline: row.headline,
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

    // 4. Defense-in-depth: Authoritative post-retrieval verification before leaving service
    let verifiedChunks = fullTextChunks;
    if (user) {
      verifiedChunks = fullTextChunks.filter((chunk) => {
        return authorizationService.can(user, 'search:retrieval', {
          type: 'chunk',
          document_id: chunk.document_id,
          tenant_id: chunk.metadata.tenant_id,
          allowed_groups: chunk.metadata.allowed_groups,
          sensitivity: chunk.metadata.sensitivity,
          disclosure_policy: chunk.metadata.disclosure_policy,
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
   * Helper check: Determines if matching indexed evidence exists in full-text search that is blocked by authorization.
   */
  async hasBlockedMatchingEvidence(options: {
    query: string;
    tenant_scope?: string[];
    user_groups?: string[];
    user?: AuthenticatedUser;
  }): Promise<boolean> {
    const { query: userQuery, tenant_scope = [], user_groups = [], user } = options;

    if (!userQuery || userQuery.trim().length === 0) {
      return false;
    }

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

    const params: unknown[] = [userQuery.trim()];

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
      WITH q AS (
        SELECT 
          websearch_to_tsquery('english', $1) as web_q,
          CASE 
            WHEN plainto_tsquery('english', $1)::text <> '' 
            THEN to_tsquery('english', replace(plainto_tsquery('english', $1)::text, ' & ', ' | '))
            ELSE NULL 
          END as or_q
      )
      SELECT 1
      FROM document_chunks c
      JOIN documents d ON c.document_id = d.id
      JOIN document_versions v ON c.version_id = v.id, q
      WHERE c.is_active = true
        AND d.status = 'completed'
        AND v.status = 'active'
        AND (
          (q.web_q IS NOT NULL AND q.web_q <> ''::tsquery AND c.tsv @@ q.web_q)
          OR (q.or_q IS NOT NULL AND c.tsv @@ q.or_q)
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

export const fullTextSearchService = new FullTextSearchService();
