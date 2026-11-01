-- Migration: 003_disclosure_policies.sql
-- Description: Disclosure policy, audience mode, and approved summaries schema for Phase 3

-- 1. Add disclosure_policy to document_permissions table if not present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'document_permissions' AND column_name = 'disclosure_policy'
    ) THEN
        ALTER TABLE document_permissions 
        ADD COLUMN disclosure_policy VARCHAR(50) NOT NULL DEFAULT 'internal_only';
    END IF;
END $$;

-- 2. Add check constraints to document_permissions to enforce valid classifications
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_perm_sensitivity'
    ) THEN
        ALTER TABLE document_permissions 
        ADD CONSTRAINT chk_doc_perm_sensitivity 
        CHECK (sensitivity IN ('public', 'customer_shareable', 'internal', 'confidential', 'restricted'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_perm_disclosure_policy'
    ) THEN
        ALTER TABLE document_permissions 
        ADD CONSTRAINT chk_doc_perm_disclosure_policy 
        CHECK (disclosure_policy IN ('customer_shareable', 'direct', 'approved_summary_only', 'internal_only', 'restricted'));
    END IF;
END $$;

-- 3. Approved Summaries Table
-- Stores explicitly approved customer-facing summaries separately from original content
CREATE TABLE IF NOT EXISTS approved_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_id UUID REFERENCES document_versions(id) ON DELETE CASCADE,
    audience VARCHAR(50) NOT NULL DEFAULT 'customer', -- 'customer', 'internal'
    summary_text TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'approved', -- 'approved', 'draft', 'deprecated', 'rejected'
    approved_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_summary_audience CHECK (audience IN ('customer', 'internal')),
    CONSTRAINT chk_summary_status CHECK (status IN ('approved', 'draft', 'deprecated', 'rejected')),
    CONSTRAINT uq_approved_summary_doc_aud UNIQUE (document_id, audience)
);

-- 4. Indexes for fast policy retrieval
CREATE INDEX IF NOT EXISTS idx_doc_perm_disclosure ON document_permissions(disclosure_policy);
CREATE INDEX IF NOT EXISTS idx_approved_summaries_doc ON approved_summaries(document_id);
CREATE INDEX IF NOT EXISTS idx_approved_summaries_aud_status ON approved_summaries(document_id, audience, status);

