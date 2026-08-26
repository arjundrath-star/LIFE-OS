-- Secure, read-only vending provider ingestion. Credentials, raw provider payloads,
-- payment identifiers, card data, and uploaded files never belong in this schema.
-- Money is integer cents and timestamps are normalized UTC ISO-8601 TEXT.

CREATE TABLE IF NOT EXISTS vending_provider_accounts (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider            TEXT NOT NULL CHECK (provider IN ('nayax','vtm')),
  external_account_id TEXT NOT NULL DEFAULT 'default',
  display_name        TEXT NOT NULL,
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS vending_provider_sync_state (
  account_id       INTEGER PRIMARY KEY REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  last_attempt_at  TEXT,
  last_success_at  TEXT,
  last_status      TEXT NOT NULL DEFAULT 'never' CHECK (last_status IN ('never','running','success','failed','blocked')),
  last_error_code  TEXT,
  machines_seen    INTEGER NOT NULL DEFAULT 0,
  slots_seen       INTEGER NOT NULL DEFAULT 0,
  sales_seen       INTEGER NOT NULL DEFAULT 0,
  lease_token      TEXT,
  lease_expires_at TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE IF NOT EXISTS vending_provider_machine_mappings (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id                   INTEGER NOT NULL REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  provider_machine_external_id TEXT NOT NULL,
  provider_machine_name        TEXT,
  local_machine_id             INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  mapping_source               TEXT NOT NULL DEFAULT 'unmapped' CHECK (mapping_source IN ('external_id','exact_name','manual','unmapped')),
  first_seen_at                TEXT NOT NULL,
  last_seen_at                 TEXT NOT NULL,
  UNIQUE(account_id, provider_machine_external_id)
);
CREATE INDEX IF NOT EXISTS idx_vending_provider_machine_local
  ON vending_provider_machine_mappings(local_machine_id);

CREATE TABLE IF NOT EXISTS vending_provider_products (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id                   INTEGER NOT NULL REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  provider_product_external_id TEXT NOT NULL,
  product_name                 TEXT,
  active                       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  first_seen_at                TEXT NOT NULL,
  last_seen_at                 TEXT NOT NULL,
  inactive_at                  TEXT,
  UNIQUE(account_id, provider_product_external_id)
);
CREATE INDEX IF NOT EXISTS idx_vending_provider_products_active
  ON vending_provider_products(account_id, active, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS vending_provider_slot_snapshots (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id                   INTEGER NOT NULL REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  machine_mapping_id           INTEGER REFERENCES vending_provider_machine_mappings(id) ON DELETE SET NULL,
  provider_product_id          INTEGER REFERENCES vending_provider_products(id) ON DELETE SET NULL,
  provider_machine_external_id TEXT NOT NULL,
  provider_slot_external_id    TEXT NOT NULL,
  machine_product_external_id  TEXT,
  provider_product_external_id TEXT,
  operator_button_code         TEXT,
  mdb_code                     TEXT,
  dex_product_name             TEXT,
  product_name                 TEXT,
  cash_price_cents             INTEGER CHECK (cash_price_cents IS NULL OR cash_price_cents >= 0),
  credit_card_price_cents      INTEGER CHECK (credit_card_price_cents IS NULL OR credit_card_price_cents >= 0),
  machine_price_cents          INTEGER CHECK (machine_price_cents IS NULL OR machine_price_cents >= 0),
  price_cents                  INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  quantity                     INTEGER CHECK (quantity IS NULL OR quantity >= 0),
  par                          INTEGER CHECK (par IS NULL OR par >= 0),
  missing_stock_by_mdb         INTEGER CHECK (missing_stock_by_mdb IS NULL OR missing_stock_by_mdb >= 0),
  missing_stock_by_dex         INTEGER CHECK (missing_stock_by_dex IS NULL OR missing_stock_by_dex >= 0),
  selection_vend_out_bit       INTEGER CHECK (selection_vend_out_bit IS NULL OR selection_vend_out_bit IN (0,1)),
  provider_last_updated_at     TEXT,
  active                       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  inactive_at                  TEXT,
  snapshot_at                  TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  UNIQUE(account_id, provider_machine_external_id, provider_slot_external_id)
);
CREATE INDEX IF NOT EXISTS idx_vending_provider_slots_mapping
  ON vending_provider_slot_snapshots(machine_mapping_id);
CREATE INDEX IF NOT EXISTS idx_vending_provider_slots_active
  ON vending_provider_slot_snapshots(account_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS vending_provider_sales (
  id                           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id                   INTEGER NOT NULL REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  machine_mapping_id           INTEGER REFERENCES vending_provider_machine_mappings(id) ON DELETE SET NULL,
  external_sale_id             TEXT NOT NULL,
  provider_machine_external_id TEXT NOT NULL,
  provider_machine_name        TEXT,
  provider_account_label       TEXT,
  provider_slot_external_id    TEXT,
  provider_product_external_id TEXT,
  product_name                 TEXT,
  quantity                     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents             INTEGER CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  total_cents                  INTEGER NOT NULL CHECK (total_cents >= 0),
  authorization_cents          INTEGER CHECK (authorization_cents IS NULL OR authorization_cents >= 0),
  settlement_cents             INTEGER CHECK (settlement_cents IS NULL OR settlement_cents >= 0),
  cost_price_cents             INTEGER CHECK (cost_price_cents IS NULL OR cost_price_cents >= 0),
  retail_price_cents           INTEGER CHECK (retail_price_cents IS NULL OR retail_price_cents >= 0),
  currency                     TEXT NOT NULL DEFAULT 'USD' CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  authorization_at             TEXT,
  machine_authorization_at     TEXT,
  settlement_at                TEXT,
  sold_at                      TEXT NOT NULL,
  order_status                 TEXT,
  source_import_sha256         TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  UNIQUE(account_id, external_sale_id)
);
CREATE INDEX IF NOT EXISTS idx_vending_provider_sales_sold_at
  ON vending_provider_sales(account_id, sold_at);
CREATE INDEX IF NOT EXISTS idx_vending_provider_sales_mapping
  ON vending_provider_sales(machine_mapping_id, sold_at);

CREATE TABLE IF NOT EXISTS vending_provider_sync_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id       INTEGER NOT NULL REFERENCES vending_provider_accounts(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('api','xlsx','converted_csv')),
  source_sha256    TEXT,
  status           TEXT NOT NULL CHECK (status IN ('running','success','failed','blocked')),
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  machines_seen    INTEGER NOT NULL DEFAULT 0,
  slots_seen       INTEGER NOT NULL DEFAULT 0,
  sales_seen       INTEGER NOT NULL DEFAULT 0,
  sales_changed    INTEGER NOT NULL DEFAULT 0,
  unmapped_records INTEGER NOT NULL DEFAULT 0,
  error_code       TEXT,
  UNIQUE(account_id, mode, source_sha256)
);
CREATE INDEX IF NOT EXISTS idx_vending_provider_runs_account
  ON vending_provider_sync_runs(account_id, started_at DESC);
