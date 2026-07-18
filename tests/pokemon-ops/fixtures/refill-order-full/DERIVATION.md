# DERIVATION — refill-order-full ($1,200 budget)

asOf = 2026-07-17T00:00:00.000Z. Config defaults: budget_cents 120000,
min_margin_cents 1000, refill_cycle_days 30 (→ price_raise threshold 15).
Velocity window = (2026-07-03, 2026-07-17]. Freshness cutoff date =
date(asOf − 30 days) = 2026-06-17 (observations with observed_date ≥ 2026-06-17
are fresh; older are ignored).

## Slot stats (stock = refill − sales; velocity = window units / 14)

| slot | product | refill | sold | stock | velocity | dos = stock/vel | capacity | need |
|---|---|---|---|---|---|---|---|---|
| 1 | Set One   | 60 | 28 | 32 | 28/14 = 2   | 16 | 60 | 28 |
| 2 | Set Two   | 31 | 14 | 17 | 14/14 = 1   | 17 | 40 | 23 |
| 3 | Set Three | 32 | 14 | 18 | 14/14 = 1   | 18 | 20 | 2  |
| 4 | Set Four  | 33 | 14 | 19 | 14/14 = 1   | 19 | 30 | 11 |
| 5 | Set Five  | 18 | 7  | 11 | 7/14 = 0.5  | 22 | 80 | 69 |

All sales are on 2026-07-10 (inside every window).

## Non-firing rules

- refill_sync: spread = 22 − 16 = 6 ≤ 7 → no.
- price_raise: every dos (16,17,18,19,22) ≥ 15 → no.
- dead_stock: every slot sold on 07-10 → no.

## refill_order — source selection per product

Freshest observation per actionable source, drop sources older than 2026-06-17,
pick cheapest (tie: newer date, then source name ASC). TCGplayer and eBay sold
are valuation indicators and never participate as buy sources; Carddistro remains
an actionable supplier quote:

- Set One: carddistro 2026-07-01 @900 (fresh), tcgplayer 2026-06-20 @850
  (fresh), ebay_sold 2026-05-10 @700 (STALE → ignored despite being cheapest).
  → carddistro @900. Margin = 2000 − 900 = 1100 ≥ 1000 → keep.
  Benchmark (latest eligible TCGplayer, any age) = 850 → delta = 900 − 850 = +50.
- Set Two: carddistro 2026-07-05 @1000, ebay_sold 2026-07-01 @950 (both fresh)
  → carddistro @1000. Margin = 1400 − 1000 = 400 < 1000 → SKIP below_min_margin.
- Set Three: only local_shop 2026-06-01 @700 → stale → SKIP no_fresh_observation.
- Set Four: carddistro 2026-06-25 @800, costco 2026-07-12 @750 (both fresh)
  → costco @750. Margin = 1800 − 750 = 1050 ≥ 1000 → keep.
  No TCGplayer or eBay sold observation → benchmark delta = null.
- Set Five: carddistro 2026-07-01 @1600, ebay_sold 2026-07-08 @1500, amazon
  2026-07-08 @1500. eBay sold is excluded as an indicator; amazon @1500 wins.
  Margin = 2500 − 1500 = 1000 = min_margin exactly → KEPT (skip only when
  strictly below). eBay sold fallback benchmark = 1500 → delta = 0.

## Greedy budget walk (order: min dos ASC → Set One 16, Set Two 17,
## Set Three 18, Set Four 19, Set Five 22)

Start remaining = 120000.

1. Set One: qty = min(28, floor(120000/900) = 133) = 28.
   Line = 28 × 900 = 25200. Remaining = 120000 − 25200 = 94800.
2. Set Two: skipped (below_min_margin, recorded).
3. Set Three: skipped (no_fresh_observation, recorded).
4. Set Four: qty = min(11, floor(94800/750) = 126) = 11.
   Line = 11 × 750 = 8250. Remaining = 94800 − 8250 = 86550.
5. Set Five: qty = min(69, floor(86550/1500) = 57) = 57 — BUDGET-CAPPED
   (need 69, can only afford 57). Line = 57 × 1500 = 85500.
   Remaining = 86550 − 85500 = 1050.

spent = 120000 − 1050 = 118950 (check: 25200 + 8250 + 85500 = 118950).

evaluated = 4, emitted = 1 (refill_order only), skipped_duplicates = 0.
