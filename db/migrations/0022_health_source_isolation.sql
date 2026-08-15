-- 0022_health_source_isolation — account generations, truthful undated observations,
-- and separate WHOOP auth/data-sync health. Additive only.

ALTER TABLE health_sync_state ADD COLUMN account_identity TEXT;
ALTER TABLE health_sync_state ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE health_body_measurements ADD COLUMN observation_at_known INTEGER NOT NULL DEFAULT 1
  CHECK (observation_at_known IN (0,1));

ALTER TABLE whoop_tokens ADD COLUMN auth_error TEXT;
ALTER TABLE whoop_tokens ADD COLUMN auth_checked_at TEXT;
