-- Durable, independently queryable receipts for idempotent Pokemon pipeline imports.
-- A receipt is written in the same SQLite transaction as the corresponding import.
CREATE TABLE IF NOT EXISTS pokemon_pipeline_sink_receipts (
  source_fingerprint TEXT PRIMARY KEY,
  run_id TEXT,
  row_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
