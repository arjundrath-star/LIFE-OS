# DERIVATION — alerts-digest

Phase 5 fixture: message assembly for `scripts/pokemon-ops-alerts.sh` (immediate
mode + `--digest`). asOf = 2026-07-17T00:00:00.000Z. Default `pk_config`
(alert_threshold_pct = 15) is unchanged.

Seed order matters: ids below are the autoincrement ids a fresh temp DB
assigns in the exact order `tests/pokemon-ops/alerts-fixture-seed.ts` inserts
rows (loadInputs' machines/products/observations/lots/assignments/
stock_events/sales, then this fixture's own `recommendations` section).

## Recommendations (pk_recommendations)

| id | rule | severity | alerted_at | in pending? |
|----|------|----------|------------|-------------|
| 1 | price_raise | action | NULL | YES — open, actionable, unalerted |
| 2 | dead_stock | info | NULL | no — info severity never alerts |
| 3 | add_slot | action | 2026-07-16T00:00:00.000Z (pre-seeded) | no — already alerted |

Only id 1 appears in `pending`. Message renders from its payload
(`set_name` Alpha, `days_of_supply` 10, `threshold_days` 15, `current_price_cents`
1200 → $12.00, `suggested_price_min_cents` 1300 → $13.00, `suggested_price_max_cents`
1400 → $14.00), plus the recommendation row's own `machine_id` (→ "Fixture
Machine") and `slot_number` (1).

## Sourcing observations (pk_price_observations)

Benchmark (carddistro): id 1, `bench1`, 2026-07-15, price 1000 (=$10.00). This
is `pk_v_benchmark_current` for Alpha (only carddistro row for the product).

threshold = `alert_threshold_pct` 15 → fires when `price <= benchmark × (1 −
15/100)` = `1000 × 0.85` = 850.

| id | ref | source | price | vs 850 | fires? |
|----|-----|--------|-------|--------|--------|
| 2 | good1 | ebay_active | 800 | 800 ≤ 850 | YES |
| 3 | meh1 | tcgplayer | 900 | 900 > 850 | no |

`beats_pct` for id 2 = `(1 − 800/1000) × 100` = 20.0% (exact in floating
point up to the usual binary-fraction noise; `.toFixed(1)` → "20.0"). id 3 is
excluded by the SQL filter entirely (900 > 850) so it never reaches the
beats_pct computation — this is "beating benchmark by <15%: no alert" from the
build brief (900 is 10% below 1000, under the 15% bar).

carddistro rows are excluded from the sourcing-alert query by `source !=
'carddistro'` regardless of price, so the benchmark row itself (id 1) can
never alert — this is the fixture's "1 carddistro (no alert)" case.

## expected-immediate.txt

Alerts array is recs first, then observations (CLI's own emission order), so:

```
DRY kind=rec id=1 :: [PRICE_RAISE] Fixture Machine slot 1: Alpha days-of-supply 10d is below 15d: raise price from $12.00 to $13.00-$14.00
DRY kind=obs id=2 :: SOURCING: Alpha at $8.00 from ebay_active beats benchmark $10.00 by 20.0%
```

## expected-digest.txt

KPIs come from `pokemonOpsSnapshot(asOf)` (lib/pokemon-ops/snapshot.ts), same
engine as the dashboard:

- **Margin**: one lot (`lot1`, carddistro, received, pack_count 24,
  total_cost_cents 19200 → landed_cost_per_pack_cents = round(19200/24) = 800).
  One sale (`h1`, qty 14, unit_price_cents 1200, sold 2026-07-10T12:00, inside
  the 14-day window (2026-07-03, 2026-07-17]). FIFO draws all 14 units from
  lot1 at 800 each: margin_cents = 14 × (1200 − 800) = 5600.
  marginPerSlotDay = round(5600 / 14) = 400 = **$4.00/slot/day** (only one
  active slot, so the machine total equals the one slot's value).
- **Total invested**: Σ total_cost_cents over all lots = 19200 = **$192.00**.
- **Sell-through (30d)**: sold in the trailing 30d window ending asOf = 14
  (h1); stocked (refill qty_delta) in the same window = 24 (the one refill
  event). 14 / 24 × 100 = 58.333...% → `.toFixed(1)` = **58.3%**.
- **Days-of-supply spread**: only one active assignment (slot 1) on the
  machine, and refillSyncSpread requires ≥ 2 finite days-of-supply values →
  **null → "n/a"**.
- **Open recommendations**: all 3 seeded rows have `status = 'open'`
  regardless of `alerted_at` (alerting doesn't change status) → 2 action (recA,
  recC) + 1 info (recB) + 0 urgent = **3 total**.
- **Best fresh sourcing offer**: among non-carddistro observations with
  `observed_date >= asOf − 30d` (both good1 and meh1 qualify, both dated
  2026-07-16), the cheapest is good1 at 800. Benchmark is bench1 at 1000.
  `(1000 − 800) / 1000 × 100` = 20.0%, direction "below" since 800 ≤ 1000 →
  "Alpha: $8.00 from ebay_active (benchmark $10.00, 20.0% below)".
