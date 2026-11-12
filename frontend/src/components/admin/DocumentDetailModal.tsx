'use client';

import React, { useEffect, useState } from 'react';
import {
  AdminDocumentDetail,
  AdminGroupItem,
  AdminTenantItem,
  fetchAdminDocumentDetail,
  toggleAdminDocumentArchive,
  updateAdminDocumentPermissions,
} from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import {
  DISCLOSURE_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  formatAdminLabel,
  getDisclosurePillStyle,
  getSensitivityPillStyle,
  MODAL_INPUT_STYLE,
  MODAL_LABEL_STYLE,
  OWNER_TEAM_OPTIONS,
  SENSITIVITY_OPTIONS,
} from './documentGovernanceHelpers';

interface DocumentDetailModalProps {
  documentId: string | null;
  initialTab?: 'permissions' | 'access' | 'history';
  groups: AdminGroupItem[];
  tenants: AdminTenantItem[];
  onClose: () => void;
  onUpdated: () => void;
}

export function DocumentDetailModal({
  documentId,
  initialTab = 'permissions',
  groups,
  tenants,
  onClose,
  onUpdated,
}: DocumentDetailModalProps) {
  const [tab, setTab] = useState<'permissions' | 'access' | 'history'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<AdminDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [accessFilter, setAccessFilter] = useState<'all' | 'allowed' | 'denied'>('all');

  // Editable form state
  const [title, setTitle] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [documentType, setDocumentType] = useState('');
  const [ownerTeam, setOwnerTeam] = useState('');
  const [sensitivity, setSensitivity] = useState('');
  const [disclosurePolicy, setDisclosurePolicy] = useState('');
  const [allowedGroups, setAllowedGroups] = useState<string[]>([]);
  const [approvedSummary, setApprovedSummary] = useState('');

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    mode: 'save' | 'archive';
    targetActive?: boolean;
    tone: 'warning' | 'danger';
    implications: string[];
  }>({ open: false, mode: 'save', tone: 'warning', implications: [] });

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, documentId]);

  const hydrateFromDetail = (d: AdminDocumentDetail) => {
    setDetail(d);
    setTitle(d.document.title);
    setTenantId(d.document.tenant_id);
    setDocumentType(d.document.document_type);
    setOwnerTeam(d.document.owner_team);
    setSensitivity(d.document.sensitivity);
    setDisclosurePolicy(d.document.disclosure_policy);
    setAllowedGroups(d.document.allowed_groups || []);
    setApprovedSummary(d.approved_summary?.summary_text || '');
  };

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    void fetchAdminDocumentDetail(documentId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.data) {
        setError(res.error || 'Failed to load document governance detail.');
        return;
      }
      hydrateFromDetail(res.data);
    });

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  if (!documentId) return null;

  const toggleGroup = (gid: string) => {
    setAllowedGroups((prev) =>
      prev.includes(gid) ? prev.filter((item) => item !== gid) : [...prev, gid]
    );
  };

  const executeSavePermissions = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    setConfirmState((s) => ({ ...s, open: false }));

    const res = await updateAdminDocumentPermissions(documentId, {
      title: title.trim(),
      tenant_id: tenantId,
      document_type: documentType,
      owner_team: ownerTeam,
      sensitivity,
      disclosure_policy: disclosurePolicy,
      allowed_groups: allowedGroups,
      approved_summary: approvedSummary.trim() || undefined,
    });

    setSaving(false);
    if (!res.data) {
      setError(res.error || 'Failed to update document permissions.');
      return;
    }

    hydrateFromDetail(res.data);
    setSuccessMsg('Permissions updated and synchronized across vector & full-text search indexes.');
    onUpdated();
  };

  const executeArchiveToggle = async (nextActive: boolean) => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    setConfirmState((s) => ({ ...s, open: false }));

    const res = await toggleAdminDocumentArchive(documentId, nextActive);
    setSaving(false);
    if (!res.data) {
      setError(res.error || 'Failed to update document archive status.');
      return;
    }

    hydrateFromDetail(res.data);
    setSuccessMsg(
      nextActive
        ? 'Document restored and active chunks re-enabled for authorized retrieval.'
        : 'Document archived and immediately excluded from all retrieval and preview endpoints.'
    );
    onUpdated();
  };

  const handleSaveClick = (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setError(null);

    if (allowedGroups.length === 0) {
      setError('At least one authorized group must remain selected.');
      return;
    }

    const implications: string[] = [];
    const openingToCustomer =
      (disclosurePolicy === 'customer_shareable' || disclosurePolicy === 'direct') &&
      detail.document.disclosure_policy !== disclosurePolicy;
    const movingTenant = tenantId !== detail.document.tenant_id;
    const restricting = sensitivity === 'restricted' && detail.document.sensitivity !== 'restricted';

    if (openingToCustomer) {
      implications.push(
        `Disclosure policy changes from '${detail.document.disclosure_policy}' to '${disclosurePolicy}', permitting customer disclosure within tenant '${tenantId}'.`
      );
    }
    if (movingTenant) {
      implications.push(
        `Tenant boundary shifts from '${detail.document.tenant_id}' to '${tenantId}', revoking prior tenant users and granting new tenant scope.`
      );
    }
    if (restricting) {
      implications.push('Document becomes Restricted sensitivity, requiring explicit security clearance.');
    }

    if (implications.length > 0) {
      setConfirmState({
        open: true,
        mode: 'save',
        tone: restricting || movingTenant ? 'danger' : 'warning',
        implications,
      });
      return;
    }

    void executeSavePermissions();
  };

  const filteredAccessUsers =
    detail?.effective_access.users.filter((u) => {
      if (accessFilter === 'allowed') return u.allowed;
      if (accessFilter === 'denied') return !u.allowed;
      return true;
    }) || [];

  const tenantChoices = tenants.some((t) => t.id === 'global')
    ? tenants
    : [{ id: 'global', name: 'Global Platform', status: 'active' } as AdminTenantItem, ...tenants];

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Document Governance Inspector"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 60,
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
            maxWidth: '820px',
            maxHeight: '90vh',
            overflowY: 'auto',
            backgroundColor: '#0f1422',
            border: '1px solid #242a3d',
            borderRadius: '14px',
            padding: '24px',
            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '16px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#a5b4fc',
                    backgroundColor: 'rgba(99, 102, 241, 0.14)',
                    padding: '3px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {detail?.document.document_id || documentId}
                </span>
                {detail && (
                  <>
                    <span
                      style={{
                        ...getSensitivityPillStyle(detail.document.sensitivity),
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      {formatAdminLabel(detail.document.sensitivity)}
                    </span>
                    <span
                      style={{
                        ...getDisclosurePillStyle(detail.document.disclosure_policy),
                        padding: '3px 8px',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                      }}
                    >
                      {formatAdminLabel(detail.document.disclosure_policy)}
                    </span>
                    {!detail.document.is_active && (
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '999px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          backgroundColor: 'rgba(239, 68, 68, 0.16)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#fca5a5',
                        }}
                      >
                        ARCHIVED
                      </span>
                    )}
                  </>
                )}
              </div>
              <h2 style={{ fontSize: '1.12rem', fontWeight: 700, color: '#eef0f6', margin: '8px 0 0 0' }}>
                {detail?.document.title || 'Loading document governance...'}
              </h2>
              {detail && (
                <p style={{ fontSize: '0.78rem', color: '#9ba3b8', margin: '4px 0 0 0' }}>
                  File: {detail.document.filename} · v{detail.document.current_version} · {detail.document.active_chunks_count} active chunks
                </p>
              )}
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

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #1e2436', marginBottom: '18px' }}>
            {[
              { id: 'permissions', label: 'Permissions & ACL' },
              {
                id: 'access',
                label: detail
                  ? `Effective Access (${detail.effective_access.permitted_count} allowed)`
                  : 'Effective Access',
              },
              { id: 'history', label: 'Versions & Audit History' },
            ].map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id as typeof tab)}
                  style={{
                    padding: '9px 14px',
                    border: 'none',
                    borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
                    backgroundColor: 'transparent',
                    color: active ? '#eef0f6' : '#9ba3b8',
                    fontSize: '0.82rem',
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {error && (
            <div
              style={{
                marginBottom: '14px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: '#fca5a5',
                fontSize: '0.82rem',
              }}
            >
              {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                marginBottom: '14px',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                color: '#6ee7b7',
                fontSize: '0.82rem',
              }}
            >
              {successMsg}
            </div>
          )}

          {loading || !detail ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: '#9ba3b8', fontSize: '0.85rem' }}>
              Loading document governance state...
            </div>
          ) : tab === 'permissions' ? (
            <form onSubmit={handleSaveClick} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={MODAL_LABEL_STYLE}>Document Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={MODAL_INPUT_STYLE}
                  disabled={saving}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={MODAL_LABEL_STYLE}>Tenant Owner</label>
                  <select
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    style={MODAL_INPUT_STYLE}
                    disabled={saving}
                  >
                    {tenantChoices.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.id})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={MODAL_LABEL_STYLE}>Document Type</label>
                  <select
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                    style={MODAL_INPUT_STYLE}
                    disabled={saving}
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((dt) => (
                      <option key={dt} value={dt}>
                        {formatAdminLabel(dt)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={MODAL_LABEL_STYLE}>Owner Team</label>
                  <select
                    value={ownerTeam}
                    onChange={(e) => setOwnerTeam(e.target.value)}
                    style={MODAL_INPUT_STYLE}
                    disabled={saving}
                  >
                    {OWNER_TEAM_OPTIONS.map((ot) => (
                      <option key={ot} value={ot}>
                        {formatAdminLabel(ot)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={MODAL_LABEL_STYLE}>Sensitivity Level</label>
                  <select
                    value={sensitivity}
                    onChange={(e) => setSensitivity(e.target.value)}
                    style={MODAL_INPUT_STYLE}
                    disabled={saving}
                  >
                    {SENSITIVITY_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {formatAdminLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={MODAL_LABEL_STYLE}>Disclosure Policy</label>
                  <select
                    value={disclosurePolicy}
                    onChange={(e) => setDisclosurePolicy(e.target.value)}
                    style={MODAL_INPUT_STYLE}
                    disabled={saving}
                  >
                    {DISCLOSURE_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {formatAdminLabel(d)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label style={MODAL_LABEL_STYLE}>
                  Authorized Groups ({allowedGroups.length} selected)
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '8px',
                    maxHeight: '165px',
                    overflowY: 'auto',
                    padding: '10px',
                    borderRadius: '8px',
                    border: '1px solid #242a3d',
                    backgroundColor: '#111622',
                  }}
                >
                  {groups.map((grp) => {
                    const checked = allowedGroups.includes(grp.id);
                    return (
                      <label
                        key={grp.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          backgroundColor: checked ? 'rgba(99, 102, 241, 0.14)' : 'transparent',
                          border: `1px solid ${checked ? 'rgba(99, 102, 241, 0.35)' : 'transparent'}`,
                          cursor: 'pointer',
                          fontSize: '0.78rem',
                          color: '#eef0f6',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={saving}
                          onChange={() => toggleGroup(grp.id)}
                        />
                        <span>{grp.name || grp.id}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={MODAL_LABEL_STYLE}>Approved Customer Summary (optional)</label>
                <textarea
                  rows={2}
                  value={approvedSummary}
                  onChange={(e) => setApprovedSummary(e.target.value)}
                  placeholder="Customer-approved summary text when using Approved Summary Only..."
                  style={{ ...MODAL_INPUT_STYLE, resize: 'vertical' }}
                  disabled={saving}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  marginTop: '6px',
                  paddingTop: '14px',
                  borderTop: '1px solid #1e2436',
                }}
              >
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setConfirmState({
                      open: true,
                      mode: 'archive',
                      targetActive: !detail.document.is_active,
                      tone: detail.document.is_active ? 'danger' : 'warning',
                      implications: detail.document.is_active
                        ? [
                            'Active chunks will immediately be deactivated in vector, full-text, and hybrid search.',
                            'All non-admin document listing, preview, and download endpoints will hide this document.',
                            'Historical versions and audit log entries remain preserved for compliance.',
                          ]
                        : [
                            'Active version chunks will immediately resume participating in retrieval and document access.',
                          ],
                    })
                  }
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: `1px solid ${
                      detail.document.is_active
                        ? 'rgba(239, 68, 68, 0.35)'
                        : 'rgba(16, 185, 129, 0.35)'
                    }`,
                    backgroundColor: detail.document.is_active
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'rgba(16, 185, 129, 0.12)',
                    color: detail.document.is_active ? '#fca5a5' : '#6ee7b7',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {detail.document.is_active ? 'Archive Document' : 'Restore Document'}
                </button>

                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: '9px 18px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: saving ? '#4338ca' : '#6366f1',
                    color: '#ffffff',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Syncing Indexes...' : 'Save Permissions'}
                </button>
              </div>
            </form>
          ) : tab === 'access' ? (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  gap: '10px',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: '#9ba3b8' }}>
                  Server-evaluated effective access for{' '}
                  <strong style={{ color: '#6ee7b7' }}>{detail.effective_access.permitted_count} permitted</strong>{' '}
                  and{' '}
                  <strong style={{ color: '#fca5a5' }}>{detail.effective_access.denied_count} denied</strong>{' '}
                  accounts.
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {(['all', 'allowed', 'denied'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setAccessFilter(f)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '6px',
                        border: '1px solid #242a3d',
                        backgroundColor: accessFilter === f ? '#6366f1' : '#141926',
                        color: accessFilter === f ? '#ffffff' : '#9ba3b8',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {f.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  border: '1px solid #1e2436',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
                      <th style={{ padding: '10px 12px' }}>Identity</th>
                      <th style={{ padding: '10px 12px' }}>Role / Type</th>
                      <th style={{ padding: '10px 12px' }}>Decision</th>
                      <th style={{ padding: '10px 12px' }}>Authorization Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAccessUsers.map((u) => (
                      <tr key={u.user_id} style={{ borderTop: '1px solid #1e2436' }}>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ fontWeight: 600, color: '#eef0f6' }}>{u.name}</div>
                          <div style={{ fontSize: '0.73rem', color: '#6b758d' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '9px 12px', color: '#cbd5e1' }}>
                          {formatAdminLabel(u.role)}
                        </td>
                        <td style={{ padding: '9px 12px' }}>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '999px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              backgroundColor: u.allowed
                                ? 'rgba(16, 185, 129, 0.14)'
                                : 'rgba(239, 68, 68, 0.14)',
                              color: u.allowed ? '#6ee7b7' : '#fca5a5',
                            }}
                          >
                            {u.allowed ? 'PERMITTED' : 'DENIED'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 12px', color: '#9ba3b8', fontSize: '0.75rem' }}>
                          {u.allowed ? 'Matches tenant, sensitivity & group ACL' : u.reason || 'Denied by policy'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#eef0f6', margin: '0 0 8px 0' }}>
                  Document Versions ({detail.versions.length})
                </h3>
                <div style={{ border: '1px solid #1e2436', borderRadius: '10px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
                        <th style={{ padding: '8px 12px' }}>Version</th>
                        <th style={{ padding: '8px 12px' }}>Status</th>
                        <th style={{ padding: '8px 12px' }}>Content SHA-256</th>
                        <th style={{ padding: '8px 12px' }}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.versions.map((v) => (
                        <tr key={v.id} style={{ borderTop: '1px solid #1e2436' }}>
                          <td style={{ padding: '8px 12px', fontWeight: 600, color: '#eef0f6' }}>
                            v{v.version}
                          </td>
                          <td style={{ padding: '8px 12px', color: v.status === 'active' ? '#6ee7b7' : '#9ba3b8' }}>
                            {v.status}
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#9ba3b8' }}>
                            {v.content_hash.slice(0, 16)}…
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
                <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#eef0f6', margin: '0 0 8px 0' }}>
                  Document Audit History ({detail.audit_history.length})
                </h3>
                {detail.audit_history.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: '#6b758d' }}>No audit events logged yet for this document.</p>
                ) : (
                  <div style={{ border: '1px solid #1e2436', borderRadius: '10px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#141926', color: '#9ba3b8', textAlign: 'left' }}>
                          <th style={{ padding: '8px 12px' }}>Timestamp</th>
                          <th style={{ padding: '8px 12px' }}>Actor</th>
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
                            <td style={{ padding: '8px 12px', color: '#eef0f6' }}>
                              {a.actor_email || a.actor_id || 'system'}
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

      <ConfirmDialog
        isOpen={confirmState.open}
        tone={confirmState.tone}
        title={
          confirmState.mode === 'archive'
            ? confirmState.targetActive
              ? 'Confirm Document Restoration'
              : 'Confirm Document Archival'
            : 'Confirm High-Impact Permission Change'
        }
        description={
          confirmState.mode === 'archive'
            ? `${confirmState.targetActive ? 'Restore' : 'Archive'} document ${detail?.document.document_id}?`
            : `Apply security and classification changes to ${detail?.document.document_id}?`
        }
        implications={confirmState.implications}
        confirmLabel={
          confirmState.mode === 'archive'
            ? confirmState.targetActive
              ? 'Restore Document'
              : 'Archive Document'
            : 'Apply Permissions'
        }
        busy={saving}
        onCancel={() => setConfirmState((s) => ({ ...s, open: false }))}
        onConfirm={() => {
          if (confirmState.mode === 'archive') {
            void executeArchiveToggle(Boolean(confirmState.targetActive));
          } else {
            void executeSavePermissions();
          }
        }}
      />
    </>
  );
}

