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

Freshest observation per source, drop sources older than 2026-06-17, pick
cheapest (tie: newer date, then source name ASC):

- Set One: carddistro 2026-07-01 @900 (fresh), tcgplayer 2026-06-20 @850
  (fresh), ebay_sold 2026-05-10 @700 (STALE → ignored despite being cheapest).
  → tcgplayer @850. Margin = 2000 − 850 = 1150 ≥ 1000 → keep.
  Benchmark (latest carddistro, any age) = 900 → delta = 850 − 900 = −50.
- Set Two: carddistro 2026-07-05 @1000, ebay_sold 2026-07-01 @950 (both fresh)
  → ebay_sold @950. Margin = 1400 − 950 = 450 < 1000 → SKIP below_min_margin.
- Set Three: only local_shop 2026-06-01 @700 → stale → SKIP no_fresh_observation.
- Set Four: carddistro 2026-06-25 @800, costco 2026-07-12 @750 (both fresh)
  → costco @750. Margin = 1800 − 750 = 1050 ≥ 1000 → keep.
  Benchmark 800 → delta = 750 − 800 = −50.
- Set Five: carddistro 2026-07-01 @1600, ebay_sold 2026-07-08 @1500, amazon
  2026-07-08 @1500. Cheapest = 1500 tie between ebay_sold and amazon; same
  observed_date → source name ASC: "amazon" < "ebay_sold" → amazon @1500.
  Margin = 2500 − 1500 = 1000 = min_margin exactly → KEPT (skip only when
  strictly below). Benchmark 1600 → delta = 1500 − 1600 = −100.

## Greedy budget walk (order: min dos ASC → Set One 16, Set Two 17,
## Set Three 18, Set Four 19, Set Five 22)

Start remaining = 120000.

1. Set One: qty = min(28, floor(120000/850) = 141) = 28.
   Line = 28 × 850 = 23800. Remaining = 120000 − 23800 = 96200.
2. Set Two: skipped (below_min_margin, recorded).
3. Set Three: skipped (no_fresh_observation, recorded).
4. Set Four: qty = min(11, floor(96200/750) = 128) = 11.
   Line = 11 × 750 = 8250. Remaining = 96200 − 8250 = 87950.
5. Set Five: qty = min(69, floor(87950/1500) = 58) = 58 — BUDGET-CAPPED
   (need 69, can only afford 58). Line = 58 × 1500 = 87000.
   Remaining = 87950 − 87000 = 950.

spent = 120000 − 950 = 119050 (check: 23800 + 8250 + 87000 = 119050).

evaluated = 4, emitted = 1 (refill_order only), skipped_duplicates = 0.
