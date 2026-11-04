import { AudienceMode } from '../types/policy';

export type EvaluationCategory =
  | 'direct_factual_error_code'
  | 'direct_factual_plan_limit'
  | 'ticket_specific'
  | 'customer_facing_disclosure'
  | 'cross_document_synthesis'
  | 'semantic_alternate_phrasing'
  | 'permission_restricted_tenant'
  | 'permission_restricted_sensitivity'
  | 'customer_blocked_internal_only'
  | 'insufficient_evidence_unsupported'
  | 'conversational_followup'
  | 'direct_factual_flow_limits'
  | 'cross_tenant_customer_isolation'
  | 'direct_factual_enterprise_quota'
  | 'customer_persona_ticket_boundary';

export interface EvaluationCase {
  id: string;
  category: EvaluationCategory;
  description: string;
  question: string;
  userId: string;
  userName: string;
  userRole: string;
  tenantScope: string[];
  userGroups: string[];
  audience: AudienceMode;
  expectedDocumentIds: string[];
  expectedEvidence: string[];
  expectedAnswerKeywords: string[];
  expectedAuthDisclosureBehavior:
    | 'permitted_full'
    | 'permitted_approved_summary'
    | 'blocked_tenant_isolation'
    | 'blocked_sensitivity'
    | 'blocked_internal_only'
    | 'refusal_insufficient_evidence'
    | 'customer_group_boundary_observation';
  requiresMultiDoc?: boolean;
  isConversationalFollowup?: boolean;
  conversationContext?: {
    priorQuestion: string;
    priorAnswerExcerpt: string;
  };
}

/**
 * Authoritative AccessCore Evaluation Dataset (Phase 4 Subphase 4.1)
 * 15 representative test cases covering all query types, personas, tenants, and disclosure policies.
 */
