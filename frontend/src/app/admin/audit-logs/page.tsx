'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminAuditRecord,
  AdminAuditStats,
  downloadAdminAuditExport,
  fetchAdminAuditLogs,
  fetchAdminAuditStats,
} from '@/lib/api';
import { AuditMetadataModal } from '@/components/admin/AuditMetadataModal';
import { formatAdminLabel } from '@/components/admin/documentGovernanceHelpers';

const CONTROL_STYLE: React.CSSProperties = {
  padding: '8px 11px',
  borderRadius: '8px',
  border: '1px solid #242a3d',
  backgroundColor: '#141926',
  color: '#eef0f6',
  fontSize: '0.82rem',
  outline: 'none',
};

function getOutcomePillStyle(outcome: string): React.CSSProperties {
  if (outcome === 'success') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.35)',
      color: '#6ee7b7',
    };
  }
  if (outcome === 'denied') {
    return {
      backgroundColor: 'rgba(245, 158, 11, 0.14)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      color: '#fcd34d',
    };
  }
  return {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    border: '1px solid rgba(239, 68, 68, 0.35)',
    color: '#fca5a5',
  };
}

export default function AdminAuditLogsPage() {
  const [events, setEvents] = useState<AdminAuditRecord[]>([]);
  const [stats, setStats] = useState<AdminAuditStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;

  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const [targetTypeFilter, setTargetTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const [inspectEvent, setInspectEvent] = useState<AdminAuditRecord | null>(null);

  const loadStats = useCallback(async () => {
    const res = await fetchAdminAuditStats();
    if (res.data) setStats(res.data);
  }, []);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAdminAuditLogs({
      outcome: outcomeFilter,
      action: actionFilter,
      target_type: targetTypeFilter,
      search: search.trim() || undefined,
      page,
      limit,
    });
    setLoading(false);
    if (!res.data) {
      setError(res.error || 'Failed to load audit logs.');
      return;
    }
    setEvents(res.data.events);
    setTotal(res.data.total);
  }, [outcomeFilter, actionFilter, targetTypeFilter, search, page]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const handleExport = async (format: 'json' | 'csv') => {
    setExportBusy(true);
    const res = await downloadAdminAuditExport(format, {
      outcome: outcomeFilter,
      action: actionFilter,
      target_type: targetTypeFilter,
      search: search.trim() || undefined,
    });
    setExportBusy(false);
    if (!res.success || !res.blob) {
      setError(res.error || 'Export failed.');
      return;
    }

    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '16px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#eef0f6', margin: 0 }}>
            Audit Logs & Security Telemetry
          </h1>
          <p style={{ fontSize: '0.86rem', color: '#9ba3b8', margin: '6px 0 0 0' }}>
            Immutable append-only record of authentication events, authorization checks, admin operations, and data access.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void handleExport('json')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid #242a3d',
              backgroundColor: '#141926',
              color: '#cbd5e1',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: exportBusy ? 'not-allowed' : 'pointer',
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void handleExport('csv')}
            style={{
              padding: '8px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              backgroundColor: 'rgba(99, 102, 241, 0.18)',
              color: '#c7d2fe',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: exportBusy ? 'not-allowed' : 'pointer',
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI Stats Strip */}
      {stats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px',
          }}
        >
          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Total Recorded Events
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#eef0f6', marginTop: '6px' }}>
              {stats.total.toLocaleString()}
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Successful Operations
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#6ee7b7', marginTop: '6px' }}>
              {stats.outcomes.success.toLocaleString()}
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Denied / Policy Blocked
            </div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                color: stats.outcomes.denied > 0 ? '#fcd34d' : '#eef0f6',
                marginTop: '6px',
              }}
            >
              {stats.outcomes.denied.toLocaleString()}
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Recent 24-Hour Activity
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#a5b4fc', marginTop: '6px' }}>
              {stats.recent_24h_count.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
          padding: '14px',
          borderRadius: '12px',
          backgroundColor: '#0f1422',
          border: '1px solid #1e2436',
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search action, actor, target ID, or correlation ID..."
          style={{ ...CONTROL_STYLE, flex: '1 1 240px' }}
        />

        <select
          value={outcomeFilter}
          onChange={(e) => {
            setPage(1);
            setOutcomeFilter(e.target.value);
          }}
          style={CONTROL_STYLE}
        >
          <option value="all">All Outcomes</option>
          <option value="success">Success</option>
          <option value="denied">Denied</option>
          <option value="error">Error</option>
        </select>

        <select
          value={targetTypeFilter}
          onChange={(e) => {
            setPage(1);
            setTargetTypeFilter(e.target.value);
          }}
          style={CONTROL_STYLE}
        >
          <option value="all">All Target Types</option>
          <option value="user">User</option>
          <option value="group">Group</option>
          <option value="tenant">Tenant</option>
          <option value="document">Document</option>
          <option value="system">System</option>
        </select>

        {stats && stats.top_actions.length > 0 && (
          <select
            value={actionFilter}
            onChange={(e) => {
              setPage(1);
              setActionFilter(e.target.value);
            }}
            style={CONTROL_STYLE}
          >
            <option value="all">All Action Types</option>
            {stats.top_actions.map((a) => (
              <option key={a.action} value={a.action}>
                {a.action} ({a.count})
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => void loadLogs()}
          style={{
            ...CONTROL_STYLE,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '10px',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            color: '#fca5a5',
            fontSize: '0.84rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Events Table */}
      <div
        style={{
          backgroundColor: '#0f1422',
          border: '1px solid #1e2436',
          borderRadius: '12px',
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
              <th style={{ padding: '12px 14px' }}>Timestamp</th>
              <th style={{ padding: '12px 14px' }}>Action & Outcome</th>
              <th style={{ padding: '12px 14px' }}>Actor</th>
              <th style={{ padding: '12px 14px' }}>Target</th>
              <th style={{ padding: '12px 14px' }}>Correlation ID</th>
              <th style={{ padding: '12px 14px', textAlign: 'right' }}>Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  Loading audit telemetry events...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  No audit log records match the current filters.
                </td>
              </tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #1e2436' }}>
                  <td style={{ padding: '12px 14px', verticalAlign: 'top', color: '#9ba3b8', whiteSpace: 'nowrap' }}>
                    <div>{new Date(e.created_at).toLocaleDateString()}</div>
                    <div style={{ fontSize: '0.72rem', color: '#6b758d' }}>
                      {new Date(e.created_at).toLocaleTimeString()}
                    </div>
                  </td>

                  <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.73rem',
                          fontWeight: 700,
                          color: '#a5b4fc',
                          backgroundColor: 'rgba(99, 102, 241, 0.14)',
                          padding: '2px 7px',
                          borderRadius: '5px',
                        }}
                      >
                        {e.action}
                      </span>
                      <span
                        style={{
                          ...getOutcomePillStyle(e.outcome),
                          padding: '2px 7px',
                          borderRadius: '999px',
                          fontSize: '0.69rem',
                          fontWeight: 700,
                        }}
                      >
                        {e.outcome.toUpperCase()}
                      </span>
                    </div>
                  </td>

                  <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600, color: '#eef0f6' }}>
                      {e.actor_email || e.actor_id || 'System / Unauth'}
                    </div>
                    {e.actor_role && (
                      <div style={{ fontSize: '0.72rem', color: '#9ba3b8', marginTop: '2px' }}>
                        {formatAdminLabel(e.actor_role)}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                    <div style={{ color: '#cbd5e1', fontWeight: 600 }}>
                      {formatAdminLabel(e.target_type)}
                    </div>
                    {e.target_id && (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: '#a5b4fc',
                          fontFamily: 'monospace',
                          marginTop: '2px',
                        }}
                      >
                        {e.target_id}
                      </div>
                    )}
                  </td>

                  <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: '#6b758d' }}>
                      {e.correlation_id ? `${e.correlation_id.slice(0, 18)}…` : '—'}
                    </span>
                  </td>

                  <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => setInspectEvent(e)}
                      style={{
                        padding: '6px 11px',
                        borderRadius: '7px',
                        border: '1px solid #242a3d',
                        backgroundColor: '#141926',
                        color: '#cbd5e1',
                        fontSize: '0.74rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '0.82rem',
          color: '#9ba3b8',
        }}
      >
        <span>
          Showing {events.length} of {total} audit records (Page {page} of {totalPages})
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: '6px 12px',
              borderRadius: '7px',
              border: '1px solid #242a3d',
              backgroundColor: '#141926',
              color: page <= 1 ? '#475569' : '#eef0f6',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              padding: '6px 12px',
              borderRadius: '7px',
              border: '1px solid #242a3d',
              backgroundColor: '#141926',
              color: page >= totalPages ? '#475569' : '#eef0f6',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      </div>

      <AuditMetadataModal event={inspectEvent} onClose={() => setInspectEvent(null)} />
    </div>
  );
}
