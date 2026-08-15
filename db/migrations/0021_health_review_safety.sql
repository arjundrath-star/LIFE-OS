-- 0021_health_review_safety — additive replay/correction metadata from adversarial review.

ALTER TABLE health_meals ADD COLUMN payload_hash TEXT;
ALTER TABLE health_checkins ADD COLUMN payload_hash TEXT;
ALTER TABLE health_substance_events ADD COLUMN payload_hash TEXT;
ALTER TABLE health_body_measurements ADD COLUMN payload_hash TEXT;
ALTER TABLE health_recommendations ADD COLUMN payload_hash TEXT;

ALTER TABLE health_substance_events ADD COLUMN supersedes_id INTEGER REFERENCES health_substance_events(id) ON DELETE RESTRICT;
ALTER TABLE health_substance_events ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded'));
ALTER TABLE health_substance_events ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_substance_supersedes ON health_substance_events(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_substance_status_at ON health_substance_events(status,occurred_at);

ALTER TABLE health_body_measurements ADD COLUMN supersedes_id INTEGER REFERENCES health_body_measurements(id) ON DELETE RESTRICT;
ALTER TABLE health_body_measurements ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_body_supersedes ON health_body_measurements(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_health_body_status_measured ON health_body_measurements(status,measured_at,deleted_at);
