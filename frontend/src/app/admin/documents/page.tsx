'use client';

import React from 'react';
import { AdminSectionFoundation } from '@/components/admin/AdminSectionFoundation';

export default function AdminDocumentsPage() {
  return (
    <AdminSectionFoundation
      title="Document Governance"
      description="Control document visibility classifications, tenant owners, group ACL rules, and version history."
      capabilityKey="can_manage_documents"
      plannedCapabilities={[
        'Inspect all indexed documents with visibility class, chunk count, and ACL rules',
        'Reclassify document access (public, customer_shared, internal_only, restricted, tenant_confidential)',
        'Manage allow/deny group and role permissions with transactional updates',
        'Deactivate or archive stale knowledge base documents without deleting audit history',
      ]}
      protectedEndpoints={[
        'GET /api/admin/documents',
        'PATCH /api/admin/documents/:id/permissions',
        'POST /api/admin/documents/:id/archive',
      ]}
    />
  );
}

