import { query } from '../db';
import {
  AudienceMode,
  DisclosurePolicy,
  SensitivityLevel,
  ApprovedSummaryRecord,
  sanitizePolicyMetadata,
  canDiscloseToAudience,
  isAudienceAllowedForUser,
} from '../types/policy';
import { AuthenticatedUser } from '../types/identity';
import { RetrievedChunk } from '../types/rag';
import { AppError } from '../middleware/errorHandler';

export interface PermittedEvidenceItem {
  document_id: string;
  chunk_index: number;
  content: string;
  is_summary: boolean;
  summary_id?: string;
  title: string;
  tenant_id: string;
  sensitivity: SensitivityLevel;
  disclosure_policy: DisclosurePolicy;
  section_heading?: string;
  similarity: number;
}

export interface ExcludedEvidenceItem {
  document_id: string;
  chunk_index: number;
  tenant_id: string;
  sensitivity: SensitivityLevel;
  disclosure_policy: DisclosurePolicy;
  reason: string;
}

export interface DisclosureEvaluationResult {
  audience: AudienceMode;
  permitted_evidence: PermittedEvidenceItem[];
  excluded_evidence: ExcludedEvidenceItem[];
  diagnostics: {
    total_evaluated: number;
    permitted_count: number;
    excluded_count: number;
    summaries_applied: number;
  };
}

export interface EvaluateDisclosureOptions {
  chunks: RetrievedChunk[];
  audience: AudienceMode;
  user: AuthenticatedUser;
  tenantScope?: string[];
}

/**
 * AccessCore Phase 3 — Central Disclosure Policy Service
 *
 * Implements deterministic evidence filtering and audience-specific disclosure enforcement
 * adhering to CloudDesk Company Blueprint (BP-0001, Section 6) and phase-3-policies.md.
 *
 * Runs downstream of Phase 2 Authorization and upstream of LLM Prompt Construction:
 * Phase 2 answers: "Is user authorized to retrieve this document?"
 * Phase 3 answers: "May this retrieved information be disclosed to the requested audience?"
 */
export class DisclosurePolicyService {
  /**
   * Resolves and authorizes the audience mode for the authenticated principal.
   * Prevents client privilege escalation:
   * - customer_user accounts are locked to 'customer' mode.
   * - employee accounts default to 'internal' but may voluntarily choose 'customer'.
   */
  resolveAudienceMode(user: AuthenticatedUser, requestedAudience?: unknown): AudienceMode {
    if (!user || user.status !== 'active') {
      throw new AppError('Active user session required for disclosure policy evaluation.', 401, 'UNAUTHORIZED');
    }

    let targetAudience: AudienceMode = 'internal';

    if (typeof requestedAudience === 'string') {
      const normalized = requestedAudience.trim().toLowerCase();
      if (normalized === 'customer' || normalized === 'customer_facing') {
        targetAudience = 'customer';
      } else if (normalized === 'internal') {
        targetAudience = 'internal';
      } else {
        throw new AppError(`Invalid audience mode '${requestedAudience}'. Must be 'internal' or 'customer'.`, 400, 'INVALID_AUDIENCE');
      }
    } else {
      // Default audience based on user type
      targetAudience = user.user_type === 'customer_user' ? 'customer' : 'internal';
    }

    if (!isAudienceAllowedForUser(user.user_type, targetAudience)) {
      throw new AppError(
        'Privilege escalation denied: Customer accounts cannot request internal audience mode.',
        403,
        'FORBIDDEN_AUDIENCE_MODE'
      );
    }

    return targetAudience;
  }

