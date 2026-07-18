-- Pokemon Ops benchmark policy: external market indicators only.
-- TCGplayer market observations are primary. eBay sold observations are used
-- only when a product has no eligible TCGplayer observation. Carddistro remains
-- an importable supplier/mentor quote and never defines the benchmark.

DROP VIEW IF EXISTS pk_v_benchmark_current;
CREATE VIEW pk_v_benchmark_current AS
SELECT o.*
FROM pk_price_observations o
WHERE o.source IN ('tcgplayer', 'ebay_sold')
  AND o.id = (
    SELECT o2.id
    FROM pk_price_observations o2
    WHERE o2.product_id = o.product_id
      AND o2.source IN ('tcgplayer', 'ebay_sold')
    ORDER BY
      CASE o2.source WHEN 'tcgplayer' THEN 0 ELSE 1 END,
      o2.observed_date DESC,
      o2.id DESC
    LIMIT 1
  );

-- Correct every historical lot snapshot to the external indicator that was
-- eligible on its purchase date. A TCGplayer observation on/before that date
-- outranks every eBay sold observation; eBay sold is the date-local fallback.
-- If neither existed yet, both snapshot fields correctly become NULL.
UPDATE pk_purchase_lots AS l
SET benchmark_price_cents = (
      SELECT o.price_per_pack_cents
      FROM pk_price_observations o
      WHERE o.product_id = l.product_id
        AND o.observed_date <= l.purchase_date
        AND o.source IN ('tcgplayer', 'ebay_sold')
      ORDER BY
        CASE o.source WHEN 'tcgplayer' THEN 0 ELSE 1 END,
        o.observed_date DESC,
        o.id DESC
      LIMIT 1
    ),
    benchmark_delta_cents = CASE
      WHEN EXISTS (
        SELECT 1
        FROM pk_price_observations o
        WHERE o.product_id = l.product_id
          AND o.observed_date <= l.purchase_date
          AND o.source IN ('tcgplayer', 'ebay_sold')
      ) THEN l.landed_cost_per_pack_cents - (
        SELECT o.price_per_pack_cents
        FROM pk_price_observations o
        WHERE o.product_id = l.product_id
          AND o.observed_date <= l.purchase_date
          AND o.source IN ('tcgplayer', 'ebay_sold')
        ORDER BY
          CASE o.source WHEN 'tcgplayer' THEN 0 ELSE 1 END,
          o.observed_date DESC,
          o.id DESC
        LIMIT 1
      )
      ELSE NULL
    END;
