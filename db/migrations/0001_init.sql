-- 0001_init — rathworkspace core schema.
-- History over overwrite: time-series tables append timestamped rows; "current" is derived by query.

-- Connection control plane. One row per (service, surface).
-- state is derived in code from (enabled, health); we also persist the resolved state for fast reads.
CREATE TABLE IF NOT EXISTS connections (
  service     TEXT NOT NULL,
  surface     TEXT NOT NULL,                 -- 'dashboard' | 'hermes' | 'claude'
  enabled     INTEGER NOT NULL DEFAULT 1,    -- user intent (1=on, 0=off-intentional)
  health      TEXT NOT NULL DEFAULT 'unknown', -- 'ok' | 'fail' | 'unknown'
  state       TEXT NOT NULL DEFAULT 'off',   -- 'on_healthy' | 'on_broken' | 'off'
  detail      TEXT,                          -- short human note / last error message
  last_ok_at  TEXT,
  last_checked TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (service, surface)
);

-- Append-only agent activity (Hermes / Telegram / Claude Code self-reports).
CREATE TABLE IF NOT EXISTS agent_activity (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source  TEXT NOT NULL,                     -- 'hermes' | 'telegram' | 'claude'
  kind    TEXT NOT NULL DEFAULT 'event',     -- 'event' | 'task' | 'session' | 'message'
  summary TEXT NOT NULL,
  detail  TEXT                               -- JSON blob, optional
);
CREATE INDEX IF NOT EXISTS idx_agent_activity_ts ON agent_activity(ts);
CREATE INDEX IF NOT EXISTS idx_agent_activity_source ON agent_activity(source, ts);

-- The bottom event ticker. Append-only.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source  TEXT NOT NULL,
  level   TEXT NOT NULL DEFAULT 'info',      -- 'info' | 'success' | 'warn' | 'error'
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

-- Whoop daily history (one row per cycle day). Stub until Whoop connected.
CREATE TABLE IF NOT EXISTS whoop_daily (
  day               TEXT PRIMARY KEY,        -- YYYY-MM-DD
  recovery          INTEGER,                 -- %
  hrv_ms            REAL,
  rhr_bpm           REAL,
  sleep_hours       REAL,
  sleep_performance INTEGER,                 -- %
  strain            REAL,
  raw               TEXT,
  ts                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Revenue history (vending via Mercury). Stub until Mercury connected.
CREATE TABLE IF NOT EXISTS revenue_daily (
  day           TEXT NOT NULL,               -- YYYY-MM-DD
  source        TEXT NOT NULL DEFAULT 'mercury',
  amount_cents  INTEGER NOT NULL DEFAULT 0,
  balance_cents INTEGER,
  raw           TEXT,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (day, source)
);

-- Vending machines.
CREATE TABLE IF NOT EXISTS machines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  location     TEXT,
  status       TEXT NOT NULL DEFAULT 'prospect', -- 'prospect' | 'placing' | 'live' | 'paused'
  needs_refill INTEGER NOT NULL DEFAULT 0,
  last_refill  TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Vending deal pipeline.
CREATE TABLE IF NOT EXISTS deals (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  stage        TEXT NOT NULL DEFAULT 'lead',  -- 'lead' | 'contacted' | 'verbal_yes' | 'placing' | 'live' | 'lost'
  location     TEXT,
  machine_type TEXT,
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Accounts & Links hub. Seeded from the VPS, user-editable.
CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'service', -- 'google' | 'service' | 'link' | 'plugin'
  email      TEXT,
  url        TEXT,
  surface    TEXT,                            -- where it's wired (claude/hermes/dashboard/vps)
  status     TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'inactive' | 'broken'
  note       TEXT,
  sort       INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Connected Google accounts for the Email/Calendar radar. Refresh token is ENCRYPTED at rest.
CREATE TABLE IF NOT EXISTS google_accounts (
  email             TEXT PRIMARY KEY,
  name              TEXT,
  picture           TEXT,
  refresh_token_enc TEXT,                     -- AES-256-GCM, never plaintext, never to client
  scopes            TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_sync         TEXT,
  last_error        TEXT,
  added_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Per-account email snapshot (current unread). Overwrite is fine here (it is a snapshot, not history).
CREATE TABLE IF NOT EXISTS email_state (
  email         TEXT PRIMARY KEY,
  unread_count  INTEGER NOT NULL DEFAULT 0,
  important_count INTEGER NOT NULL DEFAULT 0,
  latest_subject TEXT,
  latest_from   TEXT,
  latest_ts     TEXT,
  last_checked  TEXT
);

-- The dashboard's own to-do list (seeded TODOs from the spec).
CREATE TABLE IF NOT EXISTS todos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  text       TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  source     TEXT NOT NULL DEFAULT 'manual',
  due        TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Generic module key/value state.
CREATE TABLE IF NOT EXISTS kv (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
