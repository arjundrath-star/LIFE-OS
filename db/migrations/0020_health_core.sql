-- 0020_health_core — structured personal-trainer control plane.
-- Additive and replay-safe: migrations run once, imports/commands dedupe by stable keys.

CREATE TABLE IF NOT EXISTS health_meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  meal_at TEXT NOT NULL,
  meal_type TEXT NOT NULL DEFAULT 'unknown' CHECK (meal_type IN ('breakfast','lunch','dinner','snack','drink','pre_workout','post_workout','unknown')),
  description TEXT NOT NULL,
  calories_low INTEGER CHECK (calories_low IS NULL OR calories_low >= 0),
  calories_high INTEGER CHECK (calories_high IS NULL OR calories_high >= 0),
  calories_selected INTEGER CHECK (calories_selected IS NULL OR calories_selected >= 0),
  protein_low_g REAL CHECK (protein_low_g IS NULL OR protein_low_g >= 0),
  protein_high_g REAL CHECK (protein_high_g IS NULL OR protein_high_g >= 0),
  protein_selected_g REAL CHECK (protein_selected_g IS NULL OR protein_selected_g >= 0),
  confidence TEXT NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('low','medium','high','unknown')),
  assumptions TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'cli',
  source_ref TEXT,
  supersedes_id INTEGER UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (calories_low IS NULL OR calories_high IS NULL OR calories_low <= calories_high),
  CHECK (protein_low_g IS NULL OR protein_high_g IS NULL OR protein_low_g <= protein_high_g),
  CHECK (calories_selected IS NULL OR ((calories_low IS NULL OR calories_selected >= calories_low) AND (calories_high IS NULL OR calories_selected <= calories_high))),
  CHECK (protein_selected_g IS NULL OR ((protein_low_g IS NULL OR protein_selected_g >= protein_low_g) AND (protein_high_g IS NULL OR protein_selected_g <= protein_high_g))),
  FOREIGN KEY (supersedes_id) REFERENCES health_meals(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_health_meals_day ON health_meals(meal_at, status);
CREATE INDEX IF NOT EXISTS idx_health_meals_source_ref ON health_meals(source, source_ref);

CREATE TABLE IF NOT EXISTS health_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  effective_at TEXT NOT NULL,
  effective_day TEXT NOT NULL,
  weight_measurement_id INTEGER,
  energy INTEGER CHECK (energy IS NULL OR energy BETWEEN 1 AND 5),
  hunger INTEGER CHECK (hunger IS NULL OR hunger BETWEEN 1 AND 5),
  soreness INTEGER CHECK (soreness IS NULL OR soreness BETWEEN 1 AND 5),
  stress INTEGER CHECK (stress IS NULL OR stress BETWEEN 1 AND 5),
  training_intent TEXT,
  training_completed INTEGER CHECK (training_completed IS NULL OR training_completed IN (0,1)),
  nutrition_adherent INTEGER CHECK (nutrition_adherent IS NULL OR nutrition_adherent IN (0,1)),
  protein_target_met INTEGER CHECK (protein_target_met IS NULL OR protein_target_met IN (0,1)),
  steps_target_met INTEGER CHECK (steps_target_met IS NULL OR steps_target_met IN (0,1)),
  notes TEXT NOT NULL DEFAULT '',
  next_checkpoint_at TEXT,
  source TEXT NOT NULL DEFAULT 'cli',
  source_ref TEXT,
  supersedes_id INTEGER UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (weight_measurement_id) REFERENCES health_body_measurements(id) ON DELETE SET NULL,
  FOREIGN KEY (supersedes_id) REFERENCES health_checkins(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_health_checkins_day ON health_checkins(effective_day, status);

CREATE TABLE IF NOT EXISTS health_substance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  substance TEXT NOT NULL CHECK (substance IN ('alcohol','cannabis')),
  amount REAL CHECK (amount IS NULL OR amount >= 0),
  unit TEXT,
  standard_drinks REAL CHECK (standard_drinks IS NULL OR standard_drinks >= 0),
  thc_mg REAL CHECK (thc_mg IS NULL OR thc_mg >= 0),
  cbd_mg REAL CHECK (cbd_mg IS NULL OR cbd_mg >= 0),
  timing_context TEXT,
  context TEXT NOT NULL DEFAULT '',
  estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0,1)),
  source TEXT NOT NULL DEFAULT 'cli',
  source_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_health_substance_at ON health_substance_events(occurred_at, substance);

