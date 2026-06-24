-- 0005_vending_outreach — cached snapshot of venue/vending outreach, derived from ONE
-- connected outreach inbox (Gmail, read-only). The emails themselves are the source of
-- truth; this is a per-poll cache (overwrite is fine), exactly like email_state.
-- "Reached out" = distinct recipient venues we emailed whose subject matches the scope
-- query; "responded" = how many of those venues replied. Counts are derived in code from
-- Gmail on each poll, never hand-incremented.
CREATE TABLE IF NOT EXISTS vending_outreach (
  inbox            TEXT PRIMARY KEY,          -- the outreach address the numbers come from
  query            TEXT,                      -- Gmail scope query in effect when cached
  reached_total    INTEGER NOT NULL DEFAULT 0,
  reached_7d       INTEGER NOT NULL DEFAULT 0,
  responded_total  INTEGER NOT NULL DEFAULT 0,
  recent_json      TEXT,                      -- recent outreach venues w/ replied flag
  last_checked     TEXT,
  last_error       TEXT
);
