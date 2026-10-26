'use client';

import React, { useEffect } from 'react';
import { Citation } from '@/lib/api';

interface CitationDrawerProps {
  citation: Citation | null;
  allCitations: Citation[];
  onSelectCitation: (citation: Citation) => void;
  onClose: () => void;
}

export function CitationDrawer({
  citation,
  allCitations,
  onSelectCitation,
  onClose,
}: CitationDrawerProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!citation) return null;

  const getSensitivityClass = (sens: string) => {
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
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="citation-drawer-title">
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
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div>
              <h2
                id="citation-drawer-title"
                style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}
              >
                Citation Provenance
              </h2>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Verified source evidence retrieved for answer
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="btn-icon"
            aria-label="Close provenance drawer"
            style={{ width: '32px', height: '32px' }}
          >
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

        {/* Tab switch between citations if multiple exist */}
        {allCitations.length > 1 && (
          <div
            style={{
              padding: '10px 24px',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'rgba(10, 13, 20, 0.4)',
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
            }}
          >
            {allCitations.map((c, idx) => {
              const isSelected = c.document_id === citation.document_id && c.chunk_index === citation.chunk_index;
              return (
                <button
                  key={`${c.document_id}-${c.chunk_index}-${idx}`}
                  onClick={() => onSelectCitation(c)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    borderRadius: 'var(--radius-sm)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                    color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                    border: isSelected
                      ? '1px solid rgba(99, 102, 241, 0.6)'
                      : '1px solid var(--border-subtle)',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                  }}
                >
                  [{c.document_id}] #{c.chunk_index}
                </button>
              );
            })}
          </div>
        )}

        {/* Drawer Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
          {/* Document Header Card */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '18px',
              marginBottom: '20px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px',
                flexWrap: 'wrap',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: 'var(--accent-primary)',
                  background: 'rgba(99, 102, 241, 0.1)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                }}
              >
                {citation.document_id}
              </span>
              <span className={`badge ${getSensitivityClass(citation.sensitivity)}`}>
                {citation.sensitivity}
              </span>
              <span className="badge badge-muted">
                Policy: {citation.disclosure_policy}
              </span>
            </div>

            <h3
              style={{
                fontSize: '1.1rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
                marginBottom: '10px',
                lineHeight: 1.4,
              }}
            >
              {citation.title}
            </h3>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '10px',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                borderTop: '1px solid var(--border-subtle)',
                paddingTop: '12px',
              }}
            >
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Tenant: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  {citation.tenant_id}
                </span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Chunk: </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
                  #{citation.chunk_index}
                </span>
              </div>
              {citation.source_location && (
                <div style={{ gridColumn: 'span 2' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Section: </span>
                  <span style={{ color: 'var(--text-primary)' }}>{citation.source_location}</span>
                </div>
              )}
            </div>
          </div>

          {/* Evidence Passage Section */}
          <div style={{ marginBottom: '16px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '8px',
              }}
            >
              <h4
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                }}
              >
                Retrieved Passage Text
              </h4>
              <span
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--status-success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className="status-dot status-dot-active" />
                Evidence Grounded
              </span>
            </div>

            <div
              style={{
                background: 'rgba(10, 13, 20, 0.7)',
                border: '1px solid var(--border-medium)',
                borderLeft: '4px solid var(--accent-primary)',
                borderRadius: 'var(--radius-md)',
                padding: '16px 18px',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {citation.snippet}
            </div>
          </div>

          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(255, 255, 255, 0.02)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.775rem',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            AccessCore cross-verifies every document citation before presentation. Only factual passages
            retrieved from active, authorized versions are accepted as ground truth.
          </div>
        </div>

        {/* Drawer Footer */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(15, 20, 34, 0.95)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button onClick={onClose} className="btn-secondary" style={{ padding: '8px 18px' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
