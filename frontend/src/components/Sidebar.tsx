'use client';

import React from 'react';
import { ConversationItem } from '@/lib/api';
import { AuthUserProfile } from '@/lib/auth';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  conversations: ConversationItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string, e: React.MouseEvent) => void;
  currentUser: AuthUserProfile | null;
  onOpenLibrary: () => void;
  onOpenLogin: () => void;
  onLogout: () => void;
  documentCount?: number;
}

export function Sidebar({
  isOpen,
  onToggle,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  currentUser,
  onOpenLibrary,
  onOpenLogin,
  onLogout,
  documentCount = 0,
}: SidebarProps) {
  const getInitials = (name?: string) => {
    if (!name) return 'U';
    const parts = name.split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  const formatRole = (role?: string) => {
    if (!role) return 'User';
    return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <>
      {/* Mobile backdrop (only active on <= 768px via media query) */}
      {isOpen && (
        <div
          onClick={onToggle}
          className="sidebar-backdrop"
          aria-label="Close sidebar backdrop"
        />
      )}

      {/* Sidebar container */}
      <aside
        className={`sidebar-container ${isOpen ? 'sidebar-open' : 'sidebar-closed'}`}
        style={{
          width: isOpen ? '270px' : '0px',
          minWidth: isOpen ? '270px' : '0px',
          height: '100vh',
          backgroundColor: '#0a0d14',
          borderRight: isOpen ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
          display: 'flex',
          flexDirection: 'column',
          transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
          zIndex: 50,
          position: 'relative',
          userSelect: 'none',
        }}
      >
        {/* Top Header / New Chat */}
        <div style={{ padding: '16px 14px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Brand Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.95rem',
                  color: '#ffffff',
                  boxShadow: '0 0 16px rgba(99, 102, 241, 0.35)',
                }}
              >
                A
              </div>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f8fafc', letterSpacing: '-0.02em' }}>
                  AccessCore
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.65rem',
                    color: '#64748b',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Knowledge AI
                </span>
              </div>
            </div>

            {/* Desktop Collapse toggle & Mobile Close Button */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={onToggle}
                className="sidebar-mobile-close-btn"
                title="Close sidebar"
                style={{
                  color: '#94a3b8',
                  padding: '6px',
                  borderRadius: '6px',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <button
                onClick={onToggle}
                className="hidden md:flex"
                title="Collapse sidebar"
                style={{
                  color: '#94a3b8',
                  padding: '6px',
                  borderRadius: '6px',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </svg>
              </button>
            </div>
          </div>

          {/* "+ New Chat" Button */}
          <button
            onClick={onNewChat}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '100%',
              padding: '10px 14px',
              borderRadius: '9px',
              backgroundColor: 'rgba(99, 102, 241, 0.12)',
              border: '1px solid rgba(99, 102, 241, 0.28)',
              color: '#c7d2fe',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.12)';
              e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.28)';
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>New Chat</span>
          </button>
        </div>

        {/* Quick Nav / Library */}
        <div style={{ padding: '0 14px 10px' }}>
          <button
            onClick={onOpenLibrary}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '8px 12px',
              borderRadius: '7px',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#94a3b8',
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
              <span>Document Library</span>
            </div>
            {documentCount > 0 && (
              <span
                style={{
                  fontSize: '0.7rem',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  color: '#cbd5e1',
                }}
              >
                {documentCount}
              </span>
            )}
          </button>
        </div>

        {/* Recents Section */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 10px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          <div
            style={{
              padding: '8px 8px 4px',
              fontSize: '0.72rem',
              fontWeight: 600,
              color: '#64748b',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Recent Chats
          </div>

          {conversations.length === 0 ? (
            <div style={{ padding: '24px 10px', textAlign: 'center', color: '#475569', fontSize: '0.8rem' }}>
              No recent conversations yet.
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConversationId;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectConversation(c.id)}
                  className="group"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.16)' : 'transparent',
                    border: isActive ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
                    color: isActive ? '#f1f5f9' : '#94a3b8',
                    fontSize: '0.83rem',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                      flex: 1,
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title || 'New Chat'}
                    </span>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => onDeleteConversation(c.id, e)}
                    title="Delete conversation"
                    style={{
                      opacity: isActive ? 0.7 : 0.4,
                      padding: '4px',
                      borderRadius: '4px',
                      color: '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'opacity 0.15s ease, color 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1';
                      e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = isActive ? '0.7' : '0.4';
                      e.currentTarget.style.color = '#94a3b8';
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* User Account / Footer */}
        <div
          style={{
            padding: '12px 14px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            backgroundColor: '#0c101a',
          }}
        >
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    backgroundColor: currentUser.user_type === 'employee' ? '#4f46e5' : '#059669',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}
                >
                  {getInitials(currentUser.name)}
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <div
                    style={{
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      color: '#f1f5f9',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {currentUser.name}
                  </div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: '#64748b',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatRole(currentUser.role)}
                  </div>
                </div>
              </div>

              <button
                onClick={onLogout}
                title="Sign out"
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenLogin}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '7px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#c7d2fe',
                fontSize: '0.825rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
