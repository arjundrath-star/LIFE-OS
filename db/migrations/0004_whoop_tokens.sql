-- 0004_whoop_tokens — single-user WHOOP OAuth credential store.
-- One row (Arjun's WHOOP account). Refresh token is ENCRYPTED at rest (AES-256-GCM),
-- same convention as google_accounts.refresh_token_enc — never plaintext, never to client.
-- whoop_daily (the metric history) already exists from 0001_init.
CREATE TABLE IF NOT EXISTS whoop_tokens (
  user_id           INTEGER PRIMARY KEY,       -- WHOOP user id from /user/profile/basic
  email             TEXT,
  first_name        TEXT,
  last_name         TEXT,
  refresh_token_enc TEXT,                       -- AES-256-GCM, rotates on every refresh
  scopes            TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_sync         TEXT,
  last_error        TEXT,
  connected_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
