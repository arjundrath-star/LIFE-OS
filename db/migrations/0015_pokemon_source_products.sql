-- Dated sealed-product sourcing values derived from pack economics.
-- Accessories/promos carry no value: targets use only pack count × the lower
-- of current TCGplayer loose-pack market and Carddistro supplier cost.
CREATE TABLE IF NOT EXISTS pk_source_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pack_product_id INTEGER NOT NULL REFERENCES pk_products(id),
  tcgplayer_product_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  form TEXT NOT NULL,
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  tcgplayer_url TEXT NOT NULL,
  pack_count_source_url TEXT NOT NULL,
  pack_count_note TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS pk_source_product_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_product_id INTEGER NOT NULL REFERENCES pk_source_products(id),
  observed_date TEXT NOT NULL CHECK (observed_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  pack_count INTEGER NOT NULL CHECK (pack_count > 0),
  tcg_market_cents INTEGER CHECK (tcg_market_cents IS NULL OR tcg_market_cents >= 0),
  tcg_low_cents INTEGER CHECK (tcg_low_cents IS NULL OR tcg_low_cents >= 0),
  tcg_high_cents INTEGER CHECK (tcg_high_cents IS NULL OR tcg_high_cents >= 0),
  pack_tcg_cents INTEGER NOT NULL CHECK (pack_tcg_cents > 0),
  carddistro_cents INTEGER NOT NULL CHECK (carddistro_cents > 0),
  benchmark_ppp_cents INTEGER NOT NULL CHECK (
    benchmark_ppp_cents > 0
    AND benchmark_ppp_cents <= pack_tcg_cents
    AND benchmark_ppp_cents <= carddistro_cents
  ),
  low_total_cents INTEGER NOT NULL CHECK (low_total_cents >= 0),
  medium_total_cents INTEGER NOT NULL CHECK (medium_total_cents >= low_total_cents),
  high_total_cents INTEGER NOT NULL CHECK (high_total_cents >= medium_total_cents),
  methodology TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(source_product_id, observed_date),
  CHECK (high_total_cents < pack_count * pack_tcg_cents),
  CHECK (high_total_cents < pack_count * carddistro_cents)
);

CREATE INDEX IF NOT EXISTS idx_pk_source_products_pack_product
  ON pk_source_products(pack_product_id, active, form);
CREATE INDEX IF NOT EXISTS idx_pk_source_product_values_current
  ON pk_source_product_values(source_product_id, observed_date DESC, id DESC);

CREATE VIEW IF NOT EXISTS pk_v_source_product_current AS
SELECT
  sp.id AS source_product_id,
  sp.pack_product_id,
  p.set_name,
  sp.tcgplayer_product_id,
  sp.name,
  sp.form,
  v.pack_count,
  sp.tcgplayer_url,
  sp.pack_count_source_url,
  sp.pack_count_note,
  v.observed_date,
  v.tcg_market_cents,
  v.tcg_low_cents,
  v.tcg_high_cents,
  v.pack_tcg_cents,
  v.carddistro_cents,
  v.benchmark_ppp_cents,
  v.low_total_cents,
  v.medium_total_cents,
  v.high_total_cents,
  CAST(v.tcg_market_cents AS REAL) / v.pack_count AS tcg_market_ppp_cents,
  CAST(v.low_total_cents AS REAL) / v.pack_count AS low_ppp_cents,
  CAST(v.medium_total_cents AS REAL) / v.pack_count AS medium_ppp_cents,
  CAST(v.high_total_cents AS REAL) / v.pack_count AS high_ppp_cents,
  v.methodology
FROM pk_source_products sp
JOIN pk_products p ON p.id = sp.pack_product_id
JOIN pk_source_product_values v ON v.id = (
  SELECT v2.id
  FROM pk_source_product_values v2
  WHERE v2.source_product_id = sp.id
  ORDER BY v2.observed_date DESC, v2.id DESC
  LIMIT 1
)
WHERE sp.active = 1;
