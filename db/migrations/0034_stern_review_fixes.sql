-- Preserve per-attempt infrastructure failures separately from the final batch opinion.
CREATE TABLE IF NOT EXISTS stern_verification_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT '',
  issues TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stern_verification_attempts_batch ON stern_verification_attempts(batch_id,id DESC);
-- Store delivery evidence for eligibility checks and later suggestion review.
ALTER TABLE stern_email_messages ADD COLUMN direct_to TEXT NOT NULL DEFAULT '';
ALTER TABLE stern_email_messages ADD COLUMN list_mail INTEGER NOT NULL DEFAULT 0;
