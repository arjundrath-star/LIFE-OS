-- 0019_career — professional endeavors, append-only history, review-gated discovery.

CREATE TABLE IF NOT EXISTS endeavors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key    TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  organization  TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL CHECK (category IN ('work','klade','community')),
  kind          TEXT NOT NULL CHECK (kind IN ('engagement','application')),
  status        TEXT NOT NULL CHECK (
    (kind='application' AND status IN ('researching','drafting','submitted','interviewing','offer','accepted','rejected','withdrawn','missed_deadline')) OR
    (kind='engagement' AND status IN ('active','paused','ended'))
  ),
  deadline      TEXT NOT NULL DEFAULT '',
  primary_url   TEXT NOT NULL DEFAULT '',
  urls_json     TEXT NOT NULL DEFAULT '[]',
  contact_name  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  location      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  source        TEXT NOT NULL CHECK (source IN ('manual','seed','discovery')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_endeavors_status ON endeavors(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_endeavors_category ON endeavors(category, status);
CREATE INDEX IF NOT EXISTS idx_endeavors_deadline ON endeavors(deadline, status);

CREATE TABLE IF NOT EXISTS endeavor_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  endeavor_id  INTEGER NOT NULL,
  event_type   TEXT NOT NULL,
  summary      TEXT NOT NULL,
  detail       TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL DEFAULT 'manual',
  occurred_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (endeavor_id) REFERENCES endeavors(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_endeavor_events_live_tail ON endeavor_events(endeavor_id, id DESC);

CREATE TABLE IF NOT EXISTS career_suggestions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key       TEXT NOT NULL UNIQUE,
  suggestion_type  TEXT NOT NULL CHECK (suggestion_type IN ('new_endeavor','status_change')),
  endeavor_id      INTEGER,
  proposed_data    TEXT NOT NULL DEFAULT '{}',
  evidence_type    TEXT NOT NULL CHECK (evidence_type IN ('web','gmail','manual')),
  evidence_url     TEXT NOT NULL DEFAULT '',
  gmail_account    TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  evidence_subject TEXT NOT NULL DEFAULT '',
  evidence_excerpt TEXT NOT NULL DEFAULT '',
  state            TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','dismissed')),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at      TEXT,
  FOREIGN KEY (endeavor_id) REFERENCES endeavors(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_career_suggestions_state ON career_suggestions(state, id DESC);

CREATE TABLE IF NOT EXISTS career_watchlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL UNIQUE,
  url        TEXT NOT NULL UNIQUE,
  category   TEXT NOT NULL CHECK (category IN ('work','klade','community')),
  enabled    INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT OR IGNORE INTO career_watchlist (label, url, category) VALUES
  ('Pear', 'https://pear.vc/programs/', 'work'),
  ('Neo', 'https://neo.com/programs', 'klade'),
  ('Contrary', 'https://contrary.com/', 'work'),
  ('Z Fellows', 'https://www.zfellows.com/', 'klade'),
  ('Dorm Room Fund', 'https://www.dormroomfund.com/', 'klade'),
  ('8VC', 'https://www.8vc.com/fellowships', 'work'),
  ('Kleiner Perkins Fellows', 'https://fellows.kleinerperkins.com/', 'work'),
  ('Bessemer Fellows', 'https://www.bvp.com/bessemer-fellows', 'work'),
  ('NYU Entrepreneurship and eLab', 'https://entrepreneur.nyu.edu/events/', 'community'),
  ('NYC Startup Week', 'https://www.nycstartupweek.com/', 'community'),
  ('Garys Guide NYC', 'https://www.garysguide.com/events?region=nyc', 'community');

INSERT OR IGNORE INTO agent_registry (slug, display_name, description, enabled, schedule_label, current_status)
VALUES (
  'career-scout',
  'Career Scout',
  'Review-gated professional opportunity scout: reads approved Gmail accounts for likely status changes and researches evidence-backed opportunities. Never sends email or mutates endeavors without approval.',
  1,
  'email every 30m · opportunity hunt daily',
  'idle'
);
