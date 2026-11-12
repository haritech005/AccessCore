import React from 'react';
import type { Metadata } from 'next';
import { AdminShell } from '@/components/admin/AdminShell';

export const metadata: Metadata = {
  title: 'Admin Console | AccessCore',
  description: 'AccessCore RBAC-enforced Administration Console',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}

