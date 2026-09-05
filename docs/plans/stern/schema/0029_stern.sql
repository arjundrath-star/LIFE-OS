-- 0029_stern: Stern tab (club recruiting, network, tasks, classes, automation).
-- Rules (repo law): every text column NOT NULL DEFAULT '' so dedupe keys and lookups never hit NULL;
-- append-only history tables get a live-tail index (entity, id DESC); counters are computed in SQL.
-- WP0 moves this file to db/migrations/0029_stern.sql unchanged, then runs `npm run migrate` twice.

-- ---------- recruiting processes ----------
CREATE TABLE IF NOT EXISTS stern_processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,                       -- 'stern-clubs-fall-2026'
  name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'club_recruiting' CHECK (kind IN ('club_recruiting','job_recruiting','other')),
  season TEXT NOT NULL DEFAULT '',                 -- 'Fall 2026'
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stern_clubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  process_id INTEGER NOT NULL REFERENCES stern_processes(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  short_name TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL DEFAULT '',                   -- normalized name, unique per process
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('', 'finance','consulting','entrepreneurship','tech','marketing','social_impact','identity','industry','accounting','law')),
  website TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  coffee_chat_form_url TEXT NOT NULL DEFAULT '',
  email_domains TEXT NOT NULL DEFAULT '[]',        -- JSON array of sender domains/addresses used to match club mail
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),   -- 1 = top target
  interested INTEGER NOT NULL DEFAULT 0,           -- 0 = catalog only, 1 = on Arjun's list
  status TEXT NOT NULL DEFAULT 'considering' CHECK (status IN ('considering','applying','interviewing','accepted','rejected','declined','archived')),
  target_chats INTEGER NOT NULL DEFAULT 2,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(process_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_stern_clubs_status ON stern_clubs(process_id, interested, status);

CREATE TABLE IF NOT EXISTS stern_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES stern_clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  track TEXT NOT NULL DEFAULT 'exploratory' CHECK (track IN ('exploratory','teams','other')),
  app_opens_at TEXT NOT NULL DEFAULT '',
  app_deadline_at TEXT NOT NULL DEFAULT '',
  interview_start TEXT NOT NULL DEFAULT '',
  interview_end TEXT NOT NULL DEFAULT '',
  decision_at TEXT NOT NULL DEFAULT '',
  application_url TEXT NOT NULL DEFAULT '',
  requirements TEXT NOT NULL DEFAULT '',
  dress_code TEXT NOT NULL DEFAULT '',
  interview_at TEXT NOT NULL DEFAULT '',          -- set when an invite arrives
  interview_location TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_open' CHECK (status IN ('not_open','open','drafting','submitted','interview_invited','interview_done','accepted','rejected','declined','withdrawn','missed')),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(club_id, track, name)
);
CREATE INDEX IF NOT EXISTS idx_stern_programs_deadline ON stern_programs(app_deadline_at, status);

CREATE TABLE IF NOT EXISTS stern_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  club_id INTEGER NOT NULL REFERENCES stern_clubs(id) ON DELETE CASCADE,
  program_id INTEGER NOT NULL DEFAULT 0,          -- 0 = club-level item
  key TEXT NOT NULL DEFAULT '',                   -- 'general_meeting','coffee_chat_1','coffee_chat_2','draft','submit','thank_yous','interview_prep'
  label TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  done_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','seed')),
  UNIQUE(club_id, program_id, key)
);

-- ---------- network ----------
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL DEFAULT '',            -- lower(email) when known, else 'name:'||normalized name||':'||normalized org
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',                  -- 'Sophomore', '2028', etc
  major TEXT NOT NULL DEFAULT '',
  org TEXT NOT NULL DEFAULT '',                   -- primary affiliation text (club, company, school)
  title TEXT NOT NULL DEFAULT '',
  sphere TEXT NOT NULL DEFAULT 'stern' CHECK (sphere IN ('stern','professional','personal')),
  relationship_type TEXT NOT NULL DEFAULT 'general_connect' CHECK (relationship_type IN ('friend','general_connect','club_connect','mentor','professional','professor')),
  strength INTEGER NOT NULL DEFAULT 1 CHECK (strength BETWEEN 1 AND 5),
  status TEXT NOT NULL DEFAULT 'met' CHECK (status IN ('met','need_to_reach_out','reached_out','replied','chatted','follow_up_owed','dormant')),
  how_met TEXT NOT NULL DEFAULT '' CHECK (how_met IN ('', 'club_event','coffee_chat','class','intro','social','dorm','email','other')),
  met_at TEXT NOT NULL DEFAULT '',                -- ISO datetime
  met_event TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  email_alt TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  hometown TEXT NOT NULL DEFAULT '',
  dorm TEXT NOT NULL DEFAULT '',
  last_contact_at TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  next_action_at TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','seed','auto_email','auto_calendar','imessage','import')),
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_dedupe ON people(dedupe_key) WHERE dedupe_key <> '';
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email) WHERE email <> '';
CREATE INDEX IF NOT EXISTS idx_people_status ON people(archived, status, relationship_type);

