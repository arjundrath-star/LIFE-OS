-- Durable receipts for idempotent capture-source ingestion (server/ingest/*).
-- One row per ingested note; written in the same SQLite transaction as the CRM
-- touchpoint it produced, so re-ingesting an already-seen note is a verifiable
-- no-op. Same pattern as 0010_pokemon_pipeline_sink_receipts.sql. No FK on
-- lead_id on purpose: a receipt is proof of a past ingest and must outlive any
-- CRM row lifecycle.
CREATE TABLE IF NOT EXISTS capture_ingest_receipts (
  fingerprint TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  lead_id INTEGER NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_capture_ingest_receipts_source
  ON capture_ingest_receipts(source, ingested_at DESC);
