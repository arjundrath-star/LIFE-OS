-- Additive trust metadata. The migration runner records this file atomically.
ALTER TABLE coffee_chats ADD COLUMN scheduling_since TEXT NOT NULL DEFAULT '';
ALTER TABLE coffee_chats ADD COLUMN hot_until TEXT NOT NULL DEFAULT '';
ALTER TABLE coffee_chats ADD COLUMN last_thread_check_at TEXT NOT NULL DEFAULT '';
ALTER TABLE coffee_chats ADD COLUMN gmail_account TEXT NOT NULL DEFAULT '';
ALTER TABLE stern_email_messages ADD COLUMN verified TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS stern_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_account TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '' UNIQUE,
  provider TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  verdict TEXT NOT NULL DEFAULT '' CHECK(verdict IN ('','agree','disagree','unsure')),
  confidence REAL NOT NULL DEFAULT 0,
  issues TEXT NOT NULL DEFAULT '[]',
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stern_verifications_tail ON stern_verifications(id DESC);
CREATE INDEX IF NOT EXISTS idx_stern_hot_threads ON coffee_chats(hot_until,last_thread_check_at);
UPDATE coffee_chats SET gmail_account=COALESCE((SELECT gmail_account FROM stern_email_messages m WHERE m.gmail_thread_id=coffee_chats.gmail_thread_id ORDER BY id DESC LIMIT 1),'') WHERE gmail_thread_id<>'';
INSERT OR IGNORE INTO kv(k,v) SELECT 'stern.google_consent.'||lower(email),json_quote(added_at) FROM google_accounts;
