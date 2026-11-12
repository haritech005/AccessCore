'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AdminAccessCheckData, checkAdminAccess } from '@/lib/api';
import { AuthUserProfile, getCurrentUser, logoutUser } from '@/lib/auth';
import { LoginModal } from '@/components/LoginModal';

interface AdminSessionContextValue {
  access: AdminAccessCheckData;
  refreshAccess: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function useAdminSession(): AdminSessionContextValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    throw new Error('useAdminSession must be used within an authorized AdminShell');
  }
  return ctx;
}

interface NavItem {
  href: string;
  label: string;
  subtitle: string;
  icon: React.ReactNode;
}

const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    href: '/admin',
    label: 'Overview',
    subtitle: 'System metrics & posture',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="7" height="9" x="3" y="3" rx="1" />
        <rect width="7" height="5" x="14" y="3" rx="1" />
        <rect width="7" height="9" x="14" y="12" rx="1" />
        <rect width="7" height="5" x="3" y="16" rx="1" />
      </svg>
    ),
  },
  {
    href: '/admin/users',
    label: 'Users',
    subtitle: 'Accounts & status',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/admin/roles-groups',
    label: 'Roles & Groups',
    subtitle: 'RBAC & tenant scope',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '/admin/documents',
    label: 'Documents',
    subtitle: 'Corpus & visibility',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" x2="8" y1="13" y2="13" />
        <line x1="16" x2="8" y1="17" y2="17" />
      </svg>
    ),
  },
  {
    href: '/admin/ingestion',
    label: 'Ingestion Jobs',
    subtitle: 'Pipelines & chunks',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
      </svg>
    ),
  },
  {
    href: '/admin/audit-logs',
    label: 'Audit Logs',
    subtitle: 'Security telemetry',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
];

type GateState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; message: string }
  | { status: 'forbidden'; user: AuthUserProfile | null; message: string }
  | { status: 'error'; message: string }
  | { status: 'authorized'; access: AdminAccessCheckData };

