'use client';

import React from 'react';

interface HeaderProps {
  isBackendConnected: boolean | null;
  documentCount: number;
  onOpenKnowledgeDrawer: (initialTab?: 'upload' | 'library') => void;
}

export function Header({
  isBackendConnected,
  documentCount,
  onOpenKnowledgeDrawer,
}: HeaderProps) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(10, 13, 20, 0.85)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0 24px',
          height: '68px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Brand identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'var(--accent-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: '1.25rem',
              color: '#ffffff',
              boxShadow: 'var(--shadow-glow)',
              flexShrink: 0,
            }}
          >
            A
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1
                style={{
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                }}
              >
                AccessCore
              </h1>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'rgba(99, 102, 241, 0.15)',
                  color: '#a5b4fc',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  letterSpacing: '0.05em',
                }}
              >
                Enterprise RAG
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Permission-Aware Knowledge Assistant
            </p>
          </div>
        </div>

        {/* Right action controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Connection status indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 'var(--radius-full)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <span
              className={`status-dot ${
                isBackendConnected === true
                  ? 'status-dot-active'
                  : isBackendConnected === false
                  ? 'status-dot-error'
                  : 'status-dot-warning'
              }`}
            />
            <span>
              {isBackendConnected === true
                ? 'System Ready'
                : isBackendConnected === false
                ? 'Offline'
                : 'Connecting...'}
            </span>
          </div>

          {/* Upload Button */}
          <button
            onClick={() => onOpenKnowledgeDrawer('upload')}
            className="btn-primary"
            style={{
              padding: '7px 14px',
              fontSize: '0.825rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            title="Upload new documentation or support ticket"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Upload Document</span>
          </button>

          {/* Knowledge Library Button */}
          <button
            onClick={() => onOpenKnowledgeDrawer('library')}
            className="btn-secondary"
            style={{
              padding: '7px 12px',
              fontSize: '0.825rem',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
            }}
            title="View indexed knowledge documents"
          >
            <svg
              width="15"
              height="15"
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
            <span>Knowledge Base</span>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.1)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                color: 'var(--text-primary)',
              }}
            >
              {documentCount}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
