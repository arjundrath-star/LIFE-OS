-- Pokemon vending ops: market pricing + machine performance + purchase bridge.
-- Locked schema (docs/plans/pokemon-ops/PLAN.md §2). History-over-overwrite:
-- current state (stock, benchmark, active assignment) is derived by query.
-- All money integer cents; all timestamps UTC ISO-8601 TEXT.

-- Reference: one row per sellable pack type. Canonical-name rule: everything
-- references pk_products.id, never free-text set names.
CREATE TABLE IF NOT EXISTS pk_products (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  set_name       TEXT NOT NULL,
  form           TEXT NOT NULL DEFAULT 'booster'
                 CHECK (form IN ('booster','blister','tin_pack','slab','other')),
  display_name   TEXT NOT NULL,
  release_date   TEXT,
  tier           TEXT NOT NULL DEFAULT 'unknown'
                 CHECK (tier IN ('premium','mid','entry','slab','unknown')),
  reprint_status TEXT NOT NULL DEFAULT 'none'
                 CHECK (reprint_status IN ('none','announced','active')),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_products_set_name ON pk_products(set_name);

-- Domain 1: market pricing, append-only. Rows are never updated or deleted
-- (exception: the scanner may set alerted_at on its own rows).
-- listing_ref is '' not NULL: it is in the dedupe key and NULL-in-UNIQUE
-- silently disables dedupe (Learnings 2026-07-06).
CREATE TABLE IF NOT EXISTS pk_price_observations (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_date        TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN
                       ('carddistro','supplier_other','ebay_sold','ebay_active','tcgplayer',
                        'costco','target','walmart','sams','fb_marketplace','local_shop',
                        'amazon','retail_restock','other')),
  product_id           INTEGER NOT NULL REFERENCES pk_products(id),
  price_per_pack_cents INTEGER NOT NULL,
  lot_size             INTEGER,
  total_cost_cents     INTEGER,
  includes_shipping    INTEGER CHECK (includes_shipping IN (0,1)),
  includes_tax         INTEGER CHECK (includes_tax IN (0,1)),
  listing_ref          TEXT NOT NULL DEFAULT '',
  quantity_available   INTEGER,
  alerted_at           TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(source, listing_ref, observed_date, product_id)
);
CREATE INDEX IF NOT EXISTS idx_pk_price_observations_product
  ON pk_price_observations(product_id, source, observed_date);

-- Bridge: purchase lots. total_cost_cents includes tax+shipping; landed cost and
-- benchmark comparison are computed at insert time (lib/pokemon-ops/db.ts).
CREATE TABLE IF NOT EXISTS pk_purchase_lots (
  id                         INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_date              TEXT NOT NULL,
  source                     TEXT NOT NULL CHECK (source IN
                             ('carddistro','supplier_other','ebay_sold','ebay_active','tcgplayer',
                              'costco','target','walmart','sams','fb_marketplace','local_shop',
                              'amazon','retail_restock','other')),
  product_id                 INTEGER NOT NULL REFERENCES pk_products(id),
  pack_count                 INTEGER NOT NULL,
  total_cost_cents           INTEGER NOT NULL,
  landed_cost_per_pack_cents INTEGER NOT NULL,
  observation_id             INTEGER REFERENCES pk_price_observations(id),
  benchmark_price_cents      INTEGER,
  benchmark_delta_cents      INTEGER,
  status                     TEXT NOT NULL DEFAULT 'in_transit'
                             CHECK (status IN ('in_transit','received','allocated','depleted')),
  notes                      TEXT,
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Domain 2: machine performance. Price change / rotation = end old row + append new.
CREATE TABLE IF NOT EXISTS pk_sku_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id),
  slot_number INTEGER NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES pk_products(id),
  price_cents INTEGER NOT NULL,
  capacity    INTEGER NOT NULL,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_at    TEXT,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pk_sku_assignments_machine
  ON pk_sku_assignments(machine_id, ended_at);

-- audit_count rows carry the absolute counted stock in qty_delta and reset the
-- baseline; refill/shrink_adjust are deltas. Current stock per slot =
-- baseline-from-last-audit + sum of qty_delta since - sales since.
CREATE TABLE IF NOT EXISTS pk_stock_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id  INTEGER NOT NULL REFERENCES machines(id),
  slot_number INTEGER NOT NULL,
  event       TEXT NOT NULL CHECK (event IN ('refill','audit_count','shrink_adjust')),
  qty_delta   INTEGER NOT NULL,
  lot_id      INTEGER REFERENCES pk_purchase_lots(id),
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_pk_stock_events_machine_slot
  ON pk_stock_events(machine_id, slot_number, at);

-- Manual and Lynx/SQS rows share the table; the API hot-swap is a source swap.
-- external_txn_id '' not NULL (same NULL-in-UNIQUE rule); dedupe only applies to
-- API sources via the partial unique index below.
CREATE TABLE IF NOT EXISTS pk_sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id       INTEGER NOT NULL REFERENCES machines(id),
  slot_number      INTEGER NOT NULL,
  product_id       INTEGER NOT NULL REFERENCES pk_products(id),
  qty              INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  sold_at          TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('manual','csv','lynx','sqs')),
  external_txn_id  TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pk_sales_external_txn
  ON pk_sales(source, external_txn_id) WHERE source IN ('lynx','sqs');
CREATE INDEX IF NOT EXISTS idx_pk_sales_machine_sold_at
  ON pk_sales(machine_id, sold_at);

-- Idempotent-import receipts (pokemon_pipeline_sink_receipts pattern).
CREATE TABLE IF NOT EXISTS pk_import_receipts (
  sha256      TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rules output. UI and Telegram digest both read this; alerts are rows.
CREATE TABLE IF NOT EXISTS pk_recommendations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule         TEXT NOT NULL CHECK (rule IN
               ('refill_sync','price_raise','add_slot','dead_stock','refill_order',
                'sourcing_offer','nayax_drift')),
  machine_id   INTEGER REFERENCES machines(id),
  slot_number  INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','action','urgent')),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acked','done','dismissed')),
  alerted_at   TEXT
);

CREATE TABLE IF NOT EXISTS pk_config (
  k          TEXT PRIMARY KEY,
  v          TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT OR IGNORE INTO pk_config (k, v) VALUES
  ('refill_cycle_days', '30'),
  ('budget_cents', '120000'),
  ('alert_threshold_pct', '15'),
  ('min_margin_cents', '1000');

-- Mentor benchmark = latest carddistro observation per product (date, then id).
CREATE VIEW IF NOT EXISTS pk_v_benchmark_current AS
SELECT o.*
FROM pk_price_observations o
WHERE o.source = 'carddistro'
  AND o.id = (
    SELECT o2.id
    FROM pk_price_observations o2
    WHERE o2.source = 'carddistro' AND o2.product_id = o.product_id
    ORDER BY o2.observed_date DESC, o2.id DESC
    LIMIT 1
  );
