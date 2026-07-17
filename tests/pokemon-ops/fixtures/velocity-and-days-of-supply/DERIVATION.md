# DERIVATION — velocity-and-days-of-supply

asOf = 2026-07-17T00:00:00.000Z. Default velocity window 14 days →
window = (2026-07-03T00:00:00.000Z, 2026-07-17T00:00:00.000Z].

## Slot 1 (Gamma)

Sales: g1 (07-02, qty 3) — BEFORE window start → out.
g2 (07-05, qty 4) and g3 (07-10, qty 3) — in → window units = 7.

velocity_slot1 = 7 / 14 = 0.5 units/day (exact binary).

Stock (no audit → baseline 0 over full history):
refill +20, total sales 3+4+3 = 10 → stock = 20 − 10 = 10.

dos_slot1 = 10 / 0.5 = 20 days.

sellout_slot1 = asOf + round(20 × 86,400,000 ms) = 2026-07-17 + 20 days.
July has 31 days: 17 + 20 = 37 → Aug (37 − 31) = 2026-08-06T00:00:00.000Z.

## Slot 2 (Delta)

No sales → velocity_slot2 = 0 / 14 = 0.
Stock = 5 > 0 with velocity 0 → daysOfSupply = Infinity → JSON null.
projectedSelloutDate → null.

## refillSyncSpread

Finite days-of-supply values among active slots: [20] (slot 2 is Infinity →
excluded). Fewer than 2 finite values → null.
