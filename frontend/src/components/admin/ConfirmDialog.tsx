'use client';

import React from 'react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  implications?: string[];
  confirmLabel?: string;
  tone?: 'danger' | 'warning' | 'primary';
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  description,
  implications = [],
  confirmLabel = 'Confirm Change',
  tone = 'warning',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const accent =
    tone === 'danger'
      ? { bg: '#ef4444', border: 'rgba(239, 68, 68, 0.35)', tint: 'rgba(239, 68, 68, 0.12)', text: '#fca5a5' }
      : tone === 'warning'
        ? { bg: '#d97706', border: 'rgba(245, 158, 11, 0.35)', tint: 'rgba(245, 158, 11, 0.12)', text: '#fcd34d' }
        : { bg: '#6366f1', border: 'rgba(99, 102, 241, 0.35)', tint: 'rgba(99, 102, 241, 0.12)', text: '#c7d2fe' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
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
          maxWidth: '480px',
          backgroundColor: '#0f1422',
          border: `1px solid ${accent.border}`,
          borderRadius: '14px',
          padding: '24px',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
          <span
            style={{
              padding: '4px 10px',
              borderRadius: '999px',
              backgroundColor: accent.tint,
              border: `1px solid ${accent.border}`,
              color: accent.text,
              fontSize: '0.7rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Security Confirmation
          </span>
        </div>

        <h3 id="confirm-dialog-title" style={{ margin: '0 0 8px', fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc' }}>
          {title}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: '0.86rem', lineHeight: 1.55, color: '#cbd5e1' }}>
          {description}
        </p>

        {implications.length > 0 && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: '10px',
              backgroundColor: accent.tint,
              border: `1px solid ${accent.border}`,
              marginBottom: '18px',
            }}
          >
            <div style={{ fontSize: '0.73rem', fontWeight: 700, color: accent.text, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' }}>
              Scope & Impact
            </div>
            <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.81rem', color: '#e2e8f0' }}>
              {implications.map((imp) => (
                <li key={imp}>{imp}</li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '9px 15px',
              borderRadius: '8px',
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#cbd5e1',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: '9px 16px',
              borderRadius: '8px',
              backgroundColor: accent.bg,
              border: 'none',
              color: '#ffffff',
              fontSize: '0.84rem',
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? 'Applying...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

