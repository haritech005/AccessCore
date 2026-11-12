'use client';

import React, { useEffect, useState } from 'react';
import {
  AdminEffectiveAccess,
  AdminGroupItem,
  AdminRoleDefinition,
  AdminTenantItem,
  AdminUserItem,
  fetchAdminUserDetail,
  resetAdminUserPassword,
  updateAdminUser,
} from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface UserDetailModalProps {
  userId: string | null;
  initialTab?: 'edit' | 'effective';
  roles: AdminRoleDefinition[];
  groups: AdminGroupItem[];
  tenants: AdminTenantItem[];
  onClose: () => void;
  onUpdated: (user: AdminUserItem) => void;
}

const SENSITIVE_GROUPS = new Set([
  'grp_security_restricted',
  'grp_incident_review',
  'grp_it_security',
]);

export function UserDetailModal({
  userId,
  initialTab = 'edit',
  roles,
  groups,
  tenants,
  onClose,
  onUpdated,
}: UserDetailModalProps) {
  const [tab, setTab] = useState<'edit' | 'effective'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<AdminUserItem | null>(null);
  const [effectiveAccess, setEffectiveAccess] = useState<AdminEffectiveAccess | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [userType, setUserType] = useState<'employee' | 'customer_user'>('employee');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended'>('active');
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);

  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    mode: 'save' | 'resetPassword';
    implications: string[];
  }>({ open: false, mode: 'save', implications: [] });

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    setNewPassword('');

    void fetchAdminUserDetail(userId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.data) {
        setError(res.error || 'Failed to load user details.');
        return;
      }
      const u = res.data.user;
      setUser(u);
      setEffectiveAccess(res.data.effective_access);
      setName(u.name);
      setEmail(u.email);
      setUserType(u.user_type);
      setRole(u.role);
      setStatus(u.status);
      setSelectedGroups(u.groups || []);
      setSelectedTenants(u.tenant_scope || []);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  const availableRoles = roles.filter((r) => r.user_type === userType);

  const handleUserTypeChange = (nextType: 'employee' | 'customer_user') => {
    setUserType(nextType);
    if (nextType === 'customer_user') {
      setRole('customer_user');
      setSelectedGroups((prev) =>
        prev.filter((g) => g === 'grp_public' || g.startsWith('cust_'))
      );
      setSelectedTenants((prev) => {
        const firstCustomer = prev.find((t) => t !== '*' && t !== 'global');
        return firstCustomer ? [firstCustomer] : [];
      });
    } else if (role === 'customer_user') {
      setRole('support_agent');
    }
  };

  const toggleGroup = (groupId: string) => {
    setSelectedGroups((prev) =>
      prev.includes(groupId) ? prev.filter((g) => g !== groupId) : [...prev, groupId]
    );
  };

  const toggleTenant = (tenantId: string) => {
    if (userType === 'customer_user') {
      setSelectedTenants([tenantId]);
      return;
    }
    setSelectedTenants((prev) => {
      if (tenantId === '*') {
        return prev.includes('*') ? [] : ['*'];
      }
      const withoutWildcard = prev.filter((t) => t !== '*');
      return withoutWildcard.includes(tenantId)
        ? withoutWildcard.filter((t) => t !== tenantId)
        : [...withoutWildcard, tenantId];
    });
  };

  const computeSaveImplications = (): string[] => {
    if (!user) return [];
    const imps: string[] = [];
    if (status !== user.status && status !== 'active') {
      imps.push(`Changing status from '${user.status}' to '${status}' blocks login and revokes API access immediately.`);
    }
    if (role !== user.role) {
      imps.push(`Changing role from '${user.role}' to '${role}' alters user authorization capabilities.`);
    }
    if (userType !== user.user_type) {
      imps.push(`Switching account type from '${user.user_type}' to '${userType}'.`);
    }
    const addedSensitive = selectedGroups.filter(
      (g) => SENSITIVE_GROUPS.has(g) && !user.groups.includes(g)
    );
    if (addedSensitive.length > 0) {
      imps.push(`Adding high-sensitivity security group(s): ${addedSensitive.join(', ')}.`);
    }
    if (selectedTenants.includes('*') && !user.tenant_scope.includes('*')) {
      imps.push('Granting wildcard (*) tenant scope across all customer organizations.');
    }
    return imps;
  };

  const executeSave = async () => {
    if (!user) return;
    setConfirmState({ open: false, mode: 'save', implications: [] });
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const res = await updateAdminUser(user.id, {
      name: name.trim(),
      email: email.trim(),
      user_type: userType,
      role,
      status,
      groups: selectedGroups,
      tenant_scope: selectedTenants,
    });

    setSaving(false);

    if (!res.data) {
      setError(res.error || 'Failed to update user.');
      return;
    }

    setUser(res.data.user);
    setEffectiveAccess(res.data.effective_access);
    setSuccessMsg('Account and permissions saved cleanly.');
    onUpdated(res.data.user);
  };

  const handleSaveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const implications = computeSaveImplications();
    if (implications.length > 0) {
      setConfirmState({ open: true, mode: 'save', implications });
      return;
    }
    void executeSave();
  };

  const executePasswordReset = async () => {
    if (!user) return;
    setConfirmState({ open: false, mode: 'resetPassword', implications: [] });
    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    const res = await resetAdminUserPassword(user.id, newPassword);
    setSaving(false);

    if (res.error) {
      setError(res.error);
      return;
    }
    setNewPassword('');
    setSuccessMsg('Password updated and audit-logged cleanly.');
  };

  const handlePasswordResetClick = () => {
    setError(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    setConfirmState({
      open: true,
      mode: 'resetPassword',
      implications: [
        `Replaces the bcrypt password hash for '${email}'.`,
        'Audit event admin.user.password_reset will be recorded without storing the secret.',
      ],
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: '8px',
    backgroundColor: '#0a0d14',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: '#f8fafc',
    fontSize: '0.84rem',
  };

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 70,
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
            maxWidth: '760px',
            maxHeight: '90vh',
            overflowY: 'auto',
            backgroundColor: '#0f1422',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            padding: '24px',
          }}
        >
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: '#818cf8' }}>
                {userId}
              </div>
              <h2 style={{ margin: '2px 0 0', fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc' }}>
                {user?.name || 'Loading user...'}
              </h2>
              {user && (
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  {user.email}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '12px', marginBottom: '16px' }}>
            {[
              { key: 'edit', label: 'Account, Role & Groups' },
              { key: 'effective', label: 'Effective Access Inspector' },
            ].map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key as 'edit' | 'effective')}
                  style={{
                    padding: '7px 14px',
                    borderRadius: '8px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backgroundColor: active ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                    border: active ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.08)',
                    color: active ? '#e0e7ff' : '#94a3b8',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {error && (
            <div
              style={{
                padding: '11px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: '0.83rem',
                marginBottom: '14px',
              }}
            >
              {error}
            </div>
          )}

          {successMsg && (
            <div
              style={{
                padding: '11px 14px',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
                color: '#6ee7b7',
                fontSize: '0.83rem',
                marginBottom: '14px',
              }}
            >
              {successMsg}
            </div>
          )}

          {loading ? (
            <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: '0.86rem' }}>
              Loading account details and effective policy evaluations...
            </div>
          ) : tab === 'edit' && user ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <form onSubmit={handleSaveSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                      Full Name
                    </label>
                    <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} required />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                      Email Address
                    </label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} required />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                      Account Type
                    </label>
                    <select
                      value={userType}
                      onChange={(e) => handleUserTypeChange(e.target.value as 'employee' | 'customer_user')}
                      style={inputStyle}
                    >
                      <option value="employee">Employee</option>
                      <option value="customer_user">Customer User</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                      Role
                    </label>
                    <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                      {availableRoles.map((r) => (
                        <option key={r.role} value={r.role}>
                          {r.label} ({r.role})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                      Account Status
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as 'active' | 'inactive' | 'suspended')}
                      style={inputStyle}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>

                {/* Tenant Scope */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                    Tenant Scope {userType === 'customer_user' ? '(Single customer tenant required)' : ''}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {userType === 'employee' && (
                      <button
                        type="button"
                        onClick={() => toggleTenant('*')}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '7px',
                          fontSize: '0.78rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          backgroundColor: selectedTenants.includes('*')
                            ? 'rgba(245, 158, 11, 0.18)'
                            : 'rgba(255, 255, 255, 0.04)',
                          border: selectedTenants.includes('*')
                            ? '1px solid rgba(245, 158, 11, 0.45)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
                          color: selectedTenants.includes('*') ? '#fcd34d' : '#94a3b8',
                        }}
                      >
                        * All Tenants
                      </button>
                    )}
                    {tenants
                      .filter((t) => t.id !== 'global')
                      .map((t) => {
                        const active = selectedTenants.includes(t.id);
                        return (
                          <button
                            type="button"
                            key={t.id}
                            onClick={() => toggleTenant(t.id)}
                            style={{
                              padding: '6px 10px',
                              borderRadius: '7px',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              backgroundColor: active ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                              border: active ? '1px solid rgba(99, 102, 241, 0.45)' : '1px solid rgba(255, 255, 255, 0.08)',
                              color: active ? '#c7d2fe' : '#94a3b8',
                            }}
                          >
                            {t.name} ({t.id})
                          </button>
                        );
                      })}
                  </div>
                </div>

                {/* Groups */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                    Group Memberships
                  </label>
                  <div
                    style={{
                      maxHeight: '150px',
                      overflowY: 'auto',
                      padding: '10px',
                      borderRadius: '8px',
                      backgroundColor: '#0a0d14',
                      border: '1px solid rgba(255, 255, 255, 0.09)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '6px',
                    }}
                  >
                    {groups.map((grp) => {
                      const allowedForCustomer = grp.id === 'grp_public' || grp.id.startsWith('cust_');
                      const disabled = userType === 'customer_user' && !allowedForCustomer;
                      const checked = selectedGroups.includes(grp.id);
                      return (
                        <label
                          key={grp.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '0.79rem',
                            color: disabled ? '#475569' : SENSITIVE_GROUPS.has(grp.id) ? '#fcd34d' : '#cbd5e1',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleGroup(grp.id)}
                          />
                          <span>
                            {grp.name} <span style={{ color: '#64748b' }}>({grp.id})</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                  <button
                    type="submit"
                    disabled={saving}
                    style={{
                      padding: '9px 18px',
                      borderRadius: '8px',
                      backgroundColor: '#6366f1',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      cursor: saving ? 'wait' : 'pointer',
                    }}
                  >
                    {saving ? 'Saving...' : 'Save Account Changes'}
                  </button>
                </div>
              </form>

              {/* Password Reset Section */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#f8fafc', marginBottom: '6px' }}>
                  Reset Password
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <input
                    type="password"
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 characters)"
                    style={{ ...inputStyle, flex: '1 1 240px' }}
                  />
                  <button
                    type="button"
                    disabled={saving || !newPassword}
                    onClick={handlePasswordResetClick}
                    style={{
                      padding: '9px 14px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(245, 158, 11, 0.14)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      color: '#fcd34d',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: saving || !newPassword ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Reset Password
                  </button>
                </div>
              </div>
            </div>
          ) : tab === 'effective' && effectiveAccess ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '10px' }}>
                {[
                  { label: 'Account Active', val: effectiveAccess.is_active ? 'Active' : 'Blocked', good: effectiveAccess.is_active },
                  { label: 'Admin Privilege', val: effectiveAccess.is_admin ? 'Administrator' : 'Standard', good: effectiveAccess.is_admin },
                  { label: 'Restricted Clearance', val: effectiveAccess.has_restricted_clearance ? 'Cleared' : 'Denied', good: effectiveAccess.has_restricted_clearance },
                  { label: 'Wildcard Tenancy', val: effectiveAccess.has_wildcard_tenant ? 'Enabled (*)' : 'Scoped', good: effectiveAccess.has_wildcard_tenant },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      backgroundColor: '#0a0d14',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase' }}>{stat.label}</div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: stat.good ? '#6ee7b7' : '#cbd5e1', marginTop: '4px' }}>
                      {stat.val}
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '6px' }}>
                  Effective Readable Tenants ({effectiveAccess.effective_tenants.length})
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {effectiveAccess.effective_tenants.map((t) => (
                    <span
                      key={t.id}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.76rem',
                        backgroundColor: 'rgba(99, 102, 241, 0.14)',
                        border: '1px solid rgba(99, 102, 241, 0.3)',
                        color: '#c7d2fe',
                      }}
                    >
                      {t.name} ({t.id})
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0', marginBottom: '8px' }}>
                  Permitted Active Documents ({effectiveAccess.accessible_documents.length} accessible · {effectiveAccess.denied_summary.total_denied} blocked)
                </div>
                {effectiveAccess.accessible_documents.length === 0 ? (
                  <div style={{ padding: '14px', borderRadius: '8px', backgroundColor: '#0a0d14', color: '#94a3b8', fontSize: '0.82rem' }}>
                    No documents currently accessible under this account&apos;s status, tenant scope, and groups.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.79rem' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#0a0d14', color: '#64748b', textAlign: 'left', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                          <th style={{ padding: '8px 10px' }}>Code</th>
                          <th style={{ padding: '8px 10px' }}>Title</th>
                          <th style={{ padding: '8px 10px' }}>Tenant</th>
                          <th style={{ padding: '8px 10px' }}>Sensitivity</th>
                          <th style={{ padding: '8px 10px' }}>Disclosure</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveAccess.accessible_documents.map((doc) => (
                          <tr key={doc.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#a5b4fc' }}>{doc.document_id}</td>
                            <td style={{ padding: '8px 10px', color: '#f1f5f9' }}>{doc.title}</td>
                            <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{doc.tenant_id}</td>
                            <td style={{ padding: '8px 10px', color: '#cbd5e1' }}>{doc.sensitivity}</td>
                            <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{doc.disclosure_policy}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmState.open}
        title={
          confirmState.mode === 'resetPassword'
            ? 'Confirm Password Reset'
            : 'Confirm High-Impact Account Update'
        }
        description={
          confirmState.mode === 'resetPassword'
            ? `Resetting password for ${email}.`
            : `Please review the security implications of these changes to ${email}.`
        }
        implications={confirmState.implications}
        confirmLabel={confirmState.mode === 'resetPassword' ? 'Reset Password' : 'Apply Changes'}
        tone={confirmState.mode === 'resetPassword' ? 'warning' : 'danger'}
        busy={saving}
        onCancel={() => setConfirmState({ open: false, mode: 'save', implications: [] })}
        onConfirm={() => {
          if (confirmState.mode === 'resetPassword') {
            void executePasswordReset();
          } else {
            void executeSave();
          }
        }}
      />
    </>
  );
}

