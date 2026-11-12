'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AdminOverviewData, fetchAdminOverview } from '@/lib/api';
import { useAdminSession } from '@/components/admin/AdminShell';

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusBadgeStyle(status: string): React.CSSProperties {
  const normalized = status.toLowerCase();
  if (normalized === 'completed') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      color: '#6ee7b7',
    };
  }
  if (normalized === 'failed') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      color: '#fca5a5',
    };
  }
  return {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    border: '1px solid rgba(245, 158, 11, 0.3)',
    color: '#fcd34d',
  };
}

export default function AdminOverviewPage() {
  const { access } = useAdminSession();
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await fetchAdminOverview();
    if (result.data) {
      setOverview(result.data);
    } else {
      setError(result.error || 'Failed to load administrator overview metrics.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#111624',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    padding: '18px 20px',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
      {/* Header Row */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Administration Overview
          </h1>
          <p style={{ fontSize: '0.86rem', color: '#94a3b8', margin: '4px 0 0' }}>
            Signed in as <strong style={{ color: '#e2e8f0' }}>{access.admin.name}</strong> ({access.admin.email})
          </p>
        </div>

        <button
          onClick={loadOverview}
          disabled={loading}
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            backgroundColor: 'rgba(99, 102, 241, 0.14)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            color: '#c7d2fe',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
            <path d="M16 16h5v5" />
          </svg>
          <span>{loading ? 'Refreshing...' : 'Refresh Metrics'}</span>
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '14px 16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            fontSize: '0.86rem',
          }}
        >
          {error}
        </div>
      )}

      {loading && !overview && (
        <div
          style={{
            ...cardStyle,
            color: '#94a3b8',
            fontSize: '0.88rem',
            textAlign: 'center',
            padding: '28px',
          }}
        >
          Loading live administrator metrics...
        </div>
      )}

      {/* Metrics Grid */}
      {overview && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '14px',
            }}
          >
            <div style={cardStyle}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Total Users
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                {overview.metrics.users.total}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#6ee7b7', marginTop: '6px' }}>
                {overview.metrics.users.active} active · {overview.metrics.users.disabled} disabled
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Roles & Tenancy
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                {overview.metrics.groups} <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#94a3b8' }}>groups</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#a5b4fc', marginTop: '6px' }}>
                {overview.metrics.tenants} tenants · {overview.metrics.users.admins} admins · {overview.metrics.users.customers} customers
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Documents & Chunks
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                {overview.metrics.documents.total} <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#94a3b8' }}>docs</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '6px' }}>
                {overview.metrics.documents.active_chunks} active chunks · {overview.metrics.documents.completed} ready
              </div>
            </div>

            <div style={cardStyle}>
              <div style={{ fontSize: '0.74rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Ingestion & Chats
              </div>
              <div style={{ fontSize: '1.85rem', fontWeight: 700, color: '#f8fafc', marginTop: '6px' }}>
                {overview.metrics.ingestion_jobs.total} <span style={{ fontSize: '0.95rem', fontWeight: 500, color: '#94a3b8' }}>jobs</span>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '6px' }}>
                {overview.metrics.ingestion_jobs.failed} failed · {overview.metrics.conversations} chat threads
              </div>
            </div>
          </div>

          {/* Security Posture & Quick Modules */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '16px',
            }}
          >
            {/* Security Posture */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                  Active Security Posture
                </h2>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    padding: '3px 9px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.28)',
                    color: '#6ee7b7',
                  }}
                >
                  Enforced
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.83rem' }}>
                <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Server Authorization Guard</div>
                  <div style={{ color: '#e2e8f0', marginTop: '3px', fontWeight: 500 }}>{overview.security_posture.server_guard}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>CSRF Protection</div>
                  <div style={{ color: '#e2e8f0', marginTop: '3px', fontWeight: 500 }}>{overview.security_posture.csrf_protection}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.025)', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tenant Isolation</div>
                  <div style={{ color: '#e2e8f0', marginTop: '3px', fontWeight: 500 }}>{overview.security_posture.tenant_isolation}</div>
                </div>
              </div>
            </div>

            {/* Admin Modules */}
            <div style={cardStyle}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', margin: '0 0 14px' }}>
                Admin Console Modules
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { href: '/admin/users', title: 'Users & Status Management', desc: 'Inspect directory users, roles, and active status' },
                  { href: '/admin/roles-groups', title: 'Roles, Groups & Tenant Scope', desc: 'Manage authorization memberships and boundaries' },
                  { href: '/admin/documents', title: 'Document Governance', desc: 'Review visibility rules, ACLs, and knowledge versions' },
                  { href: '/admin/ingestion', title: 'Ingestion Operations', desc: 'Upload knowledge docs, monitor jobs, re-index corpus' },
                  { href: '/admin/audit-logs', title: 'Audit Logs & Telemetry', desc: 'Track logins, denials, queries, and admin mutations' },
                ].map((mod) => (
                  <Link
                    key={mod.href}
                    href={mod.href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.025)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      textDecoration: 'none',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#e2e8f0' }}>{mod.title}</div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>{mod.desc}</div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: '10px' }}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* Recent Ingestion Jobs Table */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#f8fafc', margin: 0 }}>
                Recent Ingestion Jobs
              </h2>
              <Link
                href="/admin/ingestion"
                style={{ fontSize: '0.8rem', color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}
              >
                Open Ingestion Console →
              </Link>
            </div>

            {overview.recent_ingestion_jobs.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: '#64748b', padding: '12px 0' }}>
                No ingestion jobs recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left', color: '#64748b' }}>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Document Code</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Title</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Started</th>
                      <th style={{ padding: '10px 8px', fontWeight: 600 }}>Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.recent_ingestion_jobs.map((job) => (
                      <tr key={job.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <td style={{ padding: '11px 8px', color: '#cbd5e1', fontFamily: 'monospace' }}>
                          {job.document_code || '—'}
                        </td>
                        <td style={{ padding: '11px 8px', color: '#f1f5f9', fontWeight: 500 }}>
                          {job.title || 'Untitled Document'}
                        </td>
                        <td style={{ padding: '11px 8px' }}>
                          <span
                            style={{
                              ...getStatusBadgeStyle(job.status),
                              display: 'inline-block',
                              padding: '2px 9px',
                              borderRadius: '999px',
                              fontSize: '0.73rem',
                              fontWeight: 600,
                              textTransform: 'capitalize',
                            }}
                          >
                            {job.status}
                          </span>
                          {job.error_message && (
                            <div style={{ fontSize: '0.73rem', color: '#fca5a5', marginTop: '4px' }}>
                              {job.error_message}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 8px', color: '#94a3b8' }}>
                          {formatTimestamp(job.started_at)}
                        </td>
                        <td style={{ padding: '11px 8px', color: '#94a3b8' }}>
                          {formatTimestamp(job.completed_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
