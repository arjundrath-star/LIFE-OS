-- 0006_agent_orchestration — named agent / subagent run visibility.
-- Additive only. Cron is the alarm clock, Hermes the orchestrator; named agents emit
-- events (via scripts/agent-event.ts -> lib/agents.ts) into these tables, and the
-- scheduler broadcasts them to the dashboard on the gated "agent_runs" WS channel.
-- The whole file runs in ONE transaction (see db/index.ts migrate()).

-- Status enum used by both agent_runs.status and agent_registry.current_status:
--   idle | queued | running | waiting_for_review | blocked | completed | failed
-- (CHECK constraints below are belt-and-suspenders to the validation in lib/agents.ts.)

-- The named agents we know about. One row per agent. System-owned; not user-editable.
CREATE TABLE IF NOT EXISTS agent_registry (
  slug           TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  description    TEXT,
  enabled        INTEGER NOT NULL DEFAULT 1,
  schedule_label TEXT,                          -- human note, e.g. "daily 13:00 UTC"
  current_status TEXT NOT NULL DEFAULT 'idle'
                 CHECK (current_status IN ('idle','queued','running','waiting_for_review','blocked','completed','failed')),
  last_run_id    TEXT,                          -- most recent run id
  last_run_at    TEXT,                          -- latest activity ts on that run (UI: "last activity")
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per run of a named agent.
CREATE TABLE IF NOT EXISTS agent_runs (
  id             TEXT PRIMARY KEY,
  agent_slug     TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('idle','queued','running','waiting_for_review','blocked','completed','failed')),
  trigger_type   TEXT,                          -- 'cron' | 'manual' | 'hermes' | 'demo' | ...
  trigger_source TEXT,                          -- free text: who/what kicked it off
  summary        TEXT,                          -- latest one-line summary of the run
  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at    TEXT,                          -- set only on completed/failed
  detail         TEXT,                          -- optional JSON blob
  FOREIGN KEY (agent_slug) REFERENCES agent_registry(slug)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_slug ON agent_runs(agent_slug, started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status, started_at);

-- Timeline events for a run (append-only).
CREATE TABLE IF NOT EXISTS agent_run_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  ts         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind       TEXT NOT NULL DEFAULT 'event',     -- free-form: started|progress|waiting_for_review|...
  status     TEXT,                              -- run status at the time of this event (nullable)
  level      TEXT NOT NULL DEFAULT 'info'
             CHECK (level IN ('info','success','warn','error')),
  summary    TEXT NOT NULL,
  detail     TEXT,                              -- optional JSON blob
  FOREIGN KEY (run_id) REFERENCES agent_runs(id),
  FOREIGN KEY (agent_slug) REFERENCES agent_registry(slug)
);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_run ON agent_run_events(run_id, id);
CREATE INDEX IF NOT EXISTS idx_agent_run_events_ts ON agent_run_events(ts);

-- Artifact references produced by a run.
CREATE TABLE IF NOT EXISTS agent_artifacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  type       TEXT NOT NULL,                     -- 'spreadsheet'|'email'|'draft'|'log'|'blocker'|'link'|...
  title      TEXT NOT NULL,
  uri        TEXT NOT NULL,                     -- url, gmail msg id, local path, or short note
  metadata   TEXT,                              -- optional JSON blob
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (run_id) REFERENCES agent_runs(id),
  FOREIGN KEY (agent_slug) REFERENCES agent_registry(slug)
);
CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run ON agent_artifacts(run_id);

-- Seed the starter named agents. INSERT OR IGNORE: this migration runs exactly once
-- (guarded by _migrations), and OR IGNORE keeps it safe if the file is ever re-applied
-- against a partially-seeded DB. These rows are system-owned, never user-renamed.
INSERT OR IGNORE INTO agent_registry (slug, display_name, description, enabled, schedule_label, current_status) VALUES
  ('hermes-orchestrator',
   'Hermes Orchestrator',
   'This Hermes assistant/runtime: the top-level orchestrator that cron alarms or user requests wake. It decides what runs and dispatches named specialist agents below.',
   1, 'cron: daily', 'idle'),
  ('portable-charging-lead-scout',
   'Portable Charging Lead Scout',
   'Finds venue leads for the portable-charging business, dedupes against existing rows, drafts outreach, and sends a review packet to Arjun. Never sends outreach itself.',
   1, 'cron: daily', 'idle'),
  ('portable-charging-outreach-sender',
   'Portable Charging Outreach Sender',
   'After Arjun approves drafts, sends the approved emails, checks bounces, and updates the spreadsheets. Idle until wired.',
   1, 'on approval', 'idle'),
  ('deliverability-monitor',
   'Deliverability Monitor',
   'Watches inbox placement / bounce / spam signals for outbound sending domains. Idle until wired.',
   1, 'periodic', 'idle');
