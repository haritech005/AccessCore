-- Migration: 007_ingestion_operations.sql
-- Description: Operational recovery metadata for ingestion_jobs (job types, retry limits, diagnostics, and recovery snapshots)

ALTER TABLE ingestion_jobs
  ADD COLUMN IF NOT EXISTS job_type VARCHAR(50) NOT NULL DEFAULT 'ingest',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(100),
  ADD COLUMN IF NOT EXISTS chunks_total INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chunks_reused INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_document ON ingestion_jobs(document_id, started_at DESC);