CREATE TABLE IF NOT EXISTS health_body_measurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  measured_at TEXT NOT NULL,
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg > 0),
  body_fat_pct REAL CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 0 AND 100),
  lean_mass_kg REAL CHECK (lean_mass_kg IS NULL OR lean_mass_kg > 0),
  waist_cm REAL CHECK (waist_cm IS NULL OR waist_cm > 0),
  context TEXT NOT NULL DEFAULT '',
  estimated INTEGER NOT NULL DEFAULT 0 CHECK (estimated IN (0,1)),
  source TEXT NOT NULL DEFAULT 'cli',
  external_id TEXT,
  source_payload TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_health_body_measured ON health_body_measurements(measured_at, deleted_at);

CREATE TABLE IF NOT EXISTS health_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  strain REAL CHECK (strain IS NULL OR strain >= 0),
  energy_kj REAL CHECK (energy_kj IS NULL OR energy_kj >= 0),
  energy_estimated INTEGER NOT NULL DEFAULT 1 CHECK (energy_estimated IN (0,1)),
  source_payload TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_health_workouts_started ON health_workouts(started_at, deleted_at);

CREATE TABLE IF NOT EXISTS health_workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL,
  external_id TEXT,
  exercise_template_id TEXT,
  title TEXT NOT NULL,
  exercise_order INTEGER NOT NULL CHECK (exercise_order >= 0),
  notes TEXT NOT NULL DEFAULT '',
  source_payload TEXT,
  UNIQUE (workout_id, external_id),
  UNIQUE (workout_id, exercise_order),
  FOREIGN KEY (workout_id) REFERENCES health_workouts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_health_exercises_template ON health_workout_exercises(exercise_template_id, workout_id);

CREATE TABLE IF NOT EXISTS health_workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL,
  external_id TEXT,
  set_order INTEGER NOT NULL CHECK (set_order >= 0),
  set_type TEXT NOT NULL DEFAULT 'normal' CHECK (set_type IN ('warmup','normal','failure','dropset','superset','rest_pause','other')),
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg >= 0),
  reps INTEGER CHECK (reps IS NULL OR reps >= 0),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  distance_meters REAL CHECK (distance_meters IS NULL OR distance_meters >= 0),
  rpe REAL CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  rir REAL CHECK (rir IS NULL OR rir BETWEEN 0 AND 10),
  target_reps_min INTEGER CHECK (target_reps_min IS NULL OR target_reps_min >= 0),
  target_reps_max INTEGER CHECK (target_reps_max IS NULL OR target_reps_max >= 0),
  completed INTEGER CHECK (completed IS NULL OR completed IN (0,1)),
  source_payload TEXT,
  UNIQUE (exercise_id, external_id),
  UNIQUE (exercise_id, set_order),
  CHECK (target_reps_min IS NULL OR target_reps_max IS NULL OR target_reps_min <= target_reps_max),
  FOREIGN KEY (exercise_id) REFERENCES health_workout_exercises(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS health_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('training','nutrition','recovery','checkin','general')),
  action TEXT NOT NULL,
  rationale TEXT NOT NULL,
  inputs_as_of TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','accepted','dismissed','expired','completed','review_needed')),
  expires_at TEXT,
  source TEXT NOT NULL DEFAULT 'trainer',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_health_recommendations_current ON health_recommendations(status, expires_at, created_at);

CREATE TABLE IF NOT EXISTS health_sync_state (
  source TEXT PRIMARY KEY,
  cursor TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  records_seen INTEGER NOT NULL DEFAULT 0,
  records_changed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- WHOOP per-metric provenance/freshness. Values may legitimately come from different days.
ALTER TABLE whoop_daily ADD COLUMN sleep_efficiency REAL;
ALTER TABLE whoop_daily ADD COLUMN sleep_need_hours REAL;
ALTER TABLE whoop_daily ADD COLUMN sleep_consistency REAL;
ALTER TABLE whoop_daily ADD COLUMN cycle_energy_kj REAL;
ALTER TABLE whoop_daily ADD COLUMN recovery_updated_at TEXT;
ALTER TABLE whoop_daily ADD COLUMN sleep_updated_at TEXT;
ALTER TABLE whoop_daily ADD COLUMN strain_updated_at TEXT;
