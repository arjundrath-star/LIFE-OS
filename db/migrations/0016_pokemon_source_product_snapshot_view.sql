-- Existing databases already applied 0015. Recreate the read model so dated
-- pack counts come from the immutable valuation snapshot rather than mutable
-- catalog metadata.
DROP VIEW IF EXISTS pk_v_source_product_current;

CREATE VIEW pk_v_source_product_current AS
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
