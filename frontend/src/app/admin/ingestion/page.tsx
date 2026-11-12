'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminGroupItem,
  AdminIngestionJobSummary,
  AdminTenantItem,
  batchReindexAdminDocuments,
  cleanupStaleAdminIndexes,
  fetchAdminGroups,
  fetchAdminIngestionJobs,
  fetchAdminTenants,
  IngestionHealthMetrics,
  reindexAdminDocument,
  retryAdminIngestionJob,
} from '@/lib/api';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DocumentUploadModal } from '@/components/admin/DocumentUploadModal';
import { IngestionJobDetailModal } from '@/components/admin/IngestionJobDetailModal';
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

function getJobStatusStyle(status: string): React.CSSProperties {
  if (status === 'completed') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.35)',
      color: '#6ee7b7',
    };
  }
  if (status === 'failed') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.35)',
      color: '#fca5a5',
    };
  }
  return {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    border: '1px solid rgba(245, 158, 11, 0.35)',
    color: '#fcd34d',
  };
}

export default function AdminIngestionPage() {
  const [jobs, setJobs] = useState<AdminIngestionJobSummary[]>([]);
  const [health, setHealth] = useState<IngestionHealthMetrics | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [groups, setGroups] = useState<AdminGroupItem[]>([]);
  const [tenants, setTenants] = useState<AdminTenantItem[]>([]);

  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectJobId, setInspectJobId] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    mode: 'retry' | 'reindex' | 'batch' | 'cleanup';
    jobId?: string;
    docId?: string;
    title: string;
    description: string;
    implications: string[];
    tone: 'primary' | 'warning' | 'danger';
  }>({
    open: false,
    mode: 'cleanup',
    title: '',
    description: '',
    implications: [],
    tone: 'warning',
  });

  const loadMetadata = useCallback(async () => {
    const [gRes, tRes] = await Promise.all([fetchAdminGroups(), fetchAdminTenants()]);
    if (gRes.data) setGroups(gRes.data.groups);
    if (tRes.data) setTenants(tRes.data.tenants);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAdminIngestionJobs({
      status: statusFilter,
      job_type: typeFilter,
      search: search.trim() || undefined,
      page,
      limit,
    });
    setLoading(false);
    if (!res.data) {
      setError(res.error || 'Failed to load ingestion jobs and index diagnostics.');
      return;
    }
    setJobs(res.data.jobs);
    setTotal(res.data.total);
    setHealth(res.data.health);
  }, [statusFilter, typeFilter, search, page]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const executeConfirmedAction = async () => {
    setActionBusy(true);
    setError(null);
    setBannerMsg(null);
    const current = confirmState;
    setConfirmState((s) => ({ ...s, open: false }));

    if (current.mode === 'retry' && current.jobId) {
      const res = await retryAdminIngestionJob(current.jobId);
      setActionBusy(false);
      if (!res.data) {
        setError(res.error || 'Retry failed.');
      } else {
        setBannerMsg(
          `Retry succeeded for ${res.data.document_id} (v${res.data.version}, ${res.data.chunks_count} chunks indexed).`
        );
        setInspectJobId(null);
        void loadJobs();
      }
      return;
    }

    if (current.mode === 'reindex' && current.docId) {
      const res = await reindexAdminDocument(current.docId, { force_reembed: true });
      setActionBusy(false);
      if (!res.data) {
        setError(res.error || 'Re-index failed.');
      } else {
        setBannerMsg(
          `Re-indexed ${res.data.document_id} as v${res.data.version} (${res.data.chunks_count} active chunks synchronized).`
        );
        void loadJobs();
      }
      return;
    }

    if (current.mode === 'batch') {
      const res = await batchReindexAdminDocuments({
        document_ids: selectedDocIds,
        force_reembed: true,
      });
      setActionBusy(false);
      if (!res.data) {
        setError(res.error || 'Batch re-index failed.');
      } else {
        setBannerMsg(
          `Batch re-index completed: ${res.data.succeeded}/${res.data.total_requested} succeeded, ${res.data.failed} failed.`
        );
        setSelectedDocIds([]);
        void loadJobs();
      }
      return;
    }

    if (current.mode === 'cleanup') {
      const res = await cleanupStaleAdminIndexes();
      setActionBusy(false);
      if (!res.data) {
        setError(res.error || 'Stale index cleanup failed.');
      } else {
        const c = res.data.cleaned;
        setBannerMsg(
          `Cleanup finished: ${c.deactivated_stale_chunks} stale chunks deactivated, ${c.resynced_acl_chunks} ACL chunks resynced, ${c.purged_obsolete_chunks} obsolete vectors purged, ${c.recovered_stale_jobs} timed-out jobs recovered.`
        );
        void loadJobs();
      }
    }
  };

  const totalStaleIssues = health
    ? health.stale_active_chunks +
      health.obsolete_inactive_chunks +
      health.acl_desynced_documents +
      health.stale_processing_jobs
    : 0;
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
            Ingestion Monitoring & Operational Recovery
          </h1>
          <p style={{ fontSize: '0.86rem', color: '#9ba3b8', margin: '6px 0 0 0' }}>
            Inspect pipeline job health, retry failed ingestions safely, re-index embeddings atomically, and purge stale vectors.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            disabled={actionBusy}
            onClick={() =>
              setConfirmState({
                open: true,
                mode: 'cleanup',
                tone: 'warning',
                title: 'Run Stale Index Cleanup',
                description:
                  'Clean up stale chunks, resync drifted ACL metadata, and recover timed-out jobs?',
                implications: [
                  'Deactivates any stale chunks erroneously marked active on superseded or archived versions.',
                  'Resynchronizes document_chunks metadata from authoritative document_permissions.',
                  'Deletes obsolete inactive vectors from archived/failed versions while preserving active versions.',
                  'Marks orphaned active jobs older than 15 minutes as failed so retries can run cleanly.',
                ],
              })
            }
            style={{
              padding: '9px 14px',
              borderRadius: '9px',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: '#fcd34d',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: actionBusy ? 'not-allowed' : 'pointer',
            }}
          >
            Run Stale Cleanup
          </button>

          {selectedDocIds.length > 0 && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={() =>
                setConfirmState({
                  open: true,
                  mode: 'batch',
                  tone: 'primary',
                  title: `Batch Re-index ${selectedDocIds.length} Document(s)`,
                  description: `Re-index selected documents sequentially: ${selectedDocIds.join(', ')}?`,
                  implications: [
                    'Generates fresh 768-dim embeddings cleanly per document.',
                    'Preserves all current document_permissions and tenant/group ACL rules.',
                    'Uses atomic version swaps so previous active chunks stay online until new chunks succeed.',
                  ],
                })
              }
              style={{
                padding: '9px 14px',
                borderRadius: '9px',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                backgroundColor: 'rgba(99, 102, 241, 0.18)',
                color: '#c7d2fe',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: actionBusy ? 'not-allowed' : 'pointer',
              }}
            >
              Re-index Selected ({selectedDocIds.length})
            </button>
          )}

          <button
            type="button"
            disabled={actionBusy}
            onClick={() => setUploadOpen(true)}
            style={{
              padding: '9px 16px',
              borderRadius: '9px',
              border: 'none',
              backgroundColor: '#6366f1',
              color: '#ffffff',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
            }}
          >
            + Upload Document
          </button>
        </div>
      </div>

      {/* Index Health KPI Strip */}
      {health && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
            gap: '12px',
          }}
        >
          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Indexed Documents
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#6ee7b7', marginTop: '6px' }}>
              {health.completed_documents}{' '}
              <span style={{ fontSize: '0.8rem', color: '#6b758d', fontWeight: 500 }}>
                / {health.total_documents} total
              </span>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Failed Jobs
            </div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                color: health.failed_jobs > 0 ? '#fca5a5' : '#eef0f6',
                marginTop: '6px',
              }}
            >
              {health.failed_jobs}{' '}
              <span style={{ fontSize: '0.8rem', color: '#6b758d', fontWeight: 500 }}>
                ({health.failed_documents} failed docs)
              </span>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Active Processing
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fcd34d', marginTop: '6px' }}>
              {health.active_jobs}{' '}
              <span style={{ fontSize: '0.8rem', color: '#6b758d', fontWeight: 500 }}>
                ({health.stale_processing_jobs} timed-out)
              </span>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: '12px', backgroundColor: '#0f1422', border: '1px solid #1e2436' }}>
            <div style={{ fontSize: '0.72rem', color: '#9ba3b8', textTransform: 'uppercase', fontWeight: 600 }}>
              Index Hygiene Issues
            </div>
            <div
              style={{
                fontSize: '1.35rem',
                fontWeight: 700,
                color: totalStaleIssues > 0 ? '#fcd34d' : '#6ee7b7',
                marginTop: '6px',
              }}
            >
              {totalStaleIssues}{' '}
              <span style={{ fontSize: '0.74rem', color: '#6b758d', fontWeight: 500 }}>
                ({health.stale_active_chunks} stale · {health.obsolete_inactive_chunks} obsolete ·{' '}
                {health.acl_desynced_documents} desynced)
              </span>
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
          placeholder="Search document ID, title, filename, or diagnostic..."
          style={{ ...CONTROL_STYLE, flex: '1 1 220px' }}
        />

        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
          style={CONTROL_STYLE}
        >
          <option value="all">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="processing">Processing</option>
          <option value="chunking">Chunking</option>
          <option value="embedding">Embedding</option>
          <option value="pending">Pending</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => {
            setPage(1);
            setTypeFilter(e.target.value);
          }}
          style={CONTROL_STYLE}
        >
          <option value="all">All Job Types</option>
          <option value="ingest">Ingest</option>
          <option value="retry">Retry</option>
          <option value="reindex">Re-index</option>
        </select>

        <button
          type="button"
          onClick={() => void loadJobs()}
          style={{
            ...CONTROL_STYLE,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Refresh
        </button>
      </div>

      {bannerMsg && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '10px',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            color: '#6ee7b7',
            fontSize: '0.84rem',
          }}
        >
          {bannerMsg}
        </div>
      )}

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

      {/* Jobs Table */}
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
              <th style={{ padding: '12px 14px', width: '36px' }}>Sel</th>
              <th style={{ padding: '12px 14px' }}>Document & Version</th>
              <th style={{ padding: '12px 14px' }}>Job Status & Type</th>
              <th style={{ padding: '12px 14px' }}>Chunks & Metrics</th>
              <th style={{ padding: '12px 14px' }}>Diagnostics / Started</th>
              <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  Loading ingestion pipeline jobs...
                </td>
              </tr>
            ) : jobs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  No ingestion jobs match the selected filters.
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const checked = selectedDocIds.includes(job.document_id);
                return (
                  <tr key={job.id} style={{ borderTop: '1px solid #1e2436' }}>
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDocSelection(job.document_id)}
                        aria-label={`Select ${job.document_id} for batch re-index`}
                      />
                    </td>

                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            color: '#a5b4fc',
                            backgroundColor: 'rgba(99, 102, 241, 0.14)',
                            padding: '2px 7px',
                            borderRadius: '5px',
                          }}
                        >
                          {job.document_id}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#6b758d' }}>
                          {job.version !== null ? `v${job.version}` : 'staged'} · {job.format}
                        </span>
                      </div>
                      <div style={{ fontWeight: 600, color: '#eef0f6', marginTop: '4px' }}>
                        {job.document_title}
                      </div>
                      <div style={{ fontSize: '0.73rem', color: '#6b758d', marginTop: '2px' }}>
                        {job.filename}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            ...getJobStatusStyle(job.status),
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                          }}
                        >
                          {formatAdminLabel(job.status)}
                        </span>
                        <span
                          style={{
                            padding: '3px 7px',
                            borderRadius: '6px',
                            backgroundColor: '#141926',
                            border: '1px solid #242a3d',
                            color: '#cbd5e1',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                          }}
                        >
                          {job.job_type.toUpperCase()} ({job.attempt_count}/{job.max_attempts})
                        </span>
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#6b758d', marginTop: '4px', fontFamily: 'monospace' }}>
                        Job {job.id.slice(0, 8)}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      <div style={{ color: '#cbd5e1', fontWeight: 600, fontSize: '0.78rem' }}>
                        {job.active_chunks_count} active / {job.chunks_total} job
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#9ba3b8', marginTop: '3px' }}>
                        {job.chunks_reused} reused ·{' '}
                        {job.duration_ms !== null ? `${(job.duration_ms / 1000).toFixed(2)}s` : 'in progress'}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', verticalAlign: 'top', maxWidth: '280px' }}>
                      {job.error_message ? (
                        <div
                          style={{
                            fontSize: '0.74rem',
                            color: '#fca5a5',
                            backgroundColor: 'rgba(239, 68, 68, 0.08)',
                            border: '1px solid rgba(239, 68, 68, 0.25)',
                            borderRadius: '6px',
                            padding: '5px 8px',
                            marginBottom: '4px',
                          }}
                        >
                          {job.error_message}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.74rem', color: '#6ee7b7', marginBottom: '4px' }}>
                          Clean execution
                        </div>
                      )}
                      <div style={{ fontSize: '0.71rem', color: '#6b758d' }}>
                        {new Date(job.started_at).toLocaleString()}
                      </div>
                    </td>

                    <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setInspectJobId(job.id)}
                          style={{
                            padding: '6px 10px',
                            borderRadius: '7px',
                            border: '1px solid #242a3d',
                            backgroundColor: '#141926',
                            color: '#cbd5e1',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Diagnostics
                        </button>

                        {job.can_retry && (
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() =>
                              setConfirmState({
                                open: true,
                                mode: 'retry',
                                jobId: job.id,
                                docId: job.document_id,
                                tone: 'warning',
                                title: `Retry Failed Job for ${job.document_id}`,
                                description: `Attempt recovery #${job.attempt_count + 1} (of max ${job.max_attempts}) for ${job.document_title}?`,
                                implications: [
                                  'Re-chunks and embeds using fresh vectors without altering existing active versions until publication succeeds.',
                                  'Preserves current document_permissions and tenant/group ACL boundaries.',
                                ],
                              })
                            }
                            style={{
                              padding: '6px 10px',
                              borderRadius: '7px',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              backgroundColor: 'rgba(245, 158, 11, 0.14)',
                              color: '#fcd34d',
                              fontSize: '0.74rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Retry
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={() =>
                            setConfirmState({
                              open: true,
                              mode: 'reindex',
                              docId: job.document_id,
                              tone: 'primary',
                              title: `Re-index ${job.document_id}`,
                              description: `Force atomic re-indexing and vector refresh for "${job.document_title}"?`,
                              implications: [
                                'Regenerates 768-dim embeddings cleanly and swaps active version atomically.',
                                'Maintains existing tenant, sensitivity, disclosure policy, and group ACLs.',
                              ],
                            })
                          }
                          style={{
                            padding: '6px 10px',
                            borderRadius: '7px',
                            border: '1px solid rgba(99, 102, 241, 0.35)',
                            backgroundColor: 'rgba(99, 102, 241, 0.14)',
                            color: '#c7d2fe',
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Re-index
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
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
          Showing {jobs.length} of {total} ingestion jobs (Page {page} of {totalPages})
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

      <DocumentUploadModal
        isOpen={uploadOpen}
        groups={groups}
        tenants={tenants}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => void loadJobs()}
      />

      <IngestionJobDetailModal
        jobId={inspectJobId}
        onClose={() => setInspectJobId(null)}
        onTriggerRetry={(jobId, docId) =>
          setConfirmState({
            open: true,
            mode: 'retry',
            jobId,
            docId,
            tone: 'warning',
            title: `Retry Failed Job for ${docId}`,
            description: `Retry ingestion job ${jobId.slice(0, 8)} for ${docId}?`,
            implications: [
              'Re-runs chunking and embedding generation safely with existing ACL preservation.',
            ],
          })
        }
      />

      <ConfirmDialog
        isOpen={confirmState.open}
        tone={confirmState.tone}
        title={confirmState.title}
        description={confirmState.description}
        implications={confirmState.implications}
        confirmLabel="Proceed"
        busy={actionBusy}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
        onConfirm={() => void executeConfirmedAction()}
      />
    </div>
  );
}