  /**
   * Fetches an active, approved summary for a document and audience.
   */
  async getApprovedSummary(
    documentId: string,
    audience: AudienceMode = 'customer'
  ): Promise<ApprovedSummaryRecord | null> {
    const res = await query<ApprovedSummaryRecord>(
      `SELECT s.id, s.document_id, s.version_id, s.audience, s.summary_text, s.status, s.approved_by, s.approved_at, s.metadata, s.created_at, s.updated_at
       FROM approved_summaries s
       JOIN documents d ON s.document_id = d.id
       WHERE (d.document_id = $1 OR d.id::text = $1)
         AND s.audience = $2
         AND s.status = 'approved'
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      [documentId, audience]
    );

    if (res.rows.length === 0) {
      return null;
    }

    return res.rows[0];
  }

  /**
   * Evaluates retrieved evidence chunks against disclosure rules for the given audience.
   *
   * Customer-Facing Mode Rules:
   * 1. Public / customer_shareable / direct: Permitted directly.
   * 2. Internal_only / internal sensitivity: Excluded strictly before prompt construction.
   * 3. Approved_summary_only: Replaces chunk with the explicitly approved summary.
   *    If no approved summary exists or status != 'approved', chunk is strictly excluded.
   * 4. Restricted sensitivity / restricted policy: Excluded by default.
   * 5. Tenant Isolation: Customer users can only receive global or own-tenant evidence.
   *
   * Internal Mode Rules:
   * 1. Employees may receive internal-only notes and troubleshooting details.
   * 2. Restricted documents still require explicit security clearance.
   */
  async evaluateEvidence(options: EvaluateDisclosureOptions): Promise<DisclosureEvaluationResult> {
    const { chunks, audience, user, tenantScope } = options;

    const permitted: PermittedEvidenceItem[] = [];
    const excluded: ExcludedEvidenceItem[] = [];
    const processedSummaryDocIds = new Set<string>();
    let summariesApplied = 0;

    for (const chunk of chunks) {
      // 1. Sanitize policy metadata with deny-by-default behavior
      const chunkMeta = chunk.metadata || {};
      const sanitized = sanitizePolicyMetadata({
        sensitivity: chunkMeta.sensitivity,
        disclosure_policy: chunkMeta.disclosure_policy,
      });

      const sensitivity = sanitized.sensitivity;
      const policy = sanitized.disclosure_policy;
      const tenantId = chunkMeta.tenant_id || 'global';
      const docId = chunk.document_id;
      const chunkIndex = chunk.chunk_index;

      // 2. Tenant quarantine check in customer-facing mode
      if (audience === 'customer') {
        const allowedTenant =
          tenantId === 'global' ||
          (tenantScope && (tenantScope.includes('*') || tenantScope.includes(tenantId))) ||
          user.tenant_scope.includes('*') ||
          user.tenant_scope.includes(tenantId);

        if (!allowedTenant) {
          excluded.push({
            document_id: docId,
            chunk_index: chunkIndex,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            reason: `CROSS_TENANT_DISCLOSURE_DENIED: Tenant '${tenantId}' is not authorized for customer audience`,
          });
          continue;
        }

        // 3. Prohibit restricted content from customer answers under all circumstances
        if (sensitivity === 'restricted' || policy === 'restricted') {
          excluded.push({
            document_id: docId,
            chunk_index: chunkIndex,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            reason: 'RESTRICTED_DISCLOSURE_PROHIBITED: Restricted material cannot be disclosed to customer audience',
          });
          continue;
        }

        // 4. Prohibit internal_only content from customer answers
        if (policy === 'internal_only' || (sensitivity === 'internal' && policy !== 'customer_shareable' && policy !== 'approved_summary_only')) {
          excluded.push({
            document_id: docId,
            chunk_index: chunkIndex,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            reason: 'INTERNAL_ONLY_PROHIBITED: Internal documentation and notes cannot be disclosed in customer-facing mode',
          });
          continue;
        }

        // 5. Handle approved_summary_only policy
        if (policy === 'approved_summary_only') {
          // If we already emitted the approved summary for this document, skip duplicate chunks
          if (processedSummaryDocIds.has(docId)) {
            continue;
          }

          const approvedSummary = await this.getApprovedSummary(docId, 'customer');

          if (!approvedSummary || approvedSummary.status !== 'approved' || !approvedSummary.summary_text.trim()) {
            excluded.push({
              document_id: docId,
              chunk_index: chunkIndex,
              tenant_id: tenantId,
              sensitivity,
              disclosure_policy: policy,
              reason: 'APPROVED_SUMMARY_UNAVAILABLE: Document requires approved summary for customer disclosure, but no active approved summary is on record',
            });
            continue;
          }

          processedSummaryDocIds.add(docId);
          summariesApplied++;

          permitted.push({
            document_id: docId,
            chunk_index: chunkIndex,
            content: approvedSummary.summary_text.trim(),
            is_summary: true,
            summary_id: approvedSummary.id,
            title: chunkMeta.title || docId,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            section_heading: 'Approved Customer Summary',
            similarity: chunk.similarity,
          });
          continue;
        }

        // 6. Direct customer-shareable / public content
        if (policy === 'customer_shareable' || policy === 'direct' || sensitivity === 'public') {
          permitted.push({
            document_id: docId,
            chunk_index: chunkIndex,
            content: chunk.content,
            is_summary: false,
            title: chunkMeta.title || docId,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            section_heading: chunkMeta.section_heading,
            similarity: chunk.similarity,
          });
          continue;
        }

        // Deny-by-default for any unhandled combination in customer mode
        excluded.push({
          document_id: docId,
          chunk_index: chunkIndex,
          tenant_id: tenantId,
          sensitivity,
          disclosure_policy: policy,
          reason: 'DENY_BY_DEFAULT: Evidence policy does not explicitly permit customer disclosure',
        });
      } else {
        // --- INTERNAL MODE ---
        if (user.user_type !== 'employee') {
          excluded.push({
            document_id: docId,
            chunk_index: chunkIndex,
            tenant_id: tenantId,
            sensitivity,
            disclosure_policy: policy,
            reason: 'INTERNAL_AUDIENCE_UNAUTHORIZED: Internal mode is restricted to CloudDesk employees',
          });
          continue;
        }

        // Restricted sensitivity in internal mode requires security clearance
        if (sensitivity === 'restricted' || policy === 'restricted') {
          const hasClearance =
            user.groups.includes('grp_security_restricted') ||
            user.groups.includes('grp_incident_review');

          if (!hasClearance) {
            excluded.push({
              document_id: docId,
              chunk_index: chunkIndex,
              tenant_id: tenantId,
              sensitivity,
              disclosure_policy: policy,
              reason: 'RESTRICTED_CLEARANCE_REQUIRED: Restricted evidence requires security clearance',
            });
            continue;
          }
        }

        // Internal mode permits full original chunk content
        permitted.push({
          document_id: docId,
          chunk_index: chunkIndex,
          content: chunk.content,
          is_summary: false,
          title: chunkMeta.title || docId,
          tenant_id: tenantId,
          sensitivity,
          disclosure_policy: policy,
          section_heading: chunkMeta.section_heading,
          similarity: chunk.similarity,
        });
      }
    }

    return {
      audience,
      permitted_evidence: permitted,
      excluded_evidence: excluded,
      diagnostics: {
        total_evaluated: chunks.length,
        permitted_count: permitted.length,
        excluded_count: excluded.length,
        summaries_applied: summariesApplied,
      },
    };
  }
}

export const disclosurePolicyService = new DisclosurePolicyService();

