'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  DocumentRecord,
  uploadDocument,
  fetchDocuments,
  IngestDocumentOutput,
  Sensitivity,
} from '@/lib/api';

interface KnowledgeDrawerProps {
  isOpen: boolean;
  initialTab?: 'upload' | 'library';
  documents: DocumentRecord[];
  onDocumentsUpdated: (docs: DocumentRecord[]) => void;
  onAskAboutDocument: (docTitle: string, docId: string) => void;
  onClose: () => void;
}

export function KnowledgeDrawer({
  isOpen,
  initialTab = 'library',
  documents,
  onDocumentsUpdated,
  onAskAboutDocument,
  onClose,
}: KnowledgeDrawerProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'library'>(initialTab);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressStep, setUploadProgressStep] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<IngestDocumentOutput | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Search filter for library
  const [searchQuery, setSearchQuery] = useState('');

  // Optional metadata overrides
  const [tenantOverride, setTenantOverride] = useState('');
  const [sensitivityOverride, setSensitivityOverride] = useState<Sensitivity | ''>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const allowed = ['pdf', 'md', 'markdown', 'json'];
    if (!ext || !allowed.includes(ext)) {
      setUploadError(`Unsupported file format (.${ext}). Only PDF, Markdown (.md), and JSON ticket files are supported.`);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setUploadError(null);
    setUploadResult(null);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadResult(null);
    setUploadProgressStep('Uploading file and validating format...');

    const metadataOverrides: Record<string, unknown> = {};
    if (tenantOverride.trim()) metadataOverrides.tenant_id = tenantOverride.trim();
    if (sensitivityOverride) metadataOverrides.sensitivity = sensitivityOverride;

    const result = await uploadDocument(
      selectedFile,
      Object.keys(metadataOverrides).length > 0 ? metadataOverrides : undefined
    );

    if (result.error) {
      setUploadError(result.error);
      setIsUploading(false);
      setUploadProgressStep('');
      return;
    }

    setUploadResult(result.data);
    setUploadProgressStep('');
    setIsUploading(false);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Refresh documents library
    const refreshed = await fetchDocuments();
    if (refreshed.data) {
      onDocumentsUpdated(refreshed.data);
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const q = searchQuery.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.document_id.toLowerCase().includes(q) ||
      doc.filename.toLowerCase().includes(q) ||
      (doc.metadata.tenant_id && doc.metadata.tenant_id.toLowerCase().includes(q))
    );
  });

  const getFormatBadge = (fmt: string) => {
    const f = fmt.toUpperCase();
    if (f === 'PDF') return <span className="badge badge-accent">PDF</span>;
    if (f === 'MARKDOWN' || f === 'MD') return <span className="badge badge-info">MD</span>;
    if (f === 'JSON') return <span className="badge badge-warning">JSON</span>;
    return <span className="badge badge-muted">{f}</span>;
  };

  const getSensitivityClass = (sens?: string) => {
    switch (sens) {
      case 'public':
        return 'badge-sensitivity-public';
      case 'internal':
        return 'badge-sensitivity-internal';
      case 'confidential':
        return 'badge-sensitivity-confidential';
      case 'restricted':
        return 'badge-sensitivity-restricted';
      default:
        return 'badge-muted';
    }
  };

  return (
    <div
      className="drawer-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="knowledge-drawer-title">
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 20, 34, 0.95)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#a5b4fc',
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </div>
            <div>
              <h2
                id="knowledge-drawer-title"
                style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}
              >
                Knowledge Base & Ingestion
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {documents.length} verified documents indexed
              </p>
            </div>
          </div>

          <button onClick={onClose} className="btn-icon" aria-label="Close knowledge drawer" style={{ width: '32px', height: '32px' }}>
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Buttons */}
        <div
          style={{
            display: 'flex',
            borderBottom: '1px solid var(--border-subtle)',
            background: 'rgba(10, 13, 20, 0.4)',
          }}
        >
          <button
            onClick={() => setActiveTab('upload')}
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: activeTab === 'upload' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'upload' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              background: activeTab === 'upload' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload Document
          </button>
          <button
            onClick={() => setActiveTab('library')}
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: activeTab === 'library' ? 'var(--text-primary)' : 'var(--text-secondary)',
              borderBottom: activeTab === 'library' ? '2px solid var(--accent-primary)' : '2px solid transparent',
              background: activeTab === 'library' ? 'rgba(99, 102, 241, 0.08)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M7 7h10" />
              <path d="M7 12h10" />
              <path d="M7 17h10" />
            </svg>
            Indexed Library ({documents.length})
          </button>
        </div>

        {/* Tab 1: Upload */}
        {activeTab === 'upload' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '6px' }}>
                Ingest Document into AccessCore
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Upload technical manuals (PDF), markdown documentation, or JSON customer support tickets.
                Documents are automatically parsed, section-chunked, embedded, and indexed.
              </p>
            </div>

            {/* Drop Zone */}
            <div
              className={`dropzone ${isDragging ? 'active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ marginBottom: '20px' }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.md,.markdown,.json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />

              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  background: 'rgba(99, 102, 241, 0.1)',
                  color: 'var(--accent-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 12px',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>

              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                {selectedFile ? selectedFile.name : 'Click to select or drag and drop file'}
              </div>

              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB • Ready for ingestion`
                  : 'Supported formats: PDF, Markdown (.md), JSON Ticket (.json)'}
              </div>
            </div>

            {/* Selected File Card */}
            {selectedFile && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '6px',
                      background: 'rgba(99, 102, 241, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--accent-primary)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    {selectedFile.name.split('.').pop()?.toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {selectedFile.name}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setSelectedFile(null)}
                  className="btn-icon"
                  style={{ width: '28px', height: '28px' }}
                  title="Remove selection"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            )}

            {/* Ingestion Progress & Status */}
            {isUploading && (
              <div
                style={{
                  background: 'rgba(99, 102, 241, 0.08)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div style={{ display: 'flex', gap: '4px' }}>
                  <span className="pulse-bubble" />
                  <span className="pulse-bubble" />
                  <span className="pulse-bubble" />
                </div>
                <div style={{ fontSize: '0.85rem', color: '#c7d2fe' }}>
                  {uploadProgressStep || 'Processing and indexing document...'}
                </div>
              </div>
            )}

            {/* Success Message */}
            {uploadResult && (
              <div
                style={{
                  background: 'var(--status-success-bg)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  marginBottom: '20px',
                  color: '#6ee7b7',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                  <strong style={{ fontSize: '0.9rem' }}>Ingestion Completed Successfully</strong>
                </div>
                <div style={{ fontSize: '0.8rem', lineHeight: 1.5, color: '#a7f3d0' }}>
                  Document <strong>[{uploadResult.document_id}]</strong> indexed as version{' '}
                  <strong>v{uploadResult.version}</strong> with{' '}
                  <strong>{uploadResult.chunks_count} chunks</strong>.
                  {uploadResult.embeddings_reused_count > 0 &&
                    ` (${uploadResult.embeddings_reused_count} cached vector embeddings reused).`}
                </div>
              </div>
            )}

            {/* Error Message */}
            {uploadError && (
              <div
                style={{
                  background: 'var(--status-error-bg)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  marginBottom: '20px',
                  color: '#fca5a5',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <strong style={{ fontSize: '0.9rem' }}>Ingestion Error</strong>
                </div>
                <p style={{ fontSize: '0.8rem', color: '#f87171' }}>{uploadError}</p>
              </div>
            )}

            {/* Optional Metadata Controls */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '16px',
                marginBottom: '24px',
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '12px' }}>
                Optional Metadata Overrides
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Tenant Scope
                  </label>
                  <input
                    type="text"
                    value={tenantOverride}
                    onChange={(e) => setTenantOverride(e.target.value)}
                    placeholder="e.g. tenant_cloud_desk"
                    style={{
                      width: '100%',
                      background: 'rgba(10, 13, 20, 0.8)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: '0.8rem',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    Sensitivity
                  </label>
                  <select
                    value={sensitivityOverride}
                    onChange={(e) => setSensitivityOverride(e.target.value as Sensitivity)}
                    style={{
                      width: '100%',
                      background: 'rgba(10, 13, 20, 0.8)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '8px 10px',
                      fontSize: '0.8rem',
                      color: 'var(--text-primary)',
                      outline: 'none',
                    }}
                  >
                    <option value="">Default (From file)</option>
                    <option value="public">Public</option>
                    <option value="internal">Internal</option>
                    <option value="confidential">Confidential</option>
                    <option value="restricted">Restricted</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className="btn-primary"
              style={{ width: '100%', padding: '12px', fontSize: '0.9rem' }}
            >
              {isUploading ? 'Ingesting Document...' : 'Index & Generate Embeddings'}
            </button>
          </div>
        )}

        {/* Tab 2: Indexed Library */}
        {activeTab === 'library' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column' }}>
            {/* Search filter */}
            <div style={{ marginBottom: '16px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter documents by ID, title, or tenant..."
                style={{
                  width: '100%',
                  background: 'rgba(10, 13, 20, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  padding: '10px 14px',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
            </div>

            {/* Document list */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredDocuments.length === 0 ? (
                <div
                  style={{
                    padding: '36px 20px',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.875rem',
                  }}
                >
                  No indexed documents match &ldquo;{searchQuery}&rdquo;.
                </div>
              ) : (
                filteredDocuments.map((doc) => (
                  <div
                    key={doc.id || doc.document_id}
                    style={{
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '14px 16px',
                      transition: 'border-color 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: 'var(--accent-primary)',
                          background: 'rgba(99, 102, 241, 0.1)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {doc.document_id}
                      </span>
                      {getFormatBadge(doc.format)}
                      <span className="badge badge-muted">v{doc.current_version}</span>
                      <span className={`badge ${getSensitivityClass(doc.metadata.sensitivity)}`}>
                        {doc.metadata.sensitivity || 'internal'}
                      </span>
                    </div>

                    <h4
                      style={{
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        marginBottom: '6px',
                      }}
                    >
                      {doc.title}
                    </h4>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        marginTop: '8px',
                        borderTop: '1px solid var(--border-subtle)',
                        paddingTop: '8px',
                      }}
                    >
                      <span>Tenant: {doc.metadata.tenant_id || 'System'}</span>
                      <button
                        onClick={() => {
                          onAskAboutDocument(doc.title, doc.document_id);
                          onClose();
                        }}
                        style={{
                          color: 'var(--accent-primary)',
                          fontWeight: 600,
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        Ask About This →
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
