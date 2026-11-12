'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminDocumentItem,
  AdminGroupItem,
  AdminTenantItem,
  fetchAdminDocuments,
  fetchAdminGroups,
  fetchAdminTenants,
  toggleAdminDocumentArchive,
} from '@/lib/api';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DocumentDetailModal } from '@/components/admin/DocumentDetailModal';
import { DocumentUploadModal } from '@/components/admin/DocumentUploadModal';
import {
  DISCLOSURE_OPTIONS,
  formatAdminLabel,
  getDisclosurePillStyle,
  getSensitivityPillStyle,
  SENSITIVITY_OPTIONS,
} from '@/components/admin/documentGovernanceHelpers';

const FILTER_CONTROL_STYLE: React.CSSProperties = {
  padding: '8px 11px',
  borderRadius: '8px',
  border: '1px solid #242a3d',
  backgroundColor: '#141926',
  color: '#eef0f6',
  fontSize: '0.82rem',
  outline: 'none',
};

export default function AdminDocumentsPage() {
  const [documents, setDocuments] = useState<AdminDocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [groups, setGroups] = useState<AdminGroupItem[]>([]);
  const [tenants, setTenants] = useState<AdminTenantItem[]>([]);

  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [sensitivityFilter, setSensitivityFilter] = useState('');
  const [disclosureFilter, setDisclosureFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [inspectState, setInspectState] = useState<{
    documentId: string | null;
    tab: 'permissions' | 'access' | 'history';
  }>({ documentId: null, tab: 'permissions' });

  const [archiveTarget, setArchiveTarget] = useState<AdminDocumentItem | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const loadMetadata = useCallback(async () => {
    const [gRes, tRes] = await Promise.all([fetchAdminGroups(), fetchAdminTenants()]);
    if (gRes.data) setGroups(gRes.data.groups);
    if (tRes.data) setTenants(tRes.data.tenants);
  }, []);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAdminDocuments({
      search: search.trim() || undefined,
      tenant: tenantFilter || undefined,
      sensitivity: sensitivityFilter || undefined,
      disclosure_policy: disclosureFilter || undefined,
      is_active: activeFilter || undefined,
      page,
      limit,
    });
    setLoading(false);
    if (!res.data) {
      setError(res.error || 'Failed to load document governance inventory.');
      return;
    }
    setDocuments(res.data.documents);
    setTotal(res.data.total);
  }, [search, tenantFilter, sensitivityFilter, disclosureFilter, activeFilter, page]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const handleConfirmRowArchive = async () => {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    const res = await toggleAdminDocumentArchive(
      archiveTarget.document_id,
      !archiveTarget.is_active
    );
    setArchiveBusy(false);
    setArchiveTarget(null);
    if (!res.data) {
      setError(res.error || 'Failed to update archive state.');
      return;
    }
    void loadDocuments();
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
            Document Governance & Permissions
          </h1>
          <p style={{ fontSize: '0.86rem', color: '#9ba3b8', margin: '6px 0 0 0' }}>
            Upload authorized knowledge files, inspect effective user access, and synchronize ACL classifications across vector and full-text retrieval.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          style={{
            padding: '10px 18px',
            borderRadius: '10px',
            border: 'none',
            backgroundColor: '#6366f1',
            color: '#ffffff',
            fontSize: '0.86rem',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
          }}
        >
          + Upload Document
        </button>
      </div>

      {/* Filters Bar */}
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
          placeholder="Search document ID, title, or filename..."
          style={{ ...FILTER_CONTROL_STYLE, flex: '1 1 220px' }}
        />

        <select
          value={tenantFilter}
          onChange={(e) => {
            setPage(1);
            setTenantFilter(e.target.value);
          }}
          style={FILTER_CONTROL_STYLE}
        >
          <option value="">All Tenants</option>
          <option value="global">Global Platform (global)</option>
          {tenants
            .filter((t) => t.id !== 'global')
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.id})
              </option>
            ))}
        </select>

        <select
          value={sensitivityFilter}
          onChange={(e) => {
            setPage(1);
            setSensitivityFilter(e.target.value);
          }}
          style={FILTER_CONTROL_STYLE}
        >
          <option value="">All Sensitivities</option>
          {SENSITIVITY_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {formatAdminLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={disclosureFilter}
          onChange={(e) => {
            setPage(1);
            setDisclosureFilter(e.target.value);
          }}
          style={FILTER_CONTROL_STYLE}
        >
          <option value="">All Disclosure Policies</option>
          {DISCLOSURE_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {formatAdminLabel(d)}
            </option>
          ))}
        </select>

        <select
          value={activeFilter}
          onChange={(e) => {
            setPage(1);
            setActiveFilter(e.target.value);
          }}
          style={FILTER_CONTROL_STYLE}
        >
          <option value="">Active & Archived</option>
          <option value="true">Active Only</option>
          <option value="false">Archived Only</option>
        </select>
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

      {/* Documents Table */}
      <div
        style={{
          backgroundColor: '#0f1422',
          border: '1px solid #1e2436',
          borderRadius: '12px',
          overflowX: 'auto',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
          <thead>
            <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
              <th style={{ padding: '12px 16px' }}>Document</th>
              <th style={{ padding: '12px 16px' }}>Tenant & Team</th>
              <th style={{ padding: '12px 16px' }}>Classification & Disclosure</th>
              <th style={{ padding: '12px 16px' }}>Authorized Groups</th>
              <th style={{ padding: '12px 16px' }}>Index State</th>
              <th style={{ padding: '12px 16px', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  Loading documents...
                </td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '36px 16px', textAlign: 'center', color: '#9ba3b8' }}>
                  No documents match the selected governance filters.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} style={{ borderTop: '1px solid #1e2436' }}>
                  <td style={{ padding: '13px 16px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#a5b4fc',
                          backgroundColor: 'rgba(99, 102, 241, 0.14)',
                          padding: '2px 7px',
                          borderRadius: '5px',
                        }}
                      >
                        {doc.document_id}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#6b758d' }}>
                        v{doc.current_version} · {doc.format}
                      </span>
                    </div>
                    <div style={{ fontWeight: 600, color: '#eef0f6', marginTop: '5px' }}>
                      {doc.title}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#6b758d', marginTop: '2px' }}>
                      {doc.filename}
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px', verticalAlign: 'top' }}>
                    <div style={{ fontWeight: 600, color: '#cbd5e1', fontFamily: 'monospace', fontSize: '0.78rem' }}>
                      {doc.tenant_id}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#9ba3b8', marginTop: '3px' }}>
                      {formatAdminLabel(doc.owner_team)} · {formatAdminLabel(doc.document_type)}
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      <span
                        style={{
                          ...getSensitivityPillStyle(doc.sensitivity),
                          padding: '3px 8px',
                          borderRadius: '999px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                        }}
                      >
                        {formatAdminLabel(doc.sensitivity)}
                      </span>
                      <span
                        style={{
                          ...getDisclosurePillStyle(doc.disclosure_policy),
                          padding: '3px 8px',
                          borderRadius: '999px',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                        }}
                      >
                        {formatAdminLabel(doc.disclosure_policy)}
                      </span>
                      {!doc.is_active && (
                        <span
                          style={{
                            padding: '3px 8px',
                            borderRadius: '999px',
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            backgroundColor: 'rgba(239, 68, 68, 0.16)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            color: '#fca5a5',
                          }}
                        >
                          Archived
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px', verticalAlign: 'top' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '220px' }}>
                      {doc.allowed_groups.slice(0, 3).map((g) => (
                        <span
                          key={g}
                          style={{
                            padding: '2px 7px',
                            borderRadius: '5px',
                            backgroundColor: '#141926',
                            border: '1px solid #242a3d',
                            color: '#cbd5e1',
                            fontSize: '0.71rem',
                            fontFamily: 'monospace',
                          }}
                        >
                          {g}
                        </span>
                      ))}
                      {doc.allowed_groups.length > 3 && (
                        <span style={{ fontSize: '0.71rem', color: '#9ba3b8', padding: '2px 4px' }}>
                          +{doc.allowed_groups.length - 3} more
                        </span>
                      )}
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px', verticalAlign: 'top' }}>
                    <div style={{ color: doc.is_active ? '#6ee7b7' : '#fca5a5', fontWeight: 600, fontSize: '0.78rem' }}>
                      {doc.active_chunks_count} active chunks
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#9ba3b8', marginTop: '3px' }}>
                      {doc.has_approved_summary ? 'Approved summary ready' : `Status: ${doc.status}`}
                    </div>
                  </td>

                  <td style={{ padding: '13px 16px', verticalAlign: 'top', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() =>
                          setInspectState({ documentId: doc.document_id, tab: 'permissions' })
                        }
                        style={{
                          padding: '6px 10px',
                          borderRadius: '7px',
                          border: '1px solid rgba(99, 102, 241, 0.35)',
                          backgroundColor: 'rgba(99, 102, 241, 0.14)',
                          color: '#c7d2fe',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Permissions
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setInspectState({ documentId: doc.document_id, tab: 'access' })
                        }
                        style={{
                          padding: '6px 10px',
                          borderRadius: '7px',
                          border: '1px solid #242a3d',
                          backgroundColor: '#141926',
                          color: '#cbd5e1',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        Access Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchiveTarget(doc)}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '7px',
                          border: `1px solid ${
                            doc.is_active
                              ? 'rgba(239, 68, 68, 0.35)'
                              : 'rgba(16, 185, 129, 0.35)'
                          }`,
                          backgroundColor: doc.is_active
                            ? 'rgba(239, 68, 68, 0.1)'
                            : 'rgba(16, 185, 129, 0.1)',
                          color: doc.is_active ? '#fca5a5' : '#6ee7b7',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {doc.is_active ? 'Archive' : 'Restore'}
                      </button>
                    </div>
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
          Showing {documents.length} of {total} governed documents (Page {page} of {totalPages})
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
        onUploaded={() => void loadDocuments()}
      />

      <DocumentDetailModal
        documentId={inspectState.documentId}
        initialTab={inspectState.tab}
        groups={groups}
        tenants={tenants}
        onClose={() => setInspectState({ documentId: null, tab: 'permissions' })}
        onUpdated={() => void loadDocuments()}
      />

      <ConfirmDialog
        isOpen={Boolean(archiveTarget)}
        tone={archiveTarget?.is_active ? 'danger' : 'warning'}
        title={archiveTarget?.is_active ? 'Confirm Document Archival' : 'Confirm Document Restoration'}
        description={
          archiveTarget
            ? `${archiveTarget.is_active ? 'Archive' : 'Restore'} ${archiveTarget.document_id} (${archiveTarget.title})?`
            : ''
        }
        implications={
          archiveTarget?.is_active
            ? [
                'All active chunks will immediately be marked inactive in pgvector and full-text search indexes.',
                'Users will receive 404 when querying or previewing this document until restored.',
              ]
            : ['Active version chunks will immediately resume retrieval for authorized users.']
        }
        confirmLabel={archiveTarget?.is_active ? 'Archive Document' : 'Restore Document'}
        busy={archiveBusy}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleConfirmRowArchive()}
      />
    </div>
  );
}
