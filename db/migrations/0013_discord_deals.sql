-- Official Discord bot ingestion is intentionally separate from locked price-observation enums.
CREATE TABLE IF NOT EXISTS pk_discord_deals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_guild_id TEXT,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  product_text TEXT NOT NULL,
  price_cents INTEGER,
  url TEXT,
  observed_at TEXT NOT NULL,
  matching_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (matching_status IN ('unmatched','matched','ignored')),
  raw_excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(channel_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_pk_discord_deals_observed ON pk_discord_deals(observed_at DESC);

CREATE TABLE IF NOT EXISTS pk_discord_cursors (
  channel_id TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
