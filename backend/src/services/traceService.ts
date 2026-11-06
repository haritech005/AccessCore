import crypto from 'crypto';
import { AudienceMode } from '../types/policy';
import { AuthenticatedUser } from '../types/identity';

export type TraceOutcomeStatus =
  | 'success'
  | 'insufficient_evidence'
  | 'unauthorized_access'
  | 'policy_violated'
  | 'error';

export interface CondensationTraceSpan {
  duration_ms: number;
  was_condensed: boolean;
  original_query_length: number;
  condensed_query_length?: number;
}

export interface RetrievalTraceSpan {
  duration_ms: number;
  strategy: 'hybrid' | 'vector' | 'fts';
  vector_pool_count: number;
  fts_pool_count: number;
  fused_count: number;
  top_k: number;
  candidate_document_ids: string[]; // Document identifiers only (Data Minimization)
  top_matched_document_id?: string;
  has_blocked_top_match?: boolean;
}

export interface DisclosureFilteringTraceSpan {
  duration_ms: number;
  input_chunks_count: number;
  permitted_chunks_count: number;
  filtered_chunks_count: number;
  permitted_document_ids: string[];
}

export interface GenerationTraceSpan {
  duration_ms: number;
  model: string;
  evidence_items_supplied: number;
  retried_bounded_generation: boolean;
}

export interface ValidationTraceSpan {
  duration_ms: number;
  answer_valid: boolean;
  policy_violated: boolean;
}

export interface CitationTraceSpan {
  count: number;
  cited_document_ids: string[];
  summary_citations_count: number;
}

export interface PipelineTrace {
  trace_id: string;
  timestamp: string;
  user: {
    id: string;
    role: string;
    tenant_scope: string[];
  };
  audience: AudienceMode;
  request: {
    question_length: number;
    was_condensed: boolean;
  };
  stages: {
    condensation?: CondensationTraceSpan;
    retrieval: RetrievalTraceSpan;
    disclosure_filtering?: DisclosureFilteringTraceSpan;
    generation: GenerationTraceSpan;
    validation: ValidationTraceSpan;
    citations: CitationTraceSpan;
  };
  outcome: {
    status: TraceOutcomeStatus;
    insufficient_evidence: boolean;
    unauthorized_access: boolean;
    policy_violated: boolean;
    error_message?: string;
  };
  total_latency_ms: number;
}

/**
 * Central Tracing & Observability Service for AccessCore
 * Enforces strict data-minimization (NO passwords, NO raw chunk text, NO bearer tokens).
 */
export class TraceService {
  private static readonly MAX_BUFFER_SIZE = 200;
  private traces: PipelineTrace[] = [];

  /**
   * Generates a new unique trace ID (UUID v4).
   */
  public generateTraceId(): string {
    return crypto.randomUUID();
  }

  /**
   * Records a completed pipeline trace into the in-memory circular buffer.
   */
  public recordTrace(trace: PipelineTrace): void {
    if (this.traces.length >= TraceService.MAX_BUFFER_SIZE) {
      this.traces.shift(); // Evict oldest trace
    }
    this.traces.push(trace);
  }

  /**
   * Retrieves a single trace by ID.
   */
  public getTrace(traceId: string): PipelineTrace | undefined {
    return this.traces.find((t) => t.trace_id === traceId);
  }

  /**
   * Lists recent traces with optional filtering.
   */
  public listTraces(options?: {
    limit?: number;
    userId?: string;
    audience?: AudienceMode;
    status?: TraceOutcomeStatus;
  }): PipelineTrace[] {
    let result = [...this.traces].reverse();

    if (options?.userId) {
      result = result.filter((t) => t.user.id === options.userId);
    }
    if (options?.audience) {
      result = result.filter((t) => t.audience === options.audience);
    }
    if (options?.status) {
      result = result.filter((t) => t.outcome.status === options.status);
    }
    if (options?.limit && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * Sanitizes a trace for access-controlled inspection.
   * Enforces privacy & data-minimization:
   * - Non-admin users can only view their own traces.
   * - Cross-tenant document IDs are redacted if requester lacks tenant scope.
   */
  public sanitizeForViewer(
    trace: PipelineTrace,
    requester: AuthenticatedUser
  ): PipelineTrace | null {
    const isGlobalAdmin =
      requester.role === 'admin' || requester.role === 'support_lead';
    const isOwner = requester.id === trace.user.id;

    if (!isGlobalAdmin && !isOwner) {
      return null; // Deny access to other users' traces
    }

    if (isGlobalAdmin) {
      return trace; // Admins have full observability
    }

    // Clone and sanitize for regular user
    const sanitized: PipelineTrace = JSON.parse(JSON.stringify(trace));
    const userTenants = new Set(requester.tenant_scope);

    // If candidate docs are outside requester's scope, filter them
    if (!userTenants.has('*')) {
      sanitized.stages.retrieval.candidate_document_ids =
        sanitized.stages.retrieval.candidate_document_ids.filter((docId) =>
          docId.startsWith('PDOC-') || !docId.includes('TKT-') // Allow public product docs
        );
    }

    return sanitized;
  }

  /**
   * Clears the trace buffer (used primarily in test suites).
   */
  public clearTraces(): void {
    this.traces = [];
  }

  /**
   * Returns current trace count in buffer.
   */
  public getTraceCount(): number {
    return this.traces.length;
  }
}

export const traceService = new TraceService();

