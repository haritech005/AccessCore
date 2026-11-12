'use client';

import React from 'react';
import Link from 'next/link';
import { useAdminSession } from '@/components/admin/AdminShell';

export interface AdminSectionFoundationProps {
  title: string;
  description: string;
  capabilityKey: keyof ReturnType<typeof useAdminSession>['access']['capabilities'];
  plannedCapabilities: string[];
  protectedEndpoints: string[];
}

export function AdminSectionFoundation({
  title,
  description,
  capabilityKey,
  plannedCapabilities,
  protectedEndpoints,
}: AdminSectionFoundationProps) {
  const { access } = useAdminSession();
  const hasCapability = access.capabilities[capabilityKey];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            {title}
          </h1>
          <p style={{ fontSize: '0.86rem', color: '#94a3b8', margin: '4px 0 0' }}>
            {description}
          </p>
        </div>

        <span
          style={{
            padding: '5px 12px',
            borderRadius: '999px',
            backgroundColor: hasCapability ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
            border: hasCapability
              ? '1px solid rgba(16, 185, 129, 0.3)'
              : '1px solid rgba(245, 158, 11, 0.3)',
            color: hasCapability ? '#6ee7b7' : '#fcd34d',
            fontSize: '0.76rem',
            fontWeight: 600,
          }}
        >
          {hasCapability ? 'Server Access Verified' : 'Limited Role Scope'}
        </span>
      </div>

      <div
        style={{
          backgroundColor: '#111624',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '12px',
          padding: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '0.96rem', fontWeight: 600, color: '#f8fafc', margin: '0 0 12px' }}>
            Module Capabilities
          </h2>
          <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.84rem', color: '#cbd5e1' }}>
            {plannedCapabilities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h2 style={{ fontSize: '0.96rem', fontWeight: 600, color: '#f8fafc', margin: '0 0 12px' }}>
            Protected API Surface
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {protectedEndpoints.map((ep) => (
              <div
                key={ep}
                style={{
                  padding: '9px 12px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontFamily: 'monospace',
                  fontSize: '0.79rem',
                  color: '#a5b4fc',
                }}
              >
                {ep}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
          Authorized session: <strong style={{ color: '#e2e8f0' }}>{access.admin.email}</strong> ({access.admin.role})
        </div>
        <Link
          href="/admin"
          style={{
            padding: '8px 14px',
            borderRadius: '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            color: '#cbd5e1',
            fontSize: '0.82rem',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          ← Return to Admin Overview
        </Link>
      </div>
    </div>
  );
}

