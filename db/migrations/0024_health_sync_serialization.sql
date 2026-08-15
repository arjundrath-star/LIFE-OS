-- 0024_health_sync_serialization — cross-process source leases and monotonic imports.
-- Additive and runner-idempotent: this file is applied once by the migration ledger.

ALTER TABLE health_sync_state ADD COLUMN lease_token TEXT;
ALTER TABLE health_sync_state ADD COLUMN lease_expires_at TEXT;
ALTER TABLE health_sync_state ADD COLUMN run_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE health_workouts ADD COLUMN source_updated_at TEXT;
ALTER TABLE health_workouts ADD COLUMN source_run_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE health_body_measurements ADD COLUMN source_updated_at TEXT;
ALTER TABLE health_body_measurements ADD COLUMN source_run_version INTEGER NOT NULL DEFAULT 0;

-- Legacy diagnostic text must not survive either storage or serialization boundaries.
UPDATE health_sync_state
SET last_error = CASE
  WHEN last_error IN (
    'HEVY_HTTP_ERROR',
    'HEVY_SCHEMA_ERROR',
    'HEVY_AUTH_ERROR',
    'HEVY_SYNC_TIMEOUT',
    'HEVY_SYNC_DEADLINE',
    'HEVY_PAGINATION_ERROR',
    'HEVY_SESSION_CHANGED',
    'HEVY_SYNC_FAILED'
  ) THEN last_error
  ELSE 'HEVY_SYNC_FAILED'
END
WHERE source = 'hevy' AND last_error IS NOT NULL;
