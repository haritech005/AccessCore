'use client';

import React, { useState } from 'react';
import {
  AdminGroupItem,
  AdminRoleDefinition,
  AdminTenantItem,
  AdminUserItem,
  createAdminUser,
} from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';

interface UserCreateModalProps {
  isOpen: boolean;
  roles: AdminRoleDefinition[];
  groups: AdminGroupItem[];
  tenants: AdminTenantItem[];
  onClose: () => void;
  onCreated: (user: AdminUserItem) => void;
}

const SENSITIVE_GROUPS = new Set([
  'grp_security_restricted',
  'grp_incident_review',
  'grp_it_security',
]);

export function UserCreateModal({
  isOpen,
  roles,
  groups,
  tenants,
  onClose,
  onCreated,
}: UserCreateModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [customId, setCustomId] = useState('');
  const [userType, setUserType] = useState<'employee' | 'customer_user'>('employee');
  const [role, setRole] = useState('support_agent');
  const [status, setStatus] = useState<'active' | 'inactive' | 'suspended'>('active');
  const [password, setPassword] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<string[]>(['grp_all_employees']);
  const [selectedTenants, setSelectedTenants] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!isOpen) return null;

  const availableRoles = roles.filter((r) => r.user_type === userType);
  const isHighPrivilege =
    userType === 'employee' &&
    (role === 'admin' ||
      role === 'it_security_admin' ||
      selectedTenants.includes('*') ||
      selectedGroups.some((g) => SENSITIVE_GROUPS.has(g)));

  const handleUserTypeChange = (nextType: 'employee' | 'customer_user') => {
    setUserType(nextType);
    setError(null);
    if (nextType === 'customer_user') {
      setRole('customer_user');
      setSelectedGroups((prev) =>
        prev.filter((g) => g === 'grp_public' || g.startsWith('cust_'))
      );
      setSelectedTenants((prev) => {
        const firstCustomerTen = prev.find((t) => t !== '*' && t !== 'global');
        return firstCustomerTen ? [firstCustomerTen] : [];
      });
    } else {
      setRole('support_agent');
      setSelectedGroups(['grp_all_employees']);
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

  const executeCreate = async () => {
    setConfirmOpen(false);
    setSubmitting(true);
    setError(null);

    const res = await createAdminUser({
      id: customId.trim() || undefined,
      name: name.trim(),
      email: email.trim(),
      user_type: userType,
      role,
      status,
      password,
      groups: selectedGroups,
      tenant_scope: selectedTenants,
    });

    setSubmitting(false);

    if (!res.data?.user) {
      setError(res.error || 'Failed to create user.');
      return;
    }

    onCreated(res.data.user);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isHighPrivilege) {
      setConfirmOpen(true);
      return;
    }
    void executeCreate();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 12px',
    borderRadius: '8px',
    backgroundColor: '#0a0d14',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    color: '#f8fafc',
    fontSize: '0.85rem',
  };

  const implications: string[] = [];
  if (role === 'admin' || role === 'it_security_admin') {
    implications.push(`Grants full Admin Console management access (${role}).`);
  }
  if (selectedTenants.includes('*')) {
    implications.push('Grants wildcard (*) tenant access across all customer tenants.');
  }
  const sensitiveSelected = selectedGroups.filter((g) => SENSITIVE_GROUPS.has(g));
  if (sensitiveSelected.length > 0) {
    implications.push(`Assigns restricted/security groups: ${sensitiveSelected.join(', ')}.`);
  }

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
            maxWidth: '640px',
            maxHeight: '90vh',
            overflowY: 'auto',
            backgroundColor: '#0f1422',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '14px',
            padding: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc' }}>
                Create User Account
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
                Passwords are salted &amp; hashed with bcrypt server-side and never displayed again.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
            >
              ✕
            </button>
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
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Full Name *
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jordan Patel"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Email Address *
                </label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jordan.patel@clouddesk.example.com"
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Account Type *
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
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Assigned Role *
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  style={inputStyle}
                >
                  {availableRoles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label} ({r.role})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Initial Status
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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Initial Password (min 8 chars) *
                </label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter initial password"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Custom User ID (optional)
                </label>
                <input
                  value={customId}
                  onChange={(e) => setCustomId(e.target.value)}
                  placeholder="Auto-generated if left blank"
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Tenant Scope */}
            <div>
              <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
                Tenant Scope {userType === 'customer_user' ? '(Select exactly 1 customer tenant)' : '(Optional for employees)'}
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
                    * All Tenants (Wildcard)
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
                          fontWeight: 500,
                          cursor: 'pointer',
                          backgroundColor: active
                            ? 'rgba(99, 102, 241, 0.18)'
                            : 'rgba(255, 255, 255, 0.04)',
                          border: active
                            ? '1px solid rgba(99, 102, 241, 0.45)'
                            : '1px solid rgba(255, 255, 255, 0.08)',
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
              <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '6px', fontWeight: 600 }}>
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '9px 15px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
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
                disabled={submitting}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  backgroundColor: '#6366f1',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting ? 'Creating...' : 'Create Account'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Confirm High-Privilege Account Creation"
        description={`You are creating '${name || email}' with elevated permissions. Review the security implications below before proceeding.`}
        implications={implications}
        confirmLabel="Create Privileged Account"
        tone="warning"
        busy={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={executeCreate}
      />
    </>
  );
}

