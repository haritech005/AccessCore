'use client';

import React from 'react';
import { AdminSectionFoundation } from '@/components/admin/AdminSectionFoundation';

export default function AdminUsersPage() {
  return (
    <AdminSectionFoundation
      title="Users & Account Status"
      description="Create employee or customer accounts, assign roles, update group/tenant memberships, and toggle active status."
      capabilityKey="can_manage_users"
      plannedCapabilities={[
        'Inspect directory users with role, department, group, and tenant scope badges',
        'Create user accounts with bcrypt password hashing and automatic permission mapping',
        'Update roles, active/disabled account flags, and trigger password resets',
        'Audit-logged mutations with self-lockout and privilege-escalation prevention',
      ]}
      protectedEndpoints={[
        'GET /api/admin/users',
        'POST /api/admin/users',
        'PATCH /api/admin/users/:id',
        'POST /api/admin/users/:id/reset-password',
      ]}
    />
  );
}

