-- Migration: Add client feedback table for tracking improvements
CREATE TABLE IF NOT EXISTS client_feedback (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  priority    VARCHAR(20) DEFAULT 'medium', -- low | medium | high
  status      VARCHAR(30) DEFAULT 'pending', -- pending | in_progress | done
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_feedback_status ON client_feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON client_feedback(created_at);
