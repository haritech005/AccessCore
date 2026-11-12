import React from 'react';

export const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential', 'restricted'] as const;

export const DISCLOSURE_OPTIONS = [
  'customer_shareable',
  'approved_summary_only',
  'internal_only',
  'restricted',
  'direct',
] as const;

export const DOCUMENT_TYPE_OPTIONS = [
  'product_doc',
  'policy',
  'runbook',
  'incident_report',
  'support_ticket',
  'customer_record',
  'test_case',
  'formal_pdf',
] as const;

export const OWNER_TEAM_OPTIONS = [
  'customer_support',
  'customer_success',
  'engineering',
  'it_security',
] as const;

export function formatAdminLabel(val: string): string {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getSensitivityPillStyle(sensitivity: string): React.CSSProperties {
  if (sensitivity === 'restricted') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.35)',
      color: '#fca5a5',
    };
  }
  if (sensitivity === 'confidential') {
    return {
      backgroundColor: 'rgba(245, 158, 11, 0.14)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      color: '#fcd34d',
    };
  }
  if (sensitivity === 'public') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.35)',
      color: '#6ee7b7',
    };
  }
  return {
    backgroundColor: 'rgba(99, 102, 241, 0.14)',
    border: '1px solid rgba(99, 102, 241, 0.35)',
    color: '#c7d2fe',
  };
}

export function getDisclosurePillStyle(policy: string): React.CSSProperties {
  if (policy === 'customer_shareable' || policy === 'direct') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      color: '#6ee7b7',
    };
  }
  if (policy === 'approved_summary_only') {
    return {
      backgroundColor: 'rgba(56, 189, 248, 0.14)',
      border: '1px solid rgba(56, 189, 248, 0.3)',
      color: '#7dd3fc',
    };
  }
  if (policy === 'restricted') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      color: '#fca5a5',
    };
  }
  return {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    color: '#cbd5e1',
  };
}

export const MODAL_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: '8px',
  border: '1px solid #242a3d',
  backgroundColor: '#141926',
  color: '#eef0f6',
  fontSize: '0.84rem',
  outline: 'none',
};

export const MODAL_LABEL_STYLE: React.CSSProperties = {
  display: 'block',
  fontSize: '0.74rem',
  fontWeight: 600,
  color: '#9ba3b8',
  marginBottom: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

