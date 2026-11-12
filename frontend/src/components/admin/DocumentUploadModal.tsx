'use client';

import React, { useEffect, useState } from 'react';
import {
  AdminGroupItem,
  AdminTenantItem,
  uploadAdminDocument,
} from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import {
  DISCLOSURE_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  formatAdminLabel,
  MODAL_INPUT_STYLE,
  MODAL_LABEL_STYLE,
  OWNER_TEAM_OPTIONS,
  SENSITIVITY_OPTIONS,
} from './documentGovernanceHelpers';

interface DocumentUploadModalProps {
  isOpen: boolean;
  groups: AdminGroupItem[];
  tenants: AdminTenantItem[];
  onClose: () => void;
  onUploaded: () => void;
}

const ACCEPTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.json', '.pdf'];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read selected file from disk.'));
    reader.readAsDataURL(file);
  });
}

export function DocumentUploadModal({
  isOpen,
  groups,
  tenants,
  onClose,
  onUploaded,
}: DocumentUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState('');
  const [title, setTitle] = useState('');
  const [documentType, setDocumentType] = useState<string>('product_doc');
  const [ownerTeam, setOwnerTeam] = useState<string>('engineering');
  const [tenantId, setTenantId] = useState<string>('global');
  const [sensitivity, setSensitivity] = useState<string>('internal');
  const [disclosurePolicy, setDisclosurePolicy] = useState<string>('internal_only');
  const [allowedGroups, setAllowedGroups] = useState<string[]>(['grp_engineering']);
  const [approvedSummary, setApprovedSummary] = useState('');

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedFile(null);
    setDocumentId('');
    setTitle('');
    setDocumentType('product_doc');
    setOwnerTeam('engineering');
    setTenantId('global');
    setSensitivity('internal');
    setDisclosurePolicy('internal_only');
    setAllowedGroups(['grp_engineering']);
    setApprovedSummary('');
    setError(null);
    setConfirmOpen(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFilePick = (file: File | null) => {
    setError(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }

    const lower = file.name.toLowerCase();
    const validExt = ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    if (!validExt) {
      setError(
        `Unsupported file format '${file.name}'. Allowed extensions: ${ACCEPTED_EXTENSIONS.join(', ')}.`
      );
      setSelectedFile(null);
      return;
    }
    if (file.size === 0) {
      setError(`File '${file.name}' is empty (0 bytes).`);
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File '${file.name}' exceeds the 10 MB upload limit.`);
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    if (!title.trim()) {
      const stem = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      if (stem) {
        setTitle(stem.replace(/\b\w/g, (c) => c.toUpperCase()));
      }
    }
    if (!documentId.trim()) {
      const randNum = Math.floor(500 + Math.random() * 499);
      setDocumentId(`DOC-${randNum}`);
    }
  };

  const toggleGroup = (gid: string) => {
    setAllowedGroups((prev) =>
      prev.includes(gid) ? prev.filter((item) => item !== gid) : [...prev, gid]
    );
  };

  const executeUpload = async () => {
    if (!selectedFile) {
      setError('Please choose a valid .md, .markdown, .txt, .json, or .pdf file.');
      return;
    }
    if (allowedGroups.length === 0) {
      setError('Select at least one authorized group.');
      return;
    }

    setUploading(true);
    setError(null);
    setConfirmOpen(false);

    try {
      const base64Content = await readFileAsBase64(selectedFile);
      const res = await uploadAdminDocument({
        filename: selectedFile.name,
        content: base64Content,
        is_base64: true,
        approved_summary: approvedSummary.trim() || undefined,
        override_metadata: {
          document_id: documentId.trim().toUpperCase() || undefined,
          title: title.trim() || undefined,
          document_type: documentType,
          owner_team: ownerTeam,
          tenant_id: tenantId,
          sensitivity,
          disclosure_policy: disclosurePolicy,
          allowed_groups: allowedGroups,
        },
      });

      setUploading(false);
      if (!res.data) {
        setError(res.error || 'Document upload and ingestion failed.');
        return;
      }
      onUploaded();
      onClose();
    } catch (err) {
      setUploading(false);
      setError(err instanceof Error ? err.message : 'Failed to upload document.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedFile) {
      setError('Please select a file before uploading.');
      return;
    }
    if (!documentId.trim()) {
      setError('Document ID code (e.g. DOC-501) is required.');
      return;
    }
    if (!title.trim()) {
      setError('Document title is required.');
      return;
    }
    if (allowedGroups.length === 0) {
      setError('Select at least one authorized group.');
      return;
    }

    const isHighImpact =
      sensitivity === 'public' ||
      disclosurePolicy === 'customer_shareable' ||
      disclosurePolicy === 'direct' ||
      sensitivity === 'restricted';

    if (isHighImpact) {
      setConfirmOpen(true);
      return;
    }

    void executeUpload();
  };

  const tenantChoices = tenants.some((t) => t.id === 'global')
    ? tenants
    : [{ id: 'global', name: 'Global Platform', status: 'active' } as AdminTenantItem, ...tenants];

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload Knowledge Document"
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
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              marginBottom: '18px',
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#eef0f6', margin: 0 }}>
                Upload & Index Document
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#9ba3b8', margin: '4px 0 0 0' }}>
                Admin-only ingestion with server-enforced classification, ACL permissions, and immediate vector/FTS indexing.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              style={{
                border: '1px solid #242a3d',
                backgroundColor: '#141926',
                color: '#9ba3b8',
                borderRadius: '8px',
                padding: '6px 10px',
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
                marginBottom: '16px',
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

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* File Drop/Input */}
            <div
              style={{
                padding: '14px',
                borderRadius: '10px',
                border: '1px dashed #334155',
                backgroundColor: '#111827',
              }}
            >
              <label style={MODAL_LABEL_STYLE}>
                Source File (.md, .markdown, .txt, .json, .pdf — max 10 MB)
              </label>
              <input
                type="file"
                accept=".md,.markdown,.txt,.json,.pdf"
                disabled={uploading}
                onChange={(e) => handleFilePick(e.target.files?.[0] || null)}
                style={{ color: '#cbd5e1', fontSize: '0.82rem', width: '100%' }}
              />
              {selectedFile && (
                <div style={{ marginTop: '8px', fontSize: '0.78rem', color: '#6ee7b7' }}>
                  Selected: <strong>{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(1)} KB)
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px' }}>
              <div>
                <label style={MODAL_LABEL_STYLE}>Document Code</label>
                <input
                  type="text"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                  placeholder="DOC-501"
                  style={MODAL_INPUT_STYLE}
                  disabled={uploading}
                />
              </div>
              <div>
                <label style={MODAL_LABEL_STYLE}>Document Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brightwave Webhook Onboarding Guide"
                  style={MODAL_INPUT_STYLE}
                  disabled={uploading}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
              <div>
                <label style={MODAL_LABEL_STYLE}>Tenant Owner</label>
                <select
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  style={MODAL_INPUT_STYLE}
                  disabled={uploading}
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
                  disabled={uploading}
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
                  disabled={uploading}
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
                  disabled={uploading}
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
                  disabled={uploading}
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
                  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: '8px',
                  maxHeight: '150px',
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
                        disabled={uploading}
                        onChange={() => toggleGroup(grp.id)}
                      />
                      <span>{grp.name || grp.id}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={MODAL_LABEL_STYLE}>
                Approved Customer Summary (optional — used for Approved Summary Only disclosure)
              </label>
              <textarea
                rows={2}
                value={approvedSummary}
                onChange={(e) => setApprovedSummary(e.target.value)}
                placeholder="Concise, customer-safe summary permitted for customer responses..."
                style={{ ...MODAL_INPUT_STYLE, resize: 'vertical' }}
                disabled={uploading}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={onClose}
                disabled={uploading}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  border: '1px solid #242a3d',
                  backgroundColor: '#141926',
                  color: '#cbd5e1',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: uploading ? '#4338ca' : '#6366f1',
                  color: '#ffffff',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                }}
              >
                {uploading ? 'Indexing & Embedding...' : 'Upload & Index Document'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        tone={sensitivity === 'restricted' ? 'danger' : 'warning'}
        title="Confirm High-Impact Document Upload"
        description={`Confirm uploading "${title || selectedFile?.name}" with sensitivity '${sensitivity}' and disclosure policy '${disclosurePolicy}'.`}
        implications={[
          `Tenant boundary: ${tenantId}`,
          `Authorized groups: ${allowedGroups.join(', ')}`,
          disclosurePolicy === 'customer_shareable' || sensitivity === 'public'
            ? 'Customers matching the tenant and allowed groups will immediately be able to retrieve and cite this document.'
            : 'Restricted classification limits retrieval strictly to cleared security/incident review members.',
        ]}
        confirmLabel="Confirm & Upload"
        busy={uploading}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void executeUpload()}
      />
    </>
  );
}