function formatRoleLabel(role?: string): string {
  if (!role) return 'Unknown';
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getInitials(name?: string): string {
  if (!name) return 'AD';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [gate, setGate] = useState<GateState>({ status: 'loading' });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  }, []);

  const verifyAccess = useCallback(async () => {
    setGate({ status: 'loading' });
    const [profile, accessResult] = await Promise.all([
      getCurrentUser(),
      checkAdminAccess(),
    ]);

    if (accessResult.data && accessResult.data.authorized) {
      setGate({ status: 'authorized', access: accessResult.data });
      return;
    }

    if (accessResult.status === 401 || !profile) {
      setGate({
        status: 'unauthenticated',
        message: accessResult.error || 'Please sign in with an administrator account to access the Admin Console.',
      });
      return;
    }

    if (accessResult.status === 403) {
      setGate({
        status: 'forbidden',
        user: profile,
        message:
          accessResult.error ||
          'Administrator privileges (admin or it_security_admin) are required to access this workspace.',
      });
      return;
    }

    setGate({
      status: 'error',
      message: accessResult.error || 'Unable to verify administrator access right now.',
    });
  }, []);

  useEffect(() => {
    void verifyAccess();
  }, [verifyAccess]);

  const handleLoginSuccess = async () => {
    setIsLoginOpen(false);
    await verifyAccess();
  };

  const handleLogout = async () => {
    await logoutUser();
    await verifyAccess();
  };

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 768) {
      setIsSidebarOpen(false);
    }
  };

  const currentNav =
    ADMIN_NAV_ITEMS.find((item) =>
      item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href)
    ) || ADMIN_NAV_ITEMS[0];

  if (gate.status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0a0d14',
          color: '#f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
            padding: '28px 32px',
            borderRadius: '14px',
            backgroundColor: '#0f1422',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '999px',
              border: '3px solid rgba(99, 102, 241, 0.25)',
              borderTopColor: '#6366f1',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ fontSize: '0.9rem', color: '#cbd5e1', fontWeight: 500 }}>
            Verifying administrator permissions...
          </div>
        </div>
      </div>
    );
  }

  if (gate.status === 'unauthenticated') {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0a0d14',
          color: '#f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '460px',
            width: '100%',
            padding: '32px',
            borderRadius: '16px',
            backgroundColor: '#0f1422',
            border: '1px solid rgba(255, 255, 255, 0.09)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: 'rgba(99, 102, 241, 0.14)',
              border: '1px solid rgba(99, 102, 241, 0.35)',
              color: '#818cf8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '18px',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#818cf8', marginBottom: '6px' }}>
            401 · Authentication Required
          </div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 10px' }}>
            AccessCore Admin Console
          </h1>
          <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#94a3b8', margin: '0 0 24px' }}>
            {gate.message}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <button
              onClick={() => setIsLoginOpen(true)}
              style={{
                flex: '1 1 160px',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#6366f1',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.86rem',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Sign In as Admin
            </button>
            <Link
              href="/"
              style={{
                flex: '1 1 160px',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontWeight: 600,
                fontSize: '0.86rem',
                textAlign: 'center',
                textDecoration: 'none',
              }}
            >
              Back to Knowledge AI
            </Link>
          </div>
        </div>
        <LoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      </div>
    );
  }

  if (gate.status === 'forbidden' || gate.status === 'error') {
    const isForbidden = gate.status === 'forbidden';
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#0a0d14',
          color: '#f1f5f9',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            maxWidth: '480px',
            width: '100%',
            padding: '32px',
            borderRadius: '16px',
            backgroundColor: '#0f1422',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              color: '#f87171',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '18px',
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" x2="12" y1="8" y2="12" />
              <line x1="12" x2="12.01" y1="16" y2="16" />
            </svg>
          </div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#f87171', marginBottom: '6px' }}>
            {isForbidden ? '403 · Access Denied' : 'Verification Error'}
          </div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 10px' }}>
            {isForbidden ? 'Administrator Access Required' : 'Unable to Load Admin Console'}
          </h1>
          <p style={{ fontSize: '0.88rem', lineHeight: 1.6, color: '#94a3b8', margin: '0 0 18px' }}>
            {gate.message}
          </p>

          {gate.status === 'forbidden' && gate.user && (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                marginBottom: '22px',
                fontSize: '0.8rem',
                color: '#cbd5e1',
              }}
            >
              Signed in as <strong>{gate.user.name}</strong> ({gate.user.email}) · Role:{' '}
              <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                {formatRoleLabel(gate.user.role)}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <Link
              href="/"
              style={{
                flex: '1 1 160px',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: '#6366f1',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.86rem',
                textAlign: 'center',
                textDecoration: 'none',
              }}
            >
              Return to Knowledge AI
            </Link>
            <button
              onClick={() => setIsLoginOpen(true)}
              style={{
                flex: '1 1 130px',
                padding: '10px 16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#e2e8f0',
                fontWeight: 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
              }}
            >
              Switch Account
            </button>
            <button
              onClick={handleLogout}
              style={{
                padding: '10px 14px',
                borderRadius: '8px',
                backgroundColor: 'transparent',
                border: '1px solid rgba(239, 68, 68, 0.28)',
                color: '#fca5a5',
                fontWeight: 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
        <LoginModal
          isOpen={isLoginOpen}
          onClose={() => setIsLoginOpen(false)}
          onLoginSuccess={handleLoginSuccess}
        />
      </div>
    );
  }

  const { admin } = gate.access;

  return (
    <AdminSessionContext.Provider value={{ access: gate.access, refreshAccess: verifyAccess }}>
      <div
        style={{
          display: 'flex',
          height: '100vh',
          width: '100%',
          backgroundColor: '#0a0d14',
          color: '#f1f5f9',
          overflow: 'hidden',
        }}
      >
        {isSidebarOpen && (
          <div
            onClick={() => setIsSidebarOpen(false)}
            className="sidebar-backdrop"
            aria-label="Close admin navigation backdrop"
          />
        )}

        <aside
          className={`sidebar-container ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'}`}
          style={{
            width: isSidebarOpen ? '272px' : '0px',
            minWidth: isSidebarOpen ? '272px' : '0px',
            height: '100vh',
            backgroundColor: '#0c101a',
            borderRight: isSidebarOpen ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
            overflow: 'hidden',
            zIndex: 50,
            position: 'relative',
            userSelect: 'none',
          }}
        >
          {/* Sidebar Brand Header */}
          <div style={{ padding: '16px 14px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
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
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#f8fafc', letterSpacing: '-0.02em' }}>
                    AccessCore
                  </div>
                  <div
                    style={{
                      fontSize: '0.65rem',
                      color: '#a5b4fc',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Admin Console
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => setIsSidebarOpen(false)}
                  className="sidebar-mobile-close-btn"
                  title="Close navigation"
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
                  onClick={() => setIsSidebarOpen(false)}
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

            <Link
              href="/"
              onClick={closeSidebarOnMobile}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                color: '#cbd5e1',
                fontSize: '0.82rem',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span>Back to Knowledge AI</span>
            </Link>
          </div>

          {/* Navigation Menu */}
          <nav
            aria-label="Admin navigation"
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '6px 12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            <div
              style={{
                padding: '6px 8px 6px',
                fontSize: '0.68rem',
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              Administration
            </div>

            {ADMIN_NAV_ITEMS.map((item) => {
              const isActive =
                item.href === '/admin'
                  ? pathname === '/admin'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeSidebarOnMobile}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '9px 11px',
                    borderRadius: '9px',
                    textDecoration: 'none',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.16)' : 'transparent',
                    border: isActive
                      ? '1px solid rgba(99, 102, 241, 0.35)'
                      : '1px solid transparent',
                    color: isActive ? '#eef2ff' : '#94a3b8',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span style={{ color: isActive ? '#818cf8' : '#64748b', display: 'flex', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.84rem', fontWeight: isActive ? 600 : 500, lineHeight: 1.2 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: '0.69rem', color: isActive ? '#a5b4fc' : '#64748b', marginTop: '2px' }}>
                      {item.subtitle}
                    </div>
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* Admin Identity Footer */}
          <div
            style={{
              padding: '12px 14px',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: '#090c14',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '8px',
                    backgroundColor: '#4f46e5',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}
                >
                  {getInitials(admin.name)}
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
                    {admin.name}
                  </div>
                  <div
                    style={{
                      fontSize: '0.7rem',
                      color: '#a5b4fc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatRoleLabel(admin.role)}
                  </div>
                </div>
              </div>

              <button
                onClick={handleLogout}
                title="Sign out"
                style={{
                  padding: '6px',
                  borderRadius: '6px',
                  color: '#64748b',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
          {/* Top Header */}
          <header
            style={{
              height: '58px',
              flexShrink: 0,
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              backgroundColor: 'rgba(15, 20, 34, 0.85)',
              backdropFilter: 'blur(12px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 20px',
              gap: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
              <button
                onClick={() => setIsSidebarOpen((prev) => !prev)}
                aria-label="Toggle admin sidebar"
                style={{
                  padding: '7px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" x2="21" y1="6" y2="6" />
                  <line x1="3" x2="21" y1="12" y2="12" />
                  <line x1="3" x2="21" y1="18" y2="18" />
                </svg>
              </button>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 500 }}>
                    Admin
                  </span>
                  <span style={{ color: '#475569' }}>/</span>
                  <span
                    style={{
                      fontSize: '0.92rem',
                      fontWeight: 600,
                      color: '#f8fafc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {currentNav.label}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span
                className="hidden sm:inline-flex"
                style={{
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.28)',
                  color: '#6ee7b7',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '999px',
                    backgroundColor: '#10b981',
                  }}
                />
                Server RBAC Enforced
              </span>

              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '999px',
                  backgroundColor: 'rgba(99, 102, 241, 0.14)',
                  border: '1px solid rgba(99, 102, 241, 0.28)',
                  color: '#c7d2fe',
                  fontSize: '0.72rem',
                  fontWeight: 600,
                }}
              >
                {formatRoleLabel(admin.role)}
              </span>
            </div>
          </header>

          {/* Page Content */}
          <main
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '24px',
            }}
          >
            <div style={{ maxWidth: '1240px', margin: '0 auto' }}>
              {children}
            </div>
          </main>
        </div>
      </div>

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onLoginSuccess={handleLoginSuccess}
      />
    </AdminSessionContext.Provider>
  );
}

