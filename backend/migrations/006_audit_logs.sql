-- Migration: 006_audit_logs.sql
-- Description: Immutable administrative and security audit log table (Subphase 5.4 / 5.6)

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_id VARCHAR(50),
    actor_email VARCHAR(255),
    actor_role VARCHAR(50),
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(120),
    outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
    correlation_id VARCHAR(100),
    ip_address VARCHAR(64),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs (target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_outcome ON audit_logs (outcome);

