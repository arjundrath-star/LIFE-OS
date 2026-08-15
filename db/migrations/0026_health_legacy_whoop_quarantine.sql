-- 0026_health_legacy_whoop_quarantine — additive repair for rows imported
-- before trustworthy WHOOP account scoping existed. Unknown legacy records are
-- preserved in place and soft-deleted; they are never attributed to whichever
-- account happens to be connected when this migration runs.

UPDATE health_workouts
SET source_external_id=COALESCE(source_external_id,external_id),
    source_account_identity='legacy-unscoped',
    deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='whoop'
  AND source_account_identity IS NULL
  AND deleted_at IS NULL;

UPDATE health_body_measurements
SET source_external_id=COALESCE(source_external_id,external_id),
    source_account_identity='legacy-unscoped',
    deleted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE source='whoop'
  AND source_account_identity IS NULL
  AND deleted_at IS NULL
  AND status='active';

-- Keep recovery and forensic lookup efficient without changing the uniqueness
-- contract already deployed by 0025.
CREATE INDEX IF NOT EXISTS idx_health_workouts_legacy_whoop_quarantine
  ON health_workouts(source,source_account_identity,deleted_at);
CREATE INDEX IF NOT EXISTS idx_health_body_legacy_whoop_quarantine
  ON health_body_measurements(source,source_account_identity,deleted_at);
