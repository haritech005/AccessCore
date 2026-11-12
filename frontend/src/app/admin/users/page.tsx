'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminGroupItem,
  AdminRoleDefinition,
  AdminTenantItem,
  AdminUserItem,
  fetchAdminGroups,
  fetchAdminRoles,
  fetchAdminTenants,
  fetchAdminUsers,
} from '@/lib/api';
import { UserCreateModal } from '@/components/admin/UserCreateModal';
import { UserDetailModal } from '@/components/admin/UserDetailModal';

function formatLabel(val: string): string {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getStatusPillStyle(status: string): React.CSSProperties {
  if (status === 'active') {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.14)',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      color: '#6ee7b7',
    };
  }
  if (status === 'suspended') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.14)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      color: '#fca5a5',
    };
  }
  return {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    color: '#cbd5e1',
  };
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 20;

  const [roles, setRoles] = useState<AdminRoleDefinition[]>([]);
  const [groups, setGroups] = useState<AdminGroupItem[]>([]);
  const [tenants, setTenants] = useState<AdminTenantItem[]>([]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [inspectState, setInspectState] = useState<{
    userId: string | null;
    tab: 'edit' | 'effective';
  }>({ userId: null, tab: 'edit' });

  const loadMetadata = useCallback(async () => {
    const [rRes, gRes, tRes] = await Promise.all([
      fetchAdminRoles(),
      fetchAdminGroups(),
      fetchAdminTenants(),
    ]);
    if (rRes.data) setRoles(rRes.data.roles);
    if (gRes.data) setGroups(gRes.data.groups);
    if (tRes.data) setTenants(tRes.data.tenants);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchAdminUsers({
      search: search.trim() || undefined,
      role: roleFilter,
      status: statusFilter,
      user_type: typeFilter,
      page,
      limit,
    });
    setLoading(false);
    if (!res.data) {
      setError(res.error || 'Failed to load user directory.');
      return;
    }
    setUsers(res.data.users);
    setTotal(res.data.total);
  }, [search, roleFilter, statusFilter, typeFilter, page]);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const controlStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: '8px',
    backgroundColor: '#0f1422',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#f1f5f9',
    fontSize: '0.83rem',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Users &amp; Account Status
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '4px 0 0' }}>
            Manage directory principals, roles, security groups, tenant scopes, and inspect effective document access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          style={{
            padding: '9px 16px',
            borderRadius: '8px',
            backgroundColor: '#6366f1',
            border: 'none',
            color: '#ffffff',
            fontSize: '0.84rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + Create User
        </button>
      </div>

      {/* Filters */}
      <div
        style={{
          backgroundColor: '#111624',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '14px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '10px',
          alignItems: 'center',
        }}
      >
        <input
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search name, email, or user ID..."
          style={{ ...controlStyle, flex: '1 1 220px' }}
        />

        <select
          value={typeFilter}
          onChange={(e) => {
            setPage(1);
            setTypeFilter(e.target.value);
          }}
          style={controlStyle}
        >
          <option value="all">All Account Types</option>
          <option value="employee">Employees</option>
          <option value="customer_user">Customer Users</option>
        </select>

        <select
          value={roleFilter}
          onChange={(e) => {
            setPage(1);
            setRoleFilter(e.target.value);
          }}
          style={controlStyle}
        >
          <option value="all">All Roles</option>
          {roles.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value);
          }}
          style={controlStyle}
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="suspended">Suspended</option>
        </select>

        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginLeft: 'auto' }}>
          {total} {total === 1 ? 'account' : 'accounts'}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fca5a5',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      {/* Users Table */}
      <div
        style={{
          backgroundColor: '#111624',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontSize: '0.86rem' }}>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b', fontSize: '0.86rem' }}>
            No user accounts matched your filters.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#0c101a', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '11px 14px', fontWeight: 600 }}>User</th>
                  <th style={{ padding: '11px 14px', fontWeight: 600 }}>Role &amp; Type</th>
                  <th style={{ padding: '11px 14px', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '11px 14px', fontWeight: 600 }}>Groups</th>
                  <th style={{ padding: '11px 14px', fontWeight: 600 }}>Tenant Scope</th>
                  <th style={{ padding: '11px 14px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isAdmin = u.role === 'admin' || u.role === 'it_security_admin';
                  return (
                    <tr key={u.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontWeight: 600, color: '#f8fafc' }}>{u.name}</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{u.email}</div>
                        <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: '#64748b', marginTop: '2px' }}>{u.id}</div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            fontSize: '0.73rem',
                            fontWeight: 600,
                            backgroundColor: isAdmin ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255, 255, 255, 0.05)',
                            border: isAdmin ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid rgba(255, 255, 255, 0.1)',
                            color: isAdmin ? '#c7d2fe' : '#cbd5e1',
                          }}
                        >
                          {formatLabel(u.role)}
                        </span>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>
                          {u.user_type === 'customer_user' ? 'Customer' : 'Employee'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <span
                          style={{
                            ...getStatusPillStyle(u.status),
                            display: 'inline-block',
                            padding: '2px 9px',
                            borderRadius: '999px',
                            fontSize: '0.73rem',
                            fontWeight: 600,
                            textTransform: 'capitalize',
                          }}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', maxWidth: '220px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {u.groups.length === 0 ? (
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>None</span>
                          ) : (
                            u.groups.map((g) => (
                              <span
                                key={g}
                                style={{
                                  padding: '2px 6px',
                                  borderRadius: '6px',
                                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                                  border: '1px solid rgba(255, 255, 255, 0.07)',
                                  color: '#cbd5e1',
                                  fontSize: '0.71rem',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {g}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {u.tenant_scope.length === 0 ? (
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>None (Global only)</span>
                          ) : (
                            u.tenant_scope.map((t) => (
                              <span
                                key={t}
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: '6px',
                                  backgroundColor: t === '*' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(99, 102, 241, 0.12)',
                                  border: t === '*' ? '1px solid rgba(245, 158, 11, 0.35)' : '1px solid rgba(99, 102, 241, 0.25)',
                                  color: t === '*' ? '#fcd34d' : '#a5b4fc',
                                  fontSize: '0.72rem',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {t === '*' ? '* (All)' : t}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setInspectState({ userId: u.id, tab: 'edit' })}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(255, 255, 255, 0.05)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#e2e8f0',
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setInspectState({ userId: u.id, tab: 'effective' })}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              backgroundColor: 'rgba(99, 102, 241, 0.14)',
                              border: '1px solid rgba(99, 102, 241, 0.3)',
                              color: '#c7d2fe',
                              fontSize: '0.76rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            Effective Access
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px', fontSize: '0.82rem', color: '#94a3b8' }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: page <= 1 ? '#475569' : '#e2e8f0',
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
            }}
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: page >= totalPages ? '#475569' : '#e2e8f0',
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
            }}
          >
            Next
          </button>
        </div>
      )}

      <UserCreateModal
        isOpen={createOpen}
        roles={roles}
        groups={groups}
        tenants={tenants}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          void loadUsers();
          void loadMetadata();
        }}
      />

      <UserDetailModal
        userId={inspectState.userId}
        initialTab={inspectState.tab}
        roles={roles}
        groups={groups}
        tenants={tenants}
        onClose={() => setInspectState({ userId: null, tab: 'edit' })}
        onUpdated={() => {
          void loadUsers();
          void loadMetadata();
        }}
      />
    </div>
  );
}
