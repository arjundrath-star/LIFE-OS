-- 0025_health_account_archives — additive account scoping for Hevy imports and
-- recoverable WHOOP daily quarantine. Migrations 0020-0024 are already deployed;
-- this migration does not rewrite their semantics or require replaying them.

ALTER TABLE health_workouts ADD COLUMN source_account_identity TEXT;
ALTER TABLE health_workouts ADD COLUMN source_external_id TEXT;
ALTER TABLE health_body_measurements ADD COLUMN source_account_identity TEXT;
ALTER TABLE health_body_measurements ADD COLUMN source_external_id TEXT;

-- Legacy Hevy rows predate trustworthy account attribution. Preserve their original
-- provider IDs, quarantine them, and leave all payloads recoverable. A future sync
-- writes account-scoped storage identities rather than claiming these legacy rows.
UPDATE health_workouts
SET source_external_id=COALESCE(source_external_id,external_id),
    source_account_identity=COALESCE(source_account_identity,'legacy-unscoped'),
    deleted_at=COALESCE(deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='hevy';
UPDATE health_body_measurements
SET source_external_id=COALESCE(source_external_id,external_id),
    source_account_identity=COALESCE(source_account_identity,'legacy-unscoped'),
    deleted_at=COALESCE(deleted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='hevy';

CREATE INDEX IF NOT EXISTS idx_health_workouts_source_account_external
  ON health_workouts(source,source_account_identity,source_external_id);
CREATE INDEX IF NOT EXISTS idx_health_body_source_account_external
  ON health_body_measurements(source,source_account_identity,source_external_id);

CREATE TABLE IF NOT EXISTS health_whoop_daily_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'whoop' CHECK (source='whoop'),
  account_identity TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('account_replaced','disconnect')),
  day TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_health_whoop_archive_account_day
  ON health_whoop_daily_archive(account_identity,day,archived_at);

-- The archive is append-only: application defects cannot mutate or erase retained
-- rows. Recovery can copy payloads out without weakening this invariant.
CREATE TRIGGER IF NOT EXISTS health_whoop_archive_no_update
BEFORE UPDATE ON health_whoop_daily_archive
BEGIN
  SELECT RAISE(ABORT,'WHOOP archive is append-only');
END;
CREATE TRIGGER IF NOT EXISTS health_whoop_archive_no_delete
BEFORE DELETE ON health_whoop_daily_archive
BEGIN
  SELECT RAISE(ABORT,'WHOOP archive is append-only');
END;
