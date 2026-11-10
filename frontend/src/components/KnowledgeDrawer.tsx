'use client';

import React, { useState, useEffect } from 'react';
import { DocumentRecord } from '@/lib/api';

interface KnowledgeDrawerProps {
  isOpen: boolean;
  documents: DocumentRecord[];
  onAskAboutDocument: (docTitle: string, docId: string) => void;
  onClose: () => void;
}

export function KnowledgeDrawer({
  isOpen,
  documents,
  onAskAboutDocument,
  onClose,
}: KnowledgeDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');

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

  const filteredDocs = documents.filter((doc) => {
    if (!searchQuery.trim()) return true;
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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </div>
            <div>
              <h2 id="knowledge-drawer-title" style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Document Library
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {documents.length} verified documents accessible in your scope
              </p>
            </div>
          </div>

          <button onClick={onClose} className="btn-icon" aria-label="Close knowledge drawer" style={{ width: '32px', height: '32px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search bar */}
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'rgba(10, 13, 20, 0.5)' }}>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              placeholder="Search documents by title, ID, or tenant..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-field"
              style={{
                width: '100%',
                paddingLeft: '34px',
                fontSize: '0.85rem',
                height: '38px',
              }}
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748b"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* Document list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {filteredDocs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 10px', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '0.9rem', marginBottom: '4px' }}>No documents found.</p>
              <p style={{ fontSize: '0.78rem' }}>Check your search terms or verify your account permissions.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {filteredDocs.map((doc) => (
                <div
                  key={doc.id}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 'var(--radius-md)',
                    padding: '14px 16px',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.borderColor = 'var(--border-medium)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)' }}>
                          {doc.document_id}
                        </span>
                        {getFormatBadge(doc.format)}
                        <span className={`badge ${getSensitivityClass(doc.metadata.sensitivity)}`}>
                          {doc.metadata.sensitivity || 'internal'}
                        </span>
                      </div>
                      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {doc.title}
                      </h3>
                    </div>

                    <button
                      onClick={() => {
                        onAskAboutDocument(doc.title, doc.document_id);
                        onClose();
                      }}
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '5px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}
                    >
                      Ask AI
                    </button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                    <span>Tenant: <strong style={{ color: '#cbd5e1' }}>{doc.metadata.tenant_id || 'global'}</strong></span>
                    <span>•</span>
                    <span>Version: <strong style={{ color: '#cbd5e1' }}>v{doc.current_version}</strong></span>
                    {doc.metadata.disclosure_policy && (
                      <>
                        <span>•</span>
                        <span>Policy: <strong style={{ color: '#cbd5e1' }}>{doc.metadata.disclosure_policy}</strong></span>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
