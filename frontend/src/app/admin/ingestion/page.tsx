'use client';

import React from 'react';
import { AdminSectionFoundation } from '@/components/admin/AdminSectionFoundation';

export default function AdminIngestionPage() {
  return (
    <AdminSectionFoundation
      title="Ingestion Operations"
      description="Upload Markdown, TXT, JSON, or PDF documents, monitor embedding jobs, and re-index documents."
      capabilityKey="can_ingest"
      plannedCapabilities={[
        'Upload single or batch files with visibility and tenant/group ACL configuration',
        'Inspect per-job status, duration, active chunk counts, and error diagnostics',
        'Trigger deterministic re-ingestion for updated knowledge documents',
        'Enforce admin-only ingestion write protection on all upload and re-index routes',
      ]}
      protectedEndpoints={[
        'GET /api/admin/ingestion/jobs',
        'POST /api/documents/upload',
        'POST /api/documents/:id/reindex',
      ]}
    />
  );
}

