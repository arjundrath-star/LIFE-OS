-- Pokemon CRM: PeopleFinder lead pool, contacts, per-number call tracking, touchpoints.
-- Leads start inactive; the first logged touchpoint flips active=1 permanently.
-- Phone/email rows are never deleted — dead numbers keep their status for history.

CREATE TABLE IF NOT EXISTS pokemon_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_filename TEXT NOT NULL,
  drive_file_id TEXT,
  source_kind TEXT NOT NULL DEFAULT 'peoplefinder_csv',
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  row_count INTEGER NOT NULL DEFAULT 0,
  leads_created INTEGER NOT NULL DEFAULT 0,
  leads_updated INTEGER NOT NULL DEFAULT 0,
  contacts_created INTEGER NOT NULL DEFAULT 0,
  phones_created INTEGER NOT NULL DEFAULT 0,
  emails_created INTEGER NOT NULL DEFAULT 0,
  warnings_json TEXT
);

CREATE TABLE IF NOT EXISTS pokemon_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_key TEXT,
  venue_name TEXT NOT NULL,
  category TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  active INTEGER NOT NULL DEFAULT 0,
  address TEXT,
  city TEXT,
  state TEXT,
  website TEXT,
  venue_phone TEXT,
  rating REAL,
  reviews INTEGER,
  vending_score INTEGER,
  pokemon_fit_score INTEGER,
  owner_access_score INTEGER,
  route_cluster TEXT,
  best_visit_window TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  next_action TEXT,
  next_action_due TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_batch_id INTEGER REFERENCES pokemon_import_batches(id),
  raw_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_leads_active_stage ON pokemon_leads(active, stage);
CREATE INDEX IF NOT EXISTS idx_pokemon_leads_cluster ON pokemon_leads(route_cluster);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pokemon_leads_dedupe ON pokemon_leads(venue_name, address);

CREATE TABLE IF NOT EXISTS pokemon_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  relationship_to_venue TEXT,
  source_note TEXT,
  confidence TEXT NOT NULL DEFAULT 'needs_review',
  status TEXT NOT NULL DEFAULT 'untested',
  raw_contact_cell TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_pokemon_contacts_lead ON pokemon_contacts(lead_id);

CREATE TABLE IF NOT EXISTS pokemon_phone_numbers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: numbers must survive contact cleanup (never-delete invariant)
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  phone_type TEXT NOT NULL DEFAULT 'unknown',
  priority_order INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'untested',
  call_count INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT,
  last_result TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(lead_id, contact_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_pokemon_phone_numbers_status ON pokemon_phone_numbers(status);
CREATE INDEX IF NOT EXISTS idx_pokemon_phone_numbers_lead ON pokemon_phone_numbers(lead_id);

CREATE TABLE IF NOT EXISTS pokemon_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'peoplefinder_export_unmapped',
  hunter_status TEXT NOT NULL DEFAULT 'unverified',
  status TEXT NOT NULL DEFAULT 'untested',
  last_emailed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(lead_id, email)
);
CREATE INDEX IF NOT EXISTS idx_pokemon_emails_status ON pokemon_emails(status);

CREATE TABLE IF NOT EXISTS pokemon_touchpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES pokemon_leads(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES pokemon_contacts(id) ON DELETE SET NULL,
  phone_id INTEGER REFERENCES pokemon_phone_numbers(id) ON DELETE SET NULL,
  email_id INTEGER REFERENCES pokemon_emails(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor TEXT NOT NULL DEFAULT 'arjun',
  summary TEXT,
  next_action_at TEXT,
  raw_notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_pokemon_touchpoints_lead ON pokemon_touchpoints(lead_id, occurred_at DESC);
