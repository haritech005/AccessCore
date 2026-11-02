import { PermittedEvidenceItem, disclosurePolicyService } from './disclosurePolicyService';
import { AudienceMode } from '../types/policy';
import { AuthenticatedUser } from '../types/identity';
import { Citation } from '../types/rag';

export interface ValidationParams {
  answer: string;
  permittedEvidence: PermittedEvidenceItem[];
  audience: AudienceMode;
  user?: AuthenticatedUser;
  tenantScope?: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  detail?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface CitationValidationResult {
  valid: boolean;
  validCitations: Citation[];
  rejectedCitations: { citation: Citation; reason: string }[];
}

export const POLICY_VIOLATION_MESSAGE =
  'I cannot provide an answer to this question under the current disclosure policies and audience permissions.';

export class PostGenerationValidator {
  /**
   * Deterministically validates a generated RAG answer against disclosure policies,
   * permitted evidence boundaries, tenant isolation, and prompt injection/secret leakage.
   */
  public validateAnswer(params: ValidationParams): ValidationResult {
    const { answer, permittedEvidence, audience, user, tenantScope } = params;
    const issues: ValidationIssue[] = [];

    if (!answer || answer.trim().length === 0) {
      return { valid: true, issues: [] };
    }

    // 1. Permitted Evidence & Document Citation Groundedness Check
    const permittedDocIds = new Set(permittedEvidence.map((e) => e.document_id));
    const mentionedDocIds = this.extractDocumentIds(answer);

    for (const docId of mentionedDocIds) {
      if (!permittedDocIds.has(docId)) {
        issues.push({
          code: 'UNPERMITTED_DOCUMENT_MENTION',
          message: `Answer cites document '${docId}' which is not in permitted evidence for audience '${audience}'.`,
          detail: docId,
        });
      }
    }

    // 2. Secret & System Instruction Leakage Check (Applies to all audiences)
    const secretIssue = this.checkSecretsAndDelimiters(answer);
    if (secretIssue) {
      issues.push(secretIssue);
    }

    // 3. Customer-Facing Audience Specific Checks
    if (audience === 'customer') {
      // 3a. Internal employee ID leaks (e.g. emp_001, emp_002)
      const empMatches = answer.match(/\bemp_[0-9a-z_]+\b/gi);
      if (empMatches && empMatches.length > 0) {
        issues.push({
          code: 'EMPLOYEE_ID_LEAK',
          message: `Customer-facing answer contains internal employee identifier: ${empMatches[0]}`,
          detail: empMatches.join(', '),
        });
      }

      // 3b. Internal permission group leaks (e.g. grp_all_employees, grp_support)
      const grpMatches = answer.match(/\bgrp_(all_employees|support|engineering|incident_review|security_restricted|executive_leadership)\b/gi);
      if (grpMatches && grpMatches.length > 0) {
        issues.push({
          code: 'INTERNAL_GROUP_LEAK',
          message: `Customer-facing answer contains internal group identifier: ${grpMatches[0]}`,
          detail: grpMatches.join(', '),
        });
      }

      // 3c. Internal runbook leaks (e.g. PDOC-0001, Webhook Delivery Troubleshooting)
      if (/\bPDOC-0001\b/i.test(answer) || /dispatcher\s+recovery/i.test(answer)) {
        issues.push({
          code: 'INTERNAL_RUNBOOK_LEAK',
          message: 'Customer-facing answer references internal troubleshooting runbook or dispatcher recovery.',
        });
      }

      // 3d. Unapproved internal ticket details leak (e.g. unconfirmed endpoint latency, queue backlog)
      const internalDiagnosticPhrases = [
        'unconfirmed endpoint latency',
        'endpoint latency and queue backlog',
        'escalate to engineering',
        'internal note',
        'internal notes',
      ];
      for (const phrase of internalDiagnosticPhrases) {
        if (answer.toLowerCase().includes(phrase)) {
          issues.push({
            code: 'INTERNAL_DIAGNOSTIC_LEAK',
            message: `Customer-facing answer reveals unapproved internal diagnostic detail: '${phrase}'`,
            detail: phrase,
          });
        }
      }
    }

    // 4. Cross-Tenant Isolation Check
    const crossTenantIssue = this.checkCrossTenantIsolation(answer, permittedEvidence, user, tenantScope);
    if (crossTenantIssue) {
      issues.push(crossTenantIssue);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Validates citations to ensure none reference prohibited or internal-only documents
   * when serving a customer audience, and that approved summary citations are flagged properly.
   */
  public validateCitations(
    citations: Citation[],
    permittedEvidence: PermittedEvidenceItem[],
    audience: AudienceMode
  ): CitationValidationResult {
    const permittedMap = new Map(permittedEvidence.map((e) => [e.document_id, e]));
    const validCitations: Citation[] = [];
    const rejectedCitations: { citation: Citation; reason: string }[] = [];

    for (const citation of citations) {
      const permitted = permittedMap.get(citation.document_id);

      if (!permitted) {
        rejectedCitations.push({
          citation,
          reason: `Document '${citation.document_id}' is not in permitted evidence for audience '${audience}'.`,
        });
        continue;
      }

      if (audience === 'customer') {
        if (citation.disclosure_policy === 'internal_only' || permitted.disclosure_policy === 'internal_only') {
          rejectedCitations.push({
            citation,
            reason: `Citation '${citation.document_id}' has internal_only disclosure policy and cannot be cited in customer mode.`,
          });
          continue;
        }

        if (citation.sensitivity === 'restricted' || permitted.sensitivity === 'restricted') {
          rejectedCitations.push({
            citation,
            reason: `Citation '${citation.document_id}' has restricted sensitivity and cannot be cited in customer mode.`,
          });
          continue;
        }

        // For approved_summary_only tickets in customer mode, the snippet must be from the approved summary
        if (permitted.is_summary) {
          validCitations.push({
            ...citation,
            is_summary: true,
            snippet: permitted.content.slice(0, 200) + (permitted.content.length > 200 ? '...' : ''),
          });
          continue;
        }
      }

      validCitations.push(citation);
    }

    return {
      valid: rejectedCitations.length === 0,
      validCitations,
      rejectedCitations,
    };
  }

  /**
   * Extracts document IDs matching standard CloudDesk patterns (e.g. PDOC-0001, TKT-10421, SEC-REST-01).
   * Carefully distinguishes document identifiers from CloudDesk error codes like CD-WHK-504.
   */
  public extractDocumentIds(text: string): string[] {
    // 1. Bracketed document citations, e.g. [TKT-10421], [PDOC-0002]
    const bracketMatches = [...text.matchAll(/\[([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);

    // 2. Bare document prefixes (PDOC, TKT, SEC)
    const prefixMatches = text.match(/\b(PDOC-[0-9]{4}|TKT-[0-9]{5}|SEC-[A-Za-z0-9_-]+)\b/g) || [];

    const combined = [...bracketMatches, ...prefixMatches];
    // Filter out error codes (CD-WHK-504, CD-API-429, CD-SSO-403) and general non-document tags
    const filtered = combined.filter((id) => !/^CD-[A-Z]{3}-[0-9]{3}$/i.test(id) && !/^CD-/i.test(id));
    return Array.from(new Set(filtered));
  }

  /**
   * Checks for exposed system secrets, API keys, or prompt-injection boundary delimiters.
   */
  private checkSecretsAndDelimiters(answer: string): ValidationIssue | null {
    if (/\bSEC-[A-Z0-9-]+\b/i.test(answer)) {
      return {
        code: 'SECRET_TOKEN_LEAK',
        message: 'Answer reveals internal security secret token pattern (SEC-...).',
      };
    }

    if (
      answer.includes('<<<BEGIN_UNTRUSTED_DOCUMENT_EVIDENCE>>>') ||
      answer.includes('<<<END_UNTRUSTED_DOCUMENT_EVIDENCE>>>') ||
      answer.includes('<<<SYSTEM OVERRIDE>>>')
    ) {
      return {
        code: 'PROMPT_DELIMITER_LEAK',
        message: 'Answer contains raw internal prompt boundary delimiters.',
      };
    }

    if (/ignore\s+all\s+(?:previous\s+)?instructions/i.test(answer)) {
      return {
        code: 'PROMPT_INJECTION_REFLECTED',
        message: 'Answer reflects adversarial prompt-injection instruction phrase.',
      };
    }

    return null;
  }

  /**
   * Checks whether the generated answer discloses foreign tenant names or tenant IDs.
   */
  private checkCrossTenantIsolation(
    answer: string,
    permittedEvidence: PermittedEvidenceItem[],
    user?: AuthenticatedUser,
    tenantScope?: string[]
  ): ValidationIssue | null {
    const allowedTenants = new Set<string>();

    if (user?.has_wildcard_tenant) {
      return null; // Wildcard users are authorized across tenants
    }

    if (user?.tenant_scope) {
      for (const t of user.tenant_scope) allowedTenants.add(t);
    }
    if (tenantScope) {
      for (const t of tenantScope) allowedTenants.add(t);
    }
    allowedTenants.add('global');

    // Tenant definitions from CloudDesk identity catalog
    const knownTenants: { id: string; name: string }[] = [
      { id: 'ten_brightwave', name: 'brightwave' },
      { id: 'ten_harborpine', name: 'harborpine' },
      { id: 'ten_lumenfield', name: 'lumenfield' },
    ];

    const lowerAnswer = answer.toLowerCase();

    for (const tenant of knownTenants) {
      // If tenant is NOT in user's authorized scope
      if (!allowedTenants.has(tenant.id)) {
        // Check if tenant ID is mentioned
        if (lowerAnswer.includes(tenant.id)) {
          return {
            code: 'CROSS_TENANT_ID_LEAK',
            message: `Cross-tenant violation: answer mentions unauthorized tenant ID '${tenant.id}'.`,
            detail: tenant.id,
          };
        }

        // Check if tenant business name is mentioned (unless explicitly present in permitted global evidence)
        const isPermittedInGlobal = permittedEvidence.some(
          (e) => e.tenant_id === 'global' && e.content.toLowerCase().includes(tenant.name)
        );
        if (!isPermittedInGlobal && new RegExp(`\\b${tenant.name}\\b`, 'i').test(answer)) {
          return {
            code: 'CROSS_TENANT_NAME_LEAK',
            message: `Cross-tenant violation: answer mentions unauthorized tenant name '${tenant.name}'.`,
            detail: tenant.name,
          };
        }
      }
    }

    return null;
  }
}

export const postGenerationValidator = new PostGenerationValidator();

