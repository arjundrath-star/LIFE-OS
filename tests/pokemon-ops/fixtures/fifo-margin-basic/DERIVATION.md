# DERIVATION — fifo-margin-basic

## Landed costs (Math.round(total_cost_cents / pack_count))

- lotC: 5000 / 5  = 1000 c/pack — status in_transit → EXCLUDED from FIFO.
- lotA: 8000 / 10 = 800 c/pack — received → included.
- lotB: 10000 / 10 = 1000 c/pack — received → included.

FIFO lot order (purchase_date ASC, id ASC, in_transit dropped): lotA (10 packs), lotB (10 packs).

## FIFO walk (sales sold_at ASC)

Sale price is 1500 c on every sale.

1. s1 (qty 6): draws 6 from lotA (lotA remaining 10 → 4).
   margin = 6 × (1500 − 800) = 6 × 700 = 4200. unallocated 0.
2. s2 (qty 6): draws 4 from lotA (lotA → 0), then 2 from lotB (lotB 10 → 8).
   margin = 4 × (1500 − 800) + 2 × (1500 − 1000) = 2800 + 1000 = 3800. unallocated 0.
3. s3 (qty 3): draws 3 from lotB (lotB → 5).
   margin = 3 × (1500 − 1000) = 1500. unallocated 0.

## totalInvested

Σ total_cost_cents over ALL lots (every status, in_transit included):
5000 + 8000 + 10000 = 23000.

## benchmarkDeltaSeries (Alpha)

Observations in (observed_date, id) ASC order. Benchmark at date D = carddistro
row with max observed_date ≤ D (tie: max id).

| obs | date | source | price | benchmark current at date | delta |
|---|---|---|---|---|---|
| o1 | 2026-05-20 | tcgplayer | 850 | none before 05-20 → null | null |
| o2 | 2026-06-01 | carddistro | 900 | o2 itself (≤ 06-01) → 900 | 900 − 900 = 0 |
| o3 | 2026-06-05 | ebay_sold | 800 | o2 → 900 | 800 − 900 = −100 |
| o4 | 2026-06-10 | carddistro | 950 | o4 itself → 950 | 0 |
| o5 | 2026-06-15 | ebay_sold | 1000 | o4 → 950 | 1000 − 950 = +50 |