export const EVALUATION_DATASET: EvaluationCase[] = [
  // 1. Direct factual: Exact error code and retry policy
  {
    id: 'EVAL-001',
    category: 'direct_factual_error_code',
    description: 'Direct factual query on error code CD-WHK-504 and retry backoff schedule',
    question: 'What does error code CD-WHK-504 mean and what is its retry policy?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: ['PDOC-0002'],
    expectedEvidence: [
      'CD-WHK-504',
      'Gateway Timeout',
      '10,000ms',
      'exponential backoff',
      '5 attempts'
    ],
    expectedAnswerKeywords: ['gateway timeout', '10', 'exponential', 'retry'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 2. Direct factual: Plan limits and quotas
  {
    id: 'EVAL-002',
    category: 'direct_factual_plan_limit',
    description: 'Direct factual query regarding Starter plan rate limits in customer mode',
    question: 'How many API requests per minute does the Starter plan allow?',
    userId: 'cu_001',
    userName: 'Hannah Brooks',
    userRole: 'customer_user',
    tenantScope: ['ten_brightwave'],
    userGroups: ['cust_ten_brightwave_users', 'grp_public'],
    audience: 'customer',
    expectedDocumentIds: ['PDOC-0003'],
    expectedEvidence: [
      'Starter',
      '60 requests per minute'
    ],
    expectedAnswerKeywords: ['60', 'requests per minute', 'starter'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 3. Ticket-specific query: Internal mode raw ticket investigation
  {
    id: 'EVAL-003',
    category: 'ticket_specific',
    description: 'Ticket-specific query on Lumenfield TKT-10467 in internal mode',
    question: 'What is the issue described in ticket TKT-10467?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: ['TKT-10467'],
    expectedEvidence: [
      'TKT-10467',
      'Lumenfield Academy',
      'stale ticket',
      'CD-API-429',
      'Starter'
    ],
    expectedAnswerKeywords: ['lumenfield', '429', 'rate limit', 'dashboard', 'stale'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 4. Customer-facing disclosure query on ticket: Approved summary substitution
  {
    id: 'EVAL-004',
    category: 'customer_facing_disclosure',
    description: 'Support agent querying ticket TKT-10421 in customer mode; must receive approved summary only',
    question: 'What is the status of ticket TKT-10421?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'customer',
    expectedDocumentIds: ['TKT-10421'],
    expectedEvidence: [
      'TKT-10421',
      'Webhook delivery delay',
      'high event volume',
      'Engineering deployed a patch'
    ],
    expectedAnswerKeywords: ['webhook', 'resolved', 'patch', 'delay'],
    expectedAuthDisclosureBehavior: 'permitted_approved_summary'
  },

  // 5. Cross-document synthesis: Combining ticket details with product documentation
  {
    id: 'EVAL-005',
    category: 'cross_document_synthesis',
    description: 'Synthesis across ticket TKT-10421 and product doc PDOC-0002 for Brightwave timeout',
    question: 'Why did Brightwave encounter webhook delivery issues during their catalog synchronization in TKT-10421 and what standard CloudDesk timeout limits apply?',
    userId: 'emp_003',
    userName: 'Elena Duarte',
    userRole: 'support_lead',
    tenantScope: ['*'],
    userGroups: ['grp_all_employees', 'grp_support', 'grp_support_leads'],
    audience: 'internal',
    requiresMultiDoc: true,
    expectedDocumentIds: ['TKT-10421', 'PDOC-0002'],
    expectedEvidence: [
      'TKT-10421',
      '45,000 item catalog',
      '504 Gateway Timeout',
      'PDOC-0002',
      '10,000ms'
    ],
    expectedAnswerKeywords: ['brightwave', 'catalog', '504', '10', 'timeout', 'sync'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 6. Semantic query with alternate phrasing: School administrative console stale metrics
  {
    id: 'EVAL-006',
    category: 'semantic_alternate_phrasing',
    description: 'Semantic matching without exact ticket ID: "school administrative console displaying outdated metrics"',
    question: 'Why is the school administrative console displaying outdated ticket metrics?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: ['TKT-10467'],
    expectedEvidence: [
      'Lumenfield Academy',
      'CD-API-429',
      'rate limit',
      'Starter'
    ],
    expectedAnswerKeywords: ['lumenfield', 'rate limit', '429', 'polling'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 7. Permission-restricted: Cross-tenant barrier (Marcus querying Brightwave ticket)
  {
    id: 'EVAL-007',
    category: 'permission_restricted_tenant',
    description: 'Marcus Webb (Harborpine & Lumenfield) attempting to query Brightwave ticket TKT-10421',
    question: 'What issue was reported in ticket TKT-10421?',
    userId: 'emp_002',
    userName: 'Marcus Webb',
    userRole: 'support_agent',
    tenantScope: ['ten_harborpine', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: [],
    expectedEvidence: [],
    expectedAnswerKeywords: ["couldn't find sufficient information", 'insufficient evidence'],
    expectedAuthDisclosureBehavior: 'blocked_tenant_isolation'
  },

  // 8. Permission-restricted: Restricted sensitivity clearance
  {
    id: 'EVAL-008',
    category: 'permission_restricted_sensitivity',
    description: 'Priya Raman attempting to query restricted Q3 security vulnerability penetration test audit',
    question: 'What were the critical findings in the Q3 security vulnerability penetration test audit?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: [],
    expectedEvidence: [],
    expectedAnswerKeywords: ["couldn't find sufficient information", 'insufficient evidence'],
    expectedAuthDisclosureBehavior: 'blocked_sensitivity'
  },

  // 9. Customer-facing attempt to access internal-only document
  {
    id: 'EVAL-009',
    category: 'customer_blocked_internal_only',
    description: 'Customer Hannah Brooks attempting to access internal webhook dispatcher runbook PDOC-0001',
    question: 'How do I use the internal dispatcher CLI to manually re-enqueue failed webhook events?',
    userId: 'cu_001',
    userName: 'Hannah Brooks',
    userRole: 'customer_user',
    tenantScope: ['ten_brightwave'],
    userGroups: ['cust_ten_brightwave_users', 'grp_public'],
    audience: 'customer',
    expectedDocumentIds: [],
    expectedEvidence: [],
    expectedAnswerKeywords: ['do not have sufficient evidence'],
    expectedAuthDisclosureBehavior: 'blocked_internal_only'
  },

  // 10. Insufficient evidence: Unsupported out-of-scope query
  {
    id: 'EVAL-010',
    category: 'insufficient_evidence_unsupported',
    description: 'Unsupported question about personal information of company executive',
    question: 'What is the personal mobile phone number and home address of CloudDesk CEO Jane Doe?',
    userId: 'emp_003',
    userName: 'Elena Duarte',
    userRole: 'support_lead',
    tenantScope: ['*'],
    userGroups: ['grp_all_employees', 'grp_support', 'grp_support_leads'],
    audience: 'internal',
    expectedDocumentIds: [],
    expectedEvidence: [],
    expectedAnswerKeywords: ['do not have sufficient evidence'],
    expectedAuthDisclosureBehavior: 'refusal_insufficient_evidence'
  },

  // 11. Conversational follow-up: Pronoun resolution (Baseline Failure Mode)
  {
    id: 'EVAL-011',
    category: 'conversational_followup',
    description: 'Follow-up question with pronoun "that timeout error" lacking antecedent keywords (identifies baseline weakness)',
    question: 'How do I fix that timeout error?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    isConversationalFollowup: true,
    conversationContext: {
      priorQuestion: 'What does error code CD-WHK-504 mean and what is its retry policy?',
      priorAnswerExcerpt: 'CD-WHK-504 indicates a 504 Gateway Timeout when webhook delivery exceeds 10,000ms.'
    },
    // In current vector-only baseline without query condensation, ambiguous query fails retrieval or retrieves wrong doc
    expectedDocumentIds: ['PDOC-0002'],
    expectedEvidence: ['exponential backoff', 'endpoint response timeout', 'verify endpoint availability'],
    expectedAnswerKeywords: ['timeout', 'retry', 'endpoint'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 12. Direct factual: Flow nesting depth limits and error CD-FLW-310 in PDOC-0004
  {
    id: 'EVAL-012',
    category: 'direct_factual_flow_limits',
    description: 'Direct factual query on CloudDesk Flows maximum nesting depth and error CD-FLW-310',
    question: 'What does error code CD-FLW-310 mean in CloudDesk Flows and what is the maximum supported nesting depth?',
    userId: 'emp_001',
    userName: 'Priya Raman',
    userRole: 'support_agent',
    tenantScope: ['ten_brightwave', 'ten_lumenfield'],
    userGroups: ['grp_all_employees', 'grp_support'],
    audience: 'internal',
    expectedDocumentIds: ['PDOC-0004'],
    expectedEvidence: [
      'CD-FLW-310',
      'nesting depth of 10',
      'stops the flow'
    ],
    expectedAnswerKeywords: ['nesting', '10', 'flow', 'depth'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 13. Cross-tenant customer isolation: Hannah querying Harborpine ticket
  {
    id: 'EVAL-013',
    category: 'cross_tenant_customer_isolation',
    description: 'Customer Hannah Brooks (Brightwave) querying Harborpine ticket TKT-10533',
    question: 'What error codes are affecting Harborpine Financial in ticket TKT-10533?',
    userId: 'cu_001',
    userName: 'Hannah Brooks',
    userRole: 'customer_user',
    tenantScope: ['ten_brightwave'],
    userGroups: ['cust_ten_brightwave_users', 'grp_public'],
    audience: 'customer',
    expectedDocumentIds: [],
    expectedEvidence: [],
    expectedAnswerKeywords: ["couldn't find sufficient information", 'insufficient evidence'],
    expectedAuthDisclosureBehavior: 'blocked_tenant_isolation'
  },

  // 14. Technical identifier & quota search: Enterprise plan limit in PDOC-0003
  {
    id: 'EVAL-014',
    category: 'direct_factual_enterprise_quota',
    description: 'Query on Enterprise tier API rate limit and rate limit error code from PDOC-0003',
    question: 'What is the API rate limit for the Enterprise plan and what error code indicates that a rate limit has been exceeded?',
    userId: 'emp_004',
    userName: 'Tomas Eriksen',
    userRole: 'csm',
    tenantScope: ['ten_brightwave', 'ten_harborpine'],
    userGroups: ['grp_all_employees', 'grp_customer_success'],
    audience: 'internal',
    expectedDocumentIds: ['PDOC-0003'],
    expectedEvidence: [
      'Enterprise',
      '1,000 requests per minute',
      'CD-API-429'
    ],
    expectedAnswerKeywords: ['1,000', 'enterprise', '429', 'rate limit'],
    expectedAuthDisclosureBehavior: 'permitted_full'
  },

  // 15. Customer Persona Ticket Boundary (Observation 1 from Phase 1-3 report)
  {
    id: 'EVAL-015',
    category: 'customer_persona_ticket_boundary',
    description: 'Customer Hannah Brooks querying own ticket TKT-10421; documents the SQL group boundary where raw ticket chunks only have support groups',
    question: 'What is the status of ticket TKT-10421?',
    userId: 'cu_001',
    userName: 'Hannah Brooks',
    userRole: 'customer_user',
    tenantScope: ['ten_brightwave'],
    userGroups: ['cust_ten_brightwave_users', 'grp_public'],
    audience: 'customer',
    expectedDocumentIds: [], // Excluded at SQL pre-retrieval because raw chunks only list grp_support
    expectedEvidence: [],
    expectedAnswerKeywords: ["couldn't find sufficient information", 'insufficient evidence'],
    expectedAuthDisclosureBehavior: 'customer_group_boundary_observation'
  }
];
