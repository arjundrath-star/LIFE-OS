-- Structured, per-program interview questions. Undo uses the shared Stern audit log.
CREATE TABLE IF NOT EXISTS stern_interview_prep (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id INTEGER NOT NULL REFERENCES stern_programs(id) ON DELETE CASCADE,
  question TEXT NOT NULL DEFAULT '',
  answer TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_stern_interview_prep_program ON stern_interview_prep(program_id, sort, id);
