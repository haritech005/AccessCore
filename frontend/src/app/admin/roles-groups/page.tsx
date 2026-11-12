'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AdminGroupItem,
  AdminRoleDefinition,
  AdminTenantItem,
  AdminUserItem,
  createAdminGroup,
  createAdminTenant,
  fetchAdminGroups,
  fetchAdminRoles,
  fetchAdminTenants,
  fetchAdminUsers,
  updateAdminGroup,
  updateAdminGroupMembers,
  updateAdminTenant,
} from '@/lib/api';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';

const SENSITIVE_GROUPS = new Set([
  'grp_security_restricted',
  'grp_incident_review',
  'grp_it_security',
]);

function isCustomerGroup(groupId: string): boolean {
  return groupId === 'grp_public' || groupId.startsWith('cust_');
}

export default function AdminRolesGroupsPage() {
  const [activeTab, setActiveTab] = useState<'roles' | 'groups' | 'tenants'>('roles');
  const [roles, setRoles] = useState<AdminRoleDefinition[]>([]);
  const [groups, setGroups] = useState<AdminGroupItem[]>([]);
  const [tenants, setTenants] = useState<AdminTenantItem[]>([]);
  const [allUsers, setAllUsers] = useState<AdminUserItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Create Group modal
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [newGroupId, setNewGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  // Manage Group Members modal
  const [editingGroup, setEditingGroup] = useState<AdminGroupItem | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDesc, setEditGroupDesc] = useState('');
  const [confirmMembersOpen, setConfirmMembersOpen] = useState(false);

  // Create Tenant modal
  const [tenantModalOpen, setTenantModalOpen] = useState(false);
  const [newTenantId, setNewTenantId] = useState('');
  const [newTenantName, setNewTenantName] = useState('');

  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [rRes, gRes, tRes, uRes] = await Promise.all([
      fetchAdminRoles(),
      fetchAdminGroups(),
      fetchAdminTenants(),
      fetchAdminUsers({ limit: 100 }),
    ]);
    setLoading(false);

    if (rRes.error || gRes.error || tRes.error) {
      setError(rRes.error || gRes.error || tRes.error || 'Failed to load access policies.');
      return;
    }

    if (rRes.data) setRoles(rRes.data.roles);
    if (gRes.data) setGroups(gRes.data.groups);
    if (tRes.data) setTenants(tRes.data.tenants);
    if (uRes.data) setAllUsers(uRes.data.users);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await createAdminGroup({
      id: newGroupId.trim(),
      name: newGroupName.trim(),
      description: newGroupDesc.trim() || undefined,
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setGroupModalOpen(false);
    setNewGroupId('');
    setNewGroupName('');
    setNewGroupDesc('');
    setBanner(`Created security group '${res.data?.group.id}'.`);
    await loadAll();
  };

  const openManageGroup = (grp: AdminGroupItem) => {
    setEditingGroup(grp);
    setEditGroupName(grp.name);
    setEditGroupDesc(grp.description || '');
    setSelectedMemberIds(grp.members.map((m) => m.id));
    setMemberSearch('');
    setError(null);
  };

  const saveGroupAndMembers = async () => {
    if (!editingGroup) return;
    setConfirmMembersOpen(false);
    setSaving(true);
    setError(null);

    const metaRes = await updateAdminGroup(editingGroup.id, {
      name: editGroupName.trim(),
      description: editGroupDesc.trim(),
    });
    if (metaRes.error) {
      setSaving(false);
      setError(metaRes.error);
      return;
    }

    const memRes = await updateAdminGroupMembers(editingGroup.id, selectedMemberIds);
    setSaving(false);
    if (memRes.error) {
      setError(memRes.error);
      return;
    }

    setBanner(`Updated group '${editingGroup.id}' (${selectedMemberIds.length} members).`);
    setEditingGroup(null);
    await loadAll();
  };

  const handleSaveGroupSubmit = () => {
    if (!editingGroup) return;
    if (SENSITIVE_GROUPS.has(editingGroup.id)) {
      setConfirmMembersOpen(true);
      return;
    }
    void saveGroupAndMembers();
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await createAdminTenant({
      id: newTenantId.trim(),
      name: newTenantName.trim(),
      status: 'active',
    });
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setTenantModalOpen(false);
    setNewTenantId('');
    setNewTenantName('');
    setBanner(`Created tenant '${res.data?.tenant.id}'.`);
    await loadAll();
  };

  const handleTenantStatusChange = async (
    tenantId: string,
    status: 'active' | 'suspended' | 'archived'
  ) => {
    setError(null);
    const res = await updateAdminTenant(tenantId, { status });
    if (res.error) {
      setError(res.error);
      return;
    }
    setBanner(`Updated tenant '${tenantId}' status to '${status}'.`);
    await loadAll();
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#111624',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    padding: '18px 20px',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            Roles, Groups &amp; Tenant Scope
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: '4px 0 0' }}>
            Inspect explicit RBAC role boundaries, manage group memberships, and administer customer tenant boundaries.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {activeTab === 'groups' && (
            <button
              type="button"
              onClick={() => setGroupModalOpen(true)}
              style={{
                padding: '9px 15px',
                borderRadius: '8px',
                backgroundColor: '#6366f1',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.83rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Create Group
            </button>
          )}
          {activeTab === 'tenants' && (
            <button
              type="button"
              onClick={() => setTenantModalOpen(true)}
              style={{
                padding: '9px 15px',
                borderRadius: '8px',
                backgroundColor: '#6366f1',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.83rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Create Tenant
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {[
          { key: 'roles', label: `Roles & Permissions (${roles.length})` },
          { key: 'groups', label: `Security Groups (${groups.length})` },
          { key: 'tenants', label: `Tenants (${tenants.length})` },
        ].map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key as 'roles' | 'groups' | 'tenants')}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.83rem',
                fontWeight: 600,
                cursor: 'pointer',
                backgroundColor: active ? 'rgba(99, 102, 241, 0.18)' : 'rgba(255, 255, 255, 0.03)',
                border: active ? '1px solid rgba(99, 102, 241, 0.42)' : '1px solid rgba(255, 255, 255, 0.08)',
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
            padding: '12px 16px',
            borderRadius: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            color: '#fca5a5',
            fontSize: '0.84rem',
          }}
        >
          {error}
        </div>
      )}

      {banner && (
        <div
          style={{
            padding: '11px 15px',
            borderRadius: '10px',
            backgroundColor: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#6ee7b7',
            fontSize: '0.83rem',
          }}
        >
          {banner}
        </div>
      )}

      {loading ? (
        <div style={{ ...cardStyle, textAlign: 'center', color: '#94a3b8', padding: '28px' }}>
          Loading roles, groups, and tenant policies...
        </div>
      ) : activeTab === 'roles' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '14px' }}>
          {roles.map((r) => (
            <div key={r.role} style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>{r.label}</h2>
                  <div style={{ fontSize: '0.73rem', fontFamily: 'monospace', color: '#818cf8', marginTop: '2px' }}>
                    {r.role} · {r.user_type}
                  </div>
                </div>
                <span
                  style={{
                    padding: '3px 9px',
                    borderRadius: '999px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    backgroundColor: r.is_admin ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255, 255, 255, 0.05)',
                    border: r.is_admin ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid rgba(255, 255, 255, 0.09)',
                    color: r.is_admin ? '#c7d2fe' : '#cbd5e1',
                  }}
                >
                  {r.active_user_count} active
                </span>
              </div>

              <p style={{ fontSize: '0.81rem', color: '#cbd5e1', lineHeight: 1.5, margin: '10px 0 12px' }}>
                {r.description}
              </p>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                {r.capabilities.map((cap) => (
                  <span
                    key={cap}
                    style={{
                      padding: '2px 7px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      color: '#a5b4fc',
                      fontSize: '0.71rem',
                      fontFamily: 'monospace',
                    }}
                  >
                    {cap}
                  </span>
                ))}
              </div>

              <div
                style={{
                  padding: '9px 11px',
                  borderRadius: '8px',
                  backgroundColor: '#0a0d14',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '0.76rem',
                  color: '#94a3b8',
                  lineHeight: 1.45,
                }}
              >
                <strong style={{ color: '#e2e8f0' }}>Boundary:</strong> {r.boundary_note}
              </div>
            </div>
          ))}
        </div>
      ) : activeTab === 'groups' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '14px' }}>
          {groups.map((grp) => {
            const sensitive = SENSITIVE_GROUPS.has(grp.id);
            return (
              <div key={grp.id} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>{grp.name}</h2>
                      {sensitive && (
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: '999px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            backgroundColor: 'rgba(245, 158, 11, 0.14)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
                            color: '#fcd34d',
                          }}
                        >
                          Clearance
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.74rem', fontFamily: 'monospace', color: '#818cf8', marginTop: '2px' }}>
                      {grp.id}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openManageGroup(grp)}
                    style={{
                      padding: '6px 11px',
                      borderRadius: '7px',
                      backgroundColor: 'rgba(99, 102, 241, 0.14)',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      color: '#c7d2fe',
                      fontSize: '0.76rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Manage ({grp.member_count})
                  </button>
                </div>

                <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: '10px 0 12px', lineHeight: 1.45 }}>
                  {grp.description || 'No description provided.'}
                </p>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                  {grp.members.length === 0 ? (
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>No assigned members</span>
                  ) : (
                    grp.members.slice(0, 6).map((m) => (
                      <span
                        key={m.id}
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          backgroundColor: '#0a0d14',
                          border: '1px solid rgba(255, 255, 255, 0.07)',
                          fontSize: '0.72rem',
                          color: '#cbd5e1',
                        }}
                      >
                        {m.name}
                      </span>
                    ))
                  )}
                  {grp.members.length > 6 && (
                    <span style={{ fontSize: '0.72rem', color: '#64748b', padding: '2px 4px' }}>
                      +{grp.members.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ backgroundColor: '#0c101a', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '12px 16px' }}>Tenant ID</th>
                  <th style={{ padding: '12px 16px' }}>Organization Name</th>
                  <th style={{ padding: '12px 16px' }}>Users Scoped</th>
                  <th style={{ padding: '12px 16px' }}>Documents</th>
                  <th style={{ padding: '12px 16px' }}>Lifecycle Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#a5b4fc' }}>{t.id}</td>
                    <td style={{ padding: '12px 16px', color: '#f8fafc', fontWeight: 600 }}>{t.name}</td>
                    <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{t.user_count}</td>
                    <td style={{ padding: '12px 16px', color: '#cbd5e1' }}>{t.document_count}</td>
                    <td style={{ padding: '12px 16px' }}>
                      {t.id === 'global' ? (
                        <span style={{ fontSize: '0.76rem', color: '#6ee7b7', fontWeight: 600 }}>
                          active (system root)
                        </span>
                      ) : (
                        <select
                          value={t.status}
                          onChange={(e) =>
                            void handleTenantStatusChange(
                              t.id,
                              e.target.value as 'active' | 'suspended' | 'archived'
                            )
                          }
                          style={{
                            padding: '5px 9px',
                            borderRadius: '7px',
                            backgroundColor: '#0a0d14',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            color: '#e2e8f0',
                            fontSize: '0.78rem',
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="archived">Archived</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {groupModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: 'rgba(6, 9, 16, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '460px', backgroundColor: '#0f1422', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '14px', padding: '24px' }}>
            <h2 style={{ margin: '0 0 14px', fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
              Create Security Group
            </h2>
            <form onSubmit={handleCreateGroup} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Group Slug ID *
                </label>
                <input
                  required
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  placeholder="e.g. grp_compliance"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Display Name *
                </label>
                <input
                  required
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Security Compliance"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Description
                </label>
                <input
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Purpose and access scope"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setGroupModalOpen(false)}
                  style={{ padding: '8px 14px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#cbd5e1', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '8px', backgroundColor: '#6366f1', border: 'none', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
                >
                  {saving ? 'Creating...' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Group Members Modal */}
      {editingGroup && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: 'rgba(6, 9, 16, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '580px', maxHeight: '88vh', overflowY: 'auto', backgroundColor: '#0f1422', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '14px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <div style={{ fontSize: '0.73rem', fontFamily: 'monospace', color: '#818cf8' }}>{editingGroup.id}</div>
                <h2 style={{ margin: '2px 0 0', fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
                  Manage Group &amp; Members
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditingGroup(null)}
                style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
              <input value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} style={inputStyle} placeholder="Group name" />
              <input value={editGroupDesc} onChange={(e) => setEditGroupDesc(e.target.value)} style={inputStyle} placeholder="Group description" />
            </div>

            <div style={{ marginBottom: '10px' }}>
              <input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Filter users by name or email..."
                style={inputStyle}
              />
            </div>

            <div
              style={{
                maxHeight: '240px',
                overflowY: 'auto',
                padding: '10px',
                borderRadius: '8px',
                backgroundColor: '#0a0d14',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                marginBottom: '16px',
              }}
            >
              {allUsers
                .filter((u) => {
                  const q = memberSearch.trim().toLowerCase();
                  if (!q) return true;
                  return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
                })
                .map((u) => {
                  const blockedCustomer =
                    u.user_type === 'customer_user' && !isCustomerGroup(editingGroup.id);
                  const checked = selectedMemberIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        padding: '6px 8px',
                        borderRadius: '6px',
                        backgroundColor: checked ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                        color: blockedCustomer ? '#475569' : '#e2e8f0',
                        fontSize: '0.81rem',
                        cursor: blockedCustomer ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={blockedCustomer}
                          onChange={() =>
                            setSelectedMemberIds((prev) =>
                              prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                            )
                          }
                        />
                        <span>
                          <strong>{u.name}</strong> <span style={{ color: '#64748b' }}>({u.role})</span>
                        </span>
                      </div>
                      {blockedCustomer && (
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>Customer blocked</span>
                      )}
                    </label>
                  );
                })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setEditingGroup(null)}
                style={{ padding: '8px 14px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#cbd5e1', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveGroupSubmit}
                style={{ padding: '8px 16px', borderRadius: '8px', backgroundColor: '#6366f1', border: 'none', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
              >
                {saving ? 'Saving...' : 'Save Group Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Tenant Modal */}
      {tenantModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            backgroundColor: 'rgba(6, 9, 16, 0.78)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div style={{ width: '100%', maxWidth: '460px', backgroundColor: '#0f1422', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '14px', padding: '24px' }}>
            <h2 style={{ margin: '0 0 14px', fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
              Create Tenant Boundary
            </h2>
            <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Tenant ID * (must start with ten_)
                </label>
                <input
                  required
                  value={newTenantId}
                  onChange={(e) => setNewTenantId(e.target.value)}
                  placeholder="e.g. ten_northstar"
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', marginBottom: '5px', fontWeight: 600 }}>
                  Organization Name *
                </label>
                <input
                  required
                  value={newTenantName}
                  onChange={(e) => setNewTenantName(e.target.value)}
                  placeholder="e.g. Northstar Health"
                  style={inputStyle}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setTenantModalOpen(false)}
                  style={{ padding: '8px 14px', borderRadius: '8px', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#cbd5e1', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ padding: '8px 16px', borderRadius: '8px', backgroundColor: '#6366f1', border: 'none', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
                >
                  {saving ? 'Creating...' : 'Create Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmMembersOpen}
        title="Confirm Security Group Membership Change"
        description={`Updating membership of '${editingGroup?.id}' affects restricted clearance or administrative access boundaries.`}
        implications={[
          `Members assigned to '${editingGroup?.id}' (${selectedMemberIds.length} selected) will immediately inherit or lose access to protected materials.`,
          'This change is recorded in the administrative audit log.',
        ]}
        confirmLabel="Save Security Group"
        tone="warning"
        busy={saving}
        onCancel={() => setConfirmMembersOpen(false)}
        onConfirm={saveGroupAndMembers}
      />
    </div>
  );
}
