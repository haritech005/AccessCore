'use client';

import React from 'react';
import { AdminAuditRecord } from '@/lib/api';
import { formatAdminLabel } from './documentGovernanceHelpers';

interface AuditMetadataModalProps {
  event: AdminAuditRecord | null;
  onClose: () => void;
}

export function AuditMetadataModal({ event, onClose }: AuditMetadataModalProps) {
  if (!event) return null;

  const outcomeColor =
    event.outcome === 'success' ? '#6ee7b7' : event.outcome === 'denied' ? '#fcd34d' : '#fca5a5';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Audit Event Details"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        backgroundColor: 'rgba(6, 9, 16, 0.78)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f1422',
          border: '1px solid #242a3d',
          borderRadius: '14px',
          padding: '24px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontFamily: 'monospace',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#a5b4fc',
                  backgroundColor: 'rgba(99, 102, 241, 0.14)',
                  padding: '3px 8px',
                  borderRadius: '6px',
                }}
              >
                {event.action}
              </span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  color: outcomeColor,
                  border: `1px solid ${outcomeColor}40`,
                  backgroundColor: `${outcomeColor}15`,
                  padding: '2px 8px',
                  borderRadius: '999px',
                }}
              >
                {event.outcome.toUpperCase()}
              </span>
            </div>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#eef0f6', margin: '8px 0 0 0' }}>
              Target: {event.target_type} {event.target_id ? `(${event.target_id})` : ''}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              border: '1px solid #242a3d',
              backgroundColor: '#141926',
              color: '#9ba3b8',
              borderRadius: '8px',
              padding: '6px 12px',
              fontSize: '0.8rem',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          {[
            { label: 'Timestamp', value: new Date(event.created_at).toLocaleString() },
            { label: 'Actor', value: event.actor_email || event.actor_id || 'System / Unauth' },
            { label: 'Actor Role', value: event.actor_role ? formatAdminLabel(event.actor_role) : 'N/A' },
            { label: 'IP Address', value: event.ip_address || 'N/A' },
            { label: 'Correlation ID', value: event.correlation_id || 'N/A' },
            { label: 'Target Type', value: formatAdminLabel(event.target_type) },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: '9px 12px',
                borderRadius: '8px',
                backgroundColor: '#141926',
                border: '1px solid #1e2436',
              }}
            >
              <div style={{ fontSize: '0.7rem', color: '#6b758d', textTransform: 'uppercase' }}>
                {item.label}
              </div>
              <div
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  color: '#eef0f6',
                  marginTop: '4px',
                  wordBreak: 'break-all',
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#9ba3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
            Sanitized Event Metadata (JSON)
          </div>
          <pre
            style={{
              padding: '14px',
              borderRadius: '8px',
              backgroundColor: '#090d16',
              border: '1px solid #1e2436',
              color: '#c7d2fe',
              fontSize: '0.78rem',
              lineHeight: 1.5,
              overflowX: 'auto',
              maxHeight: '260px',
              margin: 0,
            }}
          >
            {JSON.stringify(event.metadata || {}, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