CREATE TABLE IF NOT EXISTS people_affiliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL DEFAULT 0,             -- 0 when org-only
  org TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  is_eboard INTEGER NOT NULL DEFAULT 0,
  relevant_for_recruiting INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(person_id, club_id, org)
);
CREATE INDEX IF NOT EXISTS idx_affiliations_club ON people_affiliations(club_id, is_eboard);

CREATE TABLE IF NOT EXISTS people_touchpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note' CHECK (kind IN ('met','email_sent','email_received','coffee_chat','thank_you_sent','follow_up_sent','text','dm','call','calendar','note')),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','gmail','calendar','imessage','seed')),
  gmail_account TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  UNIQUE(person_id, gmail_account, gmail_message_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_touchpoints_live_tail ON people_touchpoints(person_id, id DESC);

CREATE TABLE IF NOT EXISTS coffee_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL DEFAULT 0,
  program_id INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'to_request' CHECK (state IN ('to_request','requested','reply_received','scheduled','done','thank_you_sent','no_reply','declined')),
  requested_at TEXT NOT NULL DEFAULT '',
  reply_at TEXT NOT NULL DEFAULT '',
  reply_needs_me INTEGER NOT NULL DEFAULT 0,      -- 1 when the other side proposed times and Arjun has not answered
  scheduled_at TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  calendar_event_id TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL DEFAULT '',
  thank_you_sent_at TEXT NOT NULL DEFAULT '',
  last_follow_up_at TEXT NOT NULL DEFAULT '',
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  prep_notes TEXT NOT NULL DEFAULT '',
  takeaways TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_coffee_chats_state ON coffee_chats(state, club_id);
CREATE INDEX IF NOT EXISTS idx_coffee_chats_person ON coffee_chats(person_id, id DESC);

CREATE TABLE IF NOT EXISTS stern_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id INTEGER NOT NULL DEFAULT 0,
  coffee_chat_id INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'request' CHECK (kind IN ('request','thank_you','follow_up','reply_scheduling','other')),
  to_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'generated' CHECK (state IN ('generated','copied','gmail_draft_created','sent_detected','discarded')),
  gmail_account TEXT NOT NULL DEFAULT '',
  gmail_draft_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_drafts_person ON stern_drafts(person_id, id DESC);

-- ---------- tasks ----------
CREATE TABLE IF NOT EXISTS stern_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT 'professional' CHECK (domain IN ('academic','professional','campus')),
  course_id INTEGER NOT NULL DEFAULT 0,
  club_id INTEGER NOT NULL DEFAULT 0,
  program_id INTEGER NOT NULL DEFAULT 0,
  person_id INTEGER NOT NULL DEFAULT 0,
  assignment_id INTEGER NOT NULL DEFAULT 0,
  due_at TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto','seed','imessage','agent')),
  dedupe_key TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stern_tasks_dedupe ON stern_tasks(dedupe_key) WHERE dedupe_key <> '';
CREATE INDEX IF NOT EXISTS idx_stern_tasks_due ON stern_tasks(status, due_at);

-- ---------- classes ----------
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL DEFAULT '',                  -- 'STAT-UB 103'
  title TEXT NOT NULL DEFAULT '',
  section TEXT NOT NULL DEFAULT '',
  professor TEXT NOT NULL DEFAULT '',
  professor_email TEXT NOT NULL DEFAULT '',
  term TEXT NOT NULL DEFAULT 'Fall 2026',
  credits INTEGER NOT NULL DEFAULT 4,
  room TEXT NOT NULL DEFAULT '',
  syllabus_url TEXT NOT NULL DEFAULT '',
  brightspace_url TEXT NOT NULL DEFAULT '',
  grading_notes TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(code, term)
);

CREATE TABLE IF NOT EXISTS course_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL DEFAULT 1 CHECK (weekday BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time TEXT NOT NULL DEFAULT '',            -- '14:00'
  end_time TEXT NOT NULL DEFAULT '',
  room TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'lecture' CHECK (kind IN ('lecture','recitation','lab','office_hours')),
  UNIQUE(course_id, weekday, start_time, kind)
);

CREATE TABLE IF NOT EXISTS grade_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  weight_pct REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE(course_id, name)
);

CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'homework' CHECK (kind IN ('homework','quiz','exam','project','reading','other')),
  due_at TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','in_progress','submitted','graded')),
  points_earned REAL,                             -- NULL until graded (never part of a key)
  points_possible REAL,
  category_id INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_email','seed','imessage')),
  dedupe_key TEXT NOT NULL DEFAULT '',            -- lower(course code)||':'||normalized title
  gmail_message_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_dedupe ON assignments(dedupe_key) WHERE dedupe_key <> '';
CREATE INDEX IF NOT EXISTS idx_assignments_due ON assignments(course_id, status, due_at);

