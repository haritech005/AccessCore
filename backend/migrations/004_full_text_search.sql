-- Migration: 004_full_text_search.sql
-- Description: Adds PostgreSQL full-text search tsvector columns and GIN indexes
-- to document_chunks and approved_summaries for sparse lexical retrieval.

-- 1. Add generated tsvector column to document_chunks
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'document_chunks' AND column_name = 'tsv'
    ) THEN
        ALTER TABLE document_chunks
        ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
            to_tsvector('english',
                coalesce(metadata->>'title', '') || ' ' ||
                coalesce(metadata->>'section_heading', '') || ' ' ||
                coalesce(metadata->>'document_id', '') || ' ' ||
                coalesce(content, '')
            )
        ) STORED;
    END IF;
END $$;

-- 2. Create GIN index on document_chunks tsv column
CREATE INDEX IF NOT EXISTS idx_document_chunks_tsv ON document_chunks USING gin(tsv);

-- 3. Add generated tsvector column to approved_summaries
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'approved_summaries' AND column_name = 'tsv'
    ) THEN
        ALTER TABLE approved_summaries
        ADD COLUMN tsv tsvector GENERATED ALWAYS AS (
            to_tsvector('english', summary_text)
        ) STORED;
    END IF;
END $$;

-- 4. Create GIN index on approved_summaries tsv column
CREATE INDEX IF NOT EXISTS idx_approved_summaries_tsv ON approved_summaries USING gin(tsv);

