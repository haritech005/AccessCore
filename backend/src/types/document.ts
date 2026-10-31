import { z } from 'zod';

export const DocumentTypeEnum = z.enum([
  'product_doc',
  'policy',
  'runbook',
  'incident_report',
  'support_ticket',
  'customer_record',
  'test_case',
  'formal_pdf',
]);
export type DocumentType = z.infer<typeof DocumentTypeEnum>;

export const OwnerTeamEnum = z.enum([
  'customer_support',
  'customer_success',
  'engineering',
  'it_security',
]);
export type OwnerTeam = z.infer<typeof OwnerTeamEnum>;

export const SensitivityEnum = z.enum([
  'public',
  'internal',
  'confidential',
  'restricted',
]);
export type Sensitivity = z.infer<typeof SensitivityEnum>;

export const DisclosurePolicyEnum = z.enum([
  'customer_shareable',
  'internal_only',
  'approved_summary_only',
]);
export type DisclosurePolicy = z.infer<typeof DisclosurePolicyEnum>;

export const TenantIdEnum = z.enum([
  'global',
  'ten_brightwave',
  'ten_harborpine',
  'ten_lumenfield',
]);
export type TenantId = z.infer<typeof TenantIdEnum> | string;

export const DocumentFormatEnum = z.enum(['pdf', 'markdown', 'json']);
export type DocumentFormat = z.infer<typeof DocumentFormatEnum>;

export const IngestionStatusEnum = z.enum([
  'pending',
  'parsing',
  'chunking',
  'embedding',
  'completed',
  'failed',
]);
export type IngestionStatus = z.infer<typeof IngestionStatusEnum>;

// Blueprint-compliant Document Metadata Schema
export const DocumentMetadataSchema = z
  .object({
    document_id: z
      .string()
      .regex(/^[A-Z]{2,4}-[0-9]{3,5}$/, 'Invalid document_id format (expected e.g. PDOC-0001, TKT-10421)'),
    title: z.string().min(1, 'Title cannot be empty'),
    document_type: DocumentTypeEnum,
    tenant_id: z.string().min(1),
    owner_team: OwnerTeamEnum,
    allowed_groups: z.array(z.string()).min(1, 'allowed_groups must have at least one group'),
    sensitivity: SensitivityEnum,
    disclosure_policy: DisclosurePolicyEnum,
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    version: z.string().default('1.0'),
  })
  .refine(
    (data) => {
      // Blueprint Section 6.3 - Policy validation rules
      if (data.sensitivity === 'public') {
        return data.disclosure_policy === 'customer_shareable';
      }
      if (data.sensitivity === 'confidential' || data.sensitivity === 'restricted') {
        return (
          data.disclosure_policy === 'internal_only' ||
          data.disclosure_policy === 'approved_summary_only'
        );
      }
      return true; // internal can be any
    },
    {
      message: 'Invalid combination of sensitivity and disclosure_policy per CloudDesk blueprint',
      path: ['disclosure_policy'],
    }
  );

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

// Normalized representation of parsed documents across all input formats
export interface ParsedDocument {
  document_id: string;
  title: string;
  filename: string;
  format: DocumentFormat;
  content: string;
  metadata: DocumentMetadata;
  content_hash: string;
  raw_data?: Record<string, unknown>;
}

// Extracted text chunk suitable for vector embedding and retrieval
export interface DocumentChunk {
  id?: string;
  document_id: string;
  version_id?: string;
  chunk_index: number;
  content: string;
  embedding?: number[];
  metadata: {
    document_id: string;
    title: string;
    tenant_id: string;
    allowed_groups: string[];
    sensitivity: Sensitivity;
    disclosure_policy: DisclosurePolicy;
    section_heading?: string;
    page_number?: number;
    start_char?: number;
    end_char?: number;
  };
  is_active: boolean;
}

// Ingestion Pipeline Request and Response Contracts
export interface IngestionRequest {
  filename: string;
  format: DocumentFormat;
  content: Buffer | string;
  override_metadata?: Partial<DocumentMetadata>;
}

export interface IngestionResult {
  document_id: string;
  version: number;
  status: IngestionStatus;
  chunks_count: number;
  content_hash: string;
  error_message?: string;
  completed_at: string;
}

export interface DocumentRecord {
  id: string;
  document_id: string;
  title: string;
  filename: string;
  format: string;
  current_version: number;
  status: string;
  error_message?: string;
  metadata?: Partial<DocumentMetadata> & Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