-- ---------- automation ----------
CREATE TABLE IF NOT EXISTS stern_scan_state (
  account TEXT PRIMARY KEY,                       -- gmail address
  last_internal_date INTEGER NOT NULL DEFAULT 0,  -- ms epoch of newest processed message
  last_checked TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  messages_seen INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stern_email_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail_account TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  gmail_thread_id TEXT NOT NULL DEFAULT '',
  content_hash TEXT NOT NULL DEFAULT '',          -- sha256(from|subject|date|first 2k of body) to collapse forwarded duplicates across accounts
  direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound')),
  from_addr TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  internal_date INTEGER NOT NULL DEFAULT 0,
  snippet TEXT NOT NULL DEFAULT '',
  classification TEXT NOT NULL DEFAULT '',        -- JSON per docs/plans/stern/schema/email-classifier.schema.json
  category TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  applied TEXT NOT NULL DEFAULT 'pending' CHECK (applied IN ('pending','auto_applied','suggested','ignored','duplicate','error')),
  error TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(gmail_account, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS idx_stern_email_hash ON stern_email_messages(content_hash);
CREATE INDEX IF NOT EXISTS idx_stern_email_live_tail ON stern_email_messages(id DESC);

CREATE TABLE IF NOT EXISTS stern_calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL DEFAULT '',
  event_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  start_at TEXT NOT NULL DEFAULT '',
  end_at TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  attendees TEXT NOT NULL DEFAULT '[]',           -- JSON array of emails
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('coffee_chat','interview','class','club_meeting','other')),
  person_id INTEGER NOT NULL DEFAULT 0,
  coffee_chat_id INTEGER NOT NULL DEFAULT 0,
  program_id INTEGER NOT NULL DEFAULT 0,
  created_by_us INTEGER NOT NULL DEFAULT 0,
  synced_at TEXT NOT NULL DEFAULT '',
  UNIQUE(account, event_id)
);
CREATE INDEX IF NOT EXISTS idx_stern_calendar_start ON stern_calendar_events(start_at);

CREATE TABLE IF NOT EXISTS stern_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  suggestion_type TEXT NOT NULL DEFAULT '',       -- 'person_create','coffee_chat_state','program_status','assignment_create','task_create','affiliation'
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id INTEGER NOT NULL DEFAULT 0,
  proposed_data TEXT NOT NULL DEFAULT '{}',       -- JSON
  evidence_type TEXT NOT NULL DEFAULT 'gmail' CHECK (evidence_type IN ('gmail','calendar','imessage','web','manual')),
  gmail_account TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  evidence_subject TEXT NOT NULL DEFAULT '',
  evidence_excerpt TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','accepted','dismissed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_stern_suggestions_state ON stern_suggestions(state, id DESC);

CREATE TABLE IF NOT EXISTS stern_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL DEFAULT '',           -- 'person','coffee_chat','program','club','assignment','task','calendar_event','draft'
  entity_id INTEGER NOT NULL DEFAULT 0,
  action TEXT NOT NULL DEFAULT '' CHECK (action IN ('create','update','delete','undo')),
  field TEXT NOT NULL DEFAULT '',
  before_value TEXT NOT NULL DEFAULT '',
  after_value TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto_email','auto_calendar','imessage','suggestion_accept','seed','agent','undo')),
  confidence REAL NOT NULL DEFAULT 0,
  evidence_type TEXT NOT NULL DEFAULT '',
  gmail_account TEXT NOT NULL DEFAULT '',
  gmail_message_id TEXT NOT NULL DEFAULT '',
  evidence_excerpt TEXT NOT NULL DEFAULT '',
  batch_id TEXT NOT NULL DEFAULT '',              -- groups all changes from one message/scan so Undo reverts the batch
  undone_at TEXT NOT NULL DEFAULT '',
  undo_of INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stern_audit_live_tail ON stern_audit_log(id DESC);
CREATE INDEX IF NOT EXISTS idx_stern_audit_entity ON stern_audit_log(entity_type, entity_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_stern_audit_batch ON stern_audit_log(batch_id);

CREATE TABLE IF NOT EXISTS stern_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL DEFAULT '',              -- 'deadline_t7','deadline_t3','deadline_t1','deadline_day','reply_owed','thank_you_due','no_reply_3d','interview_eve','task_due','memo'
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id INTEGER NOT NULL DEFAULT 0,
  fire_at TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'imessage' CHECK (channel IN ('imessage','email','both','dashboard')),
  message TEXT NOT NULL DEFAULT '',
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','sent','failed','skipped','snoozed')),
  sent_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(rule_key, entity_type, entity_id, fire_at)
);
CREATE INDEX IF NOT EXISTS idx_stern_reminders_due ON stern_reminders(delivery_status, fire_at);

-- ---------- agent registry ----------
INSERT OR IGNORE INTO agent_registry (slug, display_name, enabled, schedule_label, current_status)
VALUES ('stern-automation', 'Stern Automation (email, calendar, reminders)', 1, 'email scan every 10m · calendar every 5m · reminders every 1m · memo 08:00', 'idle');
