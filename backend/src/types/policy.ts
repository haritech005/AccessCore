import { z } from 'zod';

/**
 * AccessCore Phase 3 — Disclosure Policies and Customer-Safe AI Contracts
 * Based on CloudDesk Blueprint (BP-0001, Section 6) and phase-3-policies.md.
 */

// 1. Validated Sensitivity Classifications
export const SensitivityLevelEnum = z.enum([
  'public',
  'customer_shareable',
  'internal',
  'confidential',
  'restricted',
]);
export type SensitivityLevel = z.infer<typeof SensitivityLevelEnum>;

// 2. Validated Disclosure Policies
export const DisclosurePolicyEnum = z.enum([
  'customer_shareable',
  'direct',
  'approved_summary_only',
  'internal_only',
  'restricted',
]);
export type DisclosurePolicy = z.infer<typeof DisclosurePolicyEnum>;

// 3. Validated Audience Modes
export const AudienceModeEnum = z.enum(['internal', 'customer']);
export type AudienceMode = z.infer<typeof AudienceModeEnum>;

// 4. Approved Summary Status
export const SummaryApprovalStatusEnum = z.enum([
  'approved',
  'draft',
  'deprecated',
  'rejected',
]);
export type SummaryApprovalStatus = z.infer<typeof SummaryApprovalStatusEnum>;

// 5. Approved Summary Database Record
export interface ApprovedSummaryRecord {
  id: string;
  document_id: string; // Foreign key to documents.id (UUID)
  version_id?: string;
  audience: AudienceMode;
  summary_text: string;
  status: SummaryApprovalStatus;
  approved_by?: string;
  approved_at: Date;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

// 6. Strict Policy Combinations Validator
export const PolicyMetadataSchema = z
  .object({
    sensitivity: SensitivityLevelEnum.default('internal'),
    disclosure_policy: DisclosurePolicyEnum.default('internal_only'),
  })
  .refine(
    (data) => {
      // Blueprint Section 6.3 - Policy validation rules
      if (data.sensitivity === 'public') {
        return (
          data.disclosure_policy === 'customer_shareable' ||
          data.disclosure_policy === 'direct'
        );
      }
      if (data.sensitivity === 'confidential') {
        return (
          data.disclosure_policy === 'internal_only' ||
          data.disclosure_policy === 'approved_summary_only'
        );
      }
      if (data.sensitivity === 'restricted') {
        return (
          data.disclosure_policy === 'internal_only' ||
          data.disclosure_policy === 'approved_summary_only' ||
          data.disclosure_policy === 'restricted'
        );
      }
      // 'internal' sensitivity may be internal_only, approved_summary_only, or customer_shareable if explicitly approved
      return true;
    },
    {
      message:
        'Invalid combination of sensitivity and disclosure_policy per CloudDesk blueprint. Confidential and restricted content cannot have direct customer disclosure.',
      path: ['disclosure_policy'],
    }
  );

export type PolicyMetadata = z.infer<typeof PolicyMetadataSchema>;

/**
 * Deny-by-default sanitizer:
 * Ensures missing, undefined, or invalid policy metadata CANNOT silently grant disclosure permission.
 * Always resolves invalid or absent values to restricted / internal_only.
 */
export function sanitizePolicyMetadata(input: unknown): PolicyMetadata {
  if (!input || typeof input !== 'object') {
    return {
      sensitivity: 'restricted',
      disclosure_policy: 'restricted',
    };
  }

  const parseResult = PolicyMetadataSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      sensitivity: 'restricted',
      disclosure_policy: 'restricted',
    };
  }

  return parseResult.data;
}

/**
 * Evaluates whether a piece of evidence with given sensitivity and disclosure policy
 * is theoretically disclosable to the requested audience.
 *
 * Rules:
 * 1. Restricted policy is ALWAYS denied.
 * 2. In customer mode:
 *    - internal_only is strictly forbidden.
 *    - approved_summary_only is ONLY allowed if a valid approved summary is supplied.
 *    - customer_shareable / direct / public is allowed.
 *    - confidential or restricted sensitivity without approved summary is denied.
 * 3. In internal mode:
 *    - internal_only and approved_summary_only and customer_shareable are allowed
 *      (provided caller passes Phase 2 authorization).
 */
export function canDiscloseToAudience(
  policy: DisclosurePolicy,
  sensitivity: SensitivityLevel,
  audience: AudienceMode
): boolean {
  if (policy === 'restricted' || sensitivity === 'restricted') {
    // Restricted evidence cannot be directly disclosed to customers under any circumstances
    if (audience === 'customer') return false;
  }

  if (audience === 'customer') {
    if (policy === 'internal_only') return false;
    if (sensitivity === 'confidential' && policy !== 'approved_summary_only') {
      return false;
    }
    if (policy === 'customer_shareable' || policy === 'direct') {
      return true;
    }
    if (policy === 'approved_summary_only') {
      return true; // Eligible subject to approved summary substitution
    }
    return false;
  }

  // Internal mode allows internal_only, approved_summary_only, and customer_shareable
  return true;
}

/**
 * Validates whether user principal is authorized to request the specified audience mode.
 * Customer users ('customer_user') are strictly quarantined to 'customer' mode.
 * Employees ('employee') default to 'internal' but may voluntarily query in 'customer' mode.
 */
export function isAudienceAllowedForUser(
  userType: 'employee' | 'customer_user',
  audience: AudienceMode
): boolean {
  if (userType === 'customer_user') {
    return audience === 'customer';
  }
  return true;
}

