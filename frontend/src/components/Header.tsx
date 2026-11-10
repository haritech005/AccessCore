'use client';

import React from 'react';
import { AuthUserProfile } from '@/lib/auth';

interface HeaderProps {
  isBackendConnected: boolean | null;
  documentCount: number;
  currentUser: AuthUserProfile | null;
  onOpenKnowledgeDrawer: () => void;
  onOpenLoginModal: () => void;
  onLogout: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export function Header({
  isBackendConnected,
  documentCount,
  currentUser,
  onOpenKnowledgeDrawer,
  onOpenLoginModal,
  onLogout,
  onToggleSidebar,
  isSidebarOpen,
}: HeaderProps) {
  return (
    <header
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'rgba(10, 13, 20, 0.85)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 30,
        height: '60px',
      }}
    >
      <div
        style={{
          width: '100%',
          padding: '0 20px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Left Side: Sidebar Toggle & Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              title={isSidebarOpen ? 'Hide sidebar' : 'Open sidebar'}
              style={{
                padding: '7px',
                borderRadius: '7px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = '#ffffff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                e.currentTarget.style.color = '#94a3b8';
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              AccessCore
            </span>
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
                letterSpacing: '0.04em',
              }}
            >
              Knowledge AI
            </span>
          </div>
        </div>

        {/* Right action controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Connection status indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              padding: '4px 10px',
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
                  : 'status-dot-pending'
              }`}
            />
            <span style={{ display: 'inline' }}>
              {isBackendConnected === true ? 'Online' : isBackendConnected === false ? 'Offline' : 'Connecting'}
            </span>
          </div>

          {/* Document Library Button */}
          <button
            onClick={onOpenKnowledgeDrawer}
            style={{
              padding: '6px 12px',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              borderRadius: '7px',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontWeight: 500,
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)')}
            title="Inspect permitted knowledge documents"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
              <path d="M6 6h10" />
              <path d="M6 10h10" />
            </svg>
            <span>Library</span>
            {documentCount > 0 && (
              <span
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  background: 'rgba(99, 102, 241, 0.25)',
                  color: '#c7d2fe',
                  padding: '1px 5px',
                  borderRadius: '999px',
                }}
              >
                {documentCount}
              </span>
            )}
          </button>

          {/* User Sign In / Profile */}
          {currentUser ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '3px 8px 3px 4px',
                background: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                borderRadius: 'var(--radius-full)',
              }}
            >
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  background: currentUser.user_type === 'employee' ? '#4f46e5' : '#059669',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.7rem',
                }}
              >
                {currentUser.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {currentUser.name.split(' ')[0]}
              </span>
              <button
                onClick={onLogout}
                title="Sign out"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--status-error)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenLoginModal}
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '0.8rem', height: '32px' }}
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
