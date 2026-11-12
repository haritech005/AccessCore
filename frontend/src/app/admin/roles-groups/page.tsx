'use client';

import React from 'react';
import { AdminSectionFoundation } from '@/components/admin/AdminSectionFoundation';

export default function AdminRolesGroupsPage() {
  return (
    <AdminSectionFoundation
      title="Roles, Groups & Tenant Scope"
      description="Govern RBAC security groups, tenant boundaries, and access matrix inspection."
      capabilityKey="can_manage_roles"
      plannedCapabilities={[
        'Create and manage security groups and assign directory members',
        'Configure customer tenant scopes and inspect isolated boundaries',
        'Review effective permission matrix across employee and customer personas',
        'Strict separation between IT security administration and customer ticket read scopes',
      ]}
      protectedEndpoints={[
        'GET /api/admin/groups',
        'POST /api/admin/groups',
        'PUT /api/admin/groups/:id/members',
        'GET /api/admin/tenants',
      ]}
    />
  );
}

