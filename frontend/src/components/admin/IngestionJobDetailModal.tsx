'use client';

import React, { useEffect, useState } from 'react';
import {
  AdminIngestionJobDetail,
  fetchAdminIngestionJobDetail,
} from '@/lib/api';
import { formatAdminLabel } from './documentGovernanceHelpers';

interface IngestionJobDetailModalProps {
  jobId: string | null;
  onClose: () => void;
  onTriggerRetry: (jobId: string, documentId: string) => void;
}

export function IngestionJobDetailModal({
  jobId,
  onClose,
  onTriggerRetry,
}: IngestionJobDetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AdminIngestionJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchAdminIngestionJobDetail(jobId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.data) {
        setError(res.error || 'Failed to load ingestion job diagnostics.');
        return;
      }
      setDetail(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!jobId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ingestion Job Diagnostics"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 65,
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
          maxWidth: '760px',
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
            <span
              style={{
                fontFamily: 'monospace',
                fontSize: '0.74rem',
                color: '#a5b4fc',
                backgroundColor: 'rgba(99, 102, 241, 0.14)',
                padding: '3px 8px',
                borderRadius: '6px',
              }}
            >
              Job {jobId.slice(0, 8)}
            </span>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#eef0f6', margin: '8px 0 0 0' }}>
              {detail?.job.document_id
                ? `${detail.job.document_id} — ${detail.job.document_title}`
                : 'Ingestion Job Diagnostics'}
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

        {error && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#fca5a5',
              fontSize: '0.82rem',
              marginBottom: '14px',
            }}
          >
            {error}
          </div>
        )}

        {loading || !detail ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#9ba3b8', fontSize: '0.85rem' }}>
            Loading ingestion job diagnostics...
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '10px',
              }}
            >
              {[
                { label: 'Job Status', value: formatAdminLabel(detail.job.status) },
                { label: 'Operation', value: formatAdminLabel(detail.job.job_type) },
                { label: 'Attempt', value: `${detail.job.attempt_count} / ${detail.job.max_attempts}` },
                { label: 'Document State', value: formatAdminLabel(detail.job.document_status) },
                { label: 'Chunks Total', value: String(detail.job.chunks_total) },
                {
                  label: 'Recovery Snapshot',
                  value: detail.job.has_recovery_snapshot ? 'Available' : 'Cleared / None',
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#141926',
                    border: '1px solid #1e2436',
                  }}
                >
                  <div style={{ fontSize: '0.7rem', color: '#6b758d', textTransform: 'uppercase' }}>
                    {stat.label}
                  </div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#eef0f6', marginTop: '4px' }}>
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>

            {detail.job.error_message && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.35)',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                }}
              >
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#fca5a5', textTransform: 'uppercase' }}>
                  Sanitized Failure Diagnostic
                </div>
                <div style={{ fontSize: '0.82rem', color: '#fecaca', marginTop: '6px', lineHeight: 1.5 }}>
                  {detail.job.error_message}
                </div>
              </div>
            )}

            {detail.job.status === 'failed' && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: '#141926',
                  border: '1px solid #242a3d',
                }}
              >
                <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  {detail.job.can_retry
                    ? 'Ready for safe idempotent retry using stored validation metadata.'
                    : detail.job.retry_block_reason || 'Retry unavailable.'}
                </div>
                {detail.job.can_retry && (
                  <button
                    type="button"
                    onClick={() => onTriggerRetry(detail.job.id, detail.job.document_id)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '8px',
                      border: 'none',
                      backgroundColor: '#6366f1',
                      color: '#ffffff',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Retry Job Now
                  </button>
                )}
              </div>
            )}

            <div>
              <h3 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#eef0f6', margin: '0 0 8px 0' }}>
                Recent Versions ({detail.versions.length})
              </h3>
              <div style={{ border: '1px solid #1e2436', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>Ver</th>
                      <th style={{ padding: '8px 12px' }}>Status</th>
                      <th style={{ padding: '8px 12px' }}>Hash</th>
                      <th style={{ padding: '8px 12px' }}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.versions.map((v) => (
                      <tr key={v.id} style={{ borderTop: '1px solid #1e2436' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600, color: '#eef0f6' }}>v{v.version}</td>
                        <td style={{ padding: '8px 12px', color: v.status === 'active' ? '#6ee7b7' : v.status === 'failed' ? '#fca5a5' : '#9ba3b8' }}>
                          {v.status}
                        </td>
                        <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#9ba3b8' }}>
                          {v.content_hash.slice(0, 14)}…
                        </td>
                        <td style={{ padding: '8px 12px', color: '#9ba3b8' }}>
                          {new Date(v.created_at).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '0.86rem', fontWeight: 700, color: '#eef0f6', margin: '0 0 8px 0' }}>
                Audit Events ({detail.audit_history.length})
              </h3>
              {detail.audit_history.length === 0 ? (
                <p style={{ fontSize: '0.78rem', color: '#6b758d', margin: 0 }}>No recent audit entries.</p>
              ) : (
                <div style={{ border: '1px solid #1e2436', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Time</th>
                        <th style={{ padding: '8px 12px' }}>Action</th>
                        <th style={{ padding: '8px 12px' }}>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.audit_history.map((a) => (
                        <tr key={a.id} style={{ borderTop: '1px solid #1e2436' }}>
                          <td style={{ padding: '8px 12px', color: '#9ba3b8' }}>
                            {new Date(a.created_at).toLocaleString()}
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#a5b4fc' }}>
                            {a.action}
                          </td>
                          <td style={{ padding: '8px 12px', color: a.outcome === 'success' ? '#6ee7b7' : '#fca5a5' }}>
                            {a.outcome}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

