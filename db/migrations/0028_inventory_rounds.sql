-- Existing purchase lots have known costs. New lots may explicitly keep cost
-- pending while retaining the legacy NOT NULL integer columns: zero is only a
-- storage sentinel and cost_confirmed is the source of truth for interpretation.
ALTER TABLE pk_purchase_lots
  ADD COLUMN cost_confirmed INTEGER NOT NULL DEFAULT 1
  CHECK (cost_confirmed IN (0, 1));

-- Inventory purchase rounds are a mapping layer over canonical purchase lots.
-- Costs and quantities remain owned by pk_purchase_lots; machine allocation remains
-- owned by pk_stock_events.lot_id and sales remain owned by pk_sales.
CREATE TABLE IF NOT EXISTS pk_inventory_rounds (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  starts_on  TEXT NOT NULL CHECK (starts_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  ends_on    TEXT CHECK (ends_on IS NULL OR ends_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS pk_inventory_round_lots (
  round_id INTEGER NOT NULL REFERENCES pk_inventory_rounds(id) ON DELETE CASCADE,
  lot_id   INTEGER NOT NULL UNIQUE REFERENCES pk_purchase_lots(id) ON DELETE RESTRICT,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (round_id, lot_id)
);

CREATE INDEX IF NOT EXISTS idx_pk_inventory_round_lots_round
  ON pk_inventory_round_lots(round_id, lot_id);
