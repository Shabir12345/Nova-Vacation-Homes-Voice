-- Migration: Add reviewed_at to call_logs
-- This column tracks when the review-calls script last analyzed this row.
-- NULL means the call has not yet been reviewed.

ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;

-- Index for performance when filtering unreviewed calls
CREATE INDEX IF NOT EXISTS idx_call_logs_reviewed_at ON call_logs(reviewed_at);
