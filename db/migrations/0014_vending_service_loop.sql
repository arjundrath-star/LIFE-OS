-- Additive vending service/audit loop. Physical audit_count events remain stock truth.
ALTER TABLE machines ADD COLUMN asset_code TEXT;
ALTER TABLE machines ADD COLUMN condition TEXT NOT NULL DEFAULT 'operational'
  CHECK (condition IN ('operational','service_required','out_of_order','retired'));
ALTER TABLE machines ADD COLUMN manufacturer TEXT;
ALTER TABLE machines ADD COLUMN model TEXT;
ALTER TABLE machines ADD COLUMN position_notes TEXT;
ALTER TABLE machines ADD COLUMN access_notes TEXT;
ALTER TABLE machines ADD COLUMN last_inspected_at TEXT;
ALTER TABLE machines ADD COLUMN archived_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_machines_asset_code ON machines(asset_code) WHERE asset_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS vending_service_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  actor_email TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  condition_before TEXT NOT NULL CHECK (condition_before IN ('operational','service_required','out_of_order','retired')),
  condition_after TEXT NOT NULL CHECK (condition_after IN ('operational','service_required','out_of_order','retired')),
  cash_collected_cents INTEGER CHECK (cash_collected_cents IS NULL OR cash_collected_cents >= 0),
  counter_before INTEGER CHECK (counter_before IS NULL OR counter_before >= 0),
  counter_after INTEGER CHECK (counter_after IS NULL OR counter_after >= 0),
  notes TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  snapshot_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS vending_service_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id INTEGER NOT NULL REFERENCES vending_service_visits(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  slot_number INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES pk_products(id),
  previous_calculated_stock INTEGER NOT NULL,
  physical_sellable_remaining INTEGER NOT NULL CHECK (physical_sellable_remaining >= 0),
  removed_damaged INTEGER NOT NULL DEFAULT 0 CHECK (removed_damaged >= 0),
  refill_quantity INTEGER NOT NULL DEFAULT 0 CHECK (refill_quantity >= 0),
  resulting_verified_stock INTEGER NOT NULL CHECK (resulting_verified_stock >= 0),
  inferred_dispensed_quantity INTEGER NOT NULL CHECK (inferred_dispensed_quantity >= 0),
  sale_price_cents INTEGER,
  refill_unit_cost_cents INTEGER,
  source_lot_id INTEGER REFERENCES pk_purchase_lots(id),
  estimated_revenue_cents INTEGER,
  estimated_cost_cents INTEGER,
  estimated_profit_cents INTEGER,
  count_correction INTEGER NOT NULL DEFAULT 0 CHECK (count_correction IN (0,1)),
  UNIQUE(visit_id, slot_number)
);

CREATE TABLE IF NOT EXISTS vending_machine_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  visit_id INTEGER REFERENCES vending_service_visits(id),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_by_email TEXT,
  resolved_at TEXT,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_service_visits_machine_completed ON vending_service_visits(machine_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_visits_idempotency_binding ON vending_service_visits(idempotency_key, machine_id, actor_email, request_fingerprint);
CREATE INDEX IF NOT EXISTS idx_service_lines_visit ON vending_service_lines(visit_id);
CREATE INDEX IF NOT EXISTS idx_machine_issues_open ON vending_machine_issues(machine_id, status, severity);
