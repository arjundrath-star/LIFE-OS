# DERIVATION — refill-sync-no-trigger (boundary: spread exactly at threshold)

asOf = 2026-07-17T00:00:00.000Z; velocity window = (2026-07-03, 2026-07-17].

Slot 1 (Iota): 14 units in window → velocity 1. Stock = 30 − 14 = 16.
dos = 16/1 = 16.
Slot 2 (Kappa): 14 units in window → velocity 1. Stock = 37 − 14 = 23.
dos = 23/1 = 23.

refill_sync: spread = 23 − 16 = 7. Rule requires STRICTLY > 7 → 7 does NOT
trigger (this is the boundary case).

price_raise: dos 16 and 23 are both ≥ 15 → no trigger.
dead_stock: both slots sold on 07-10 (inside 21-day window) → no trigger.
refill_order: no observations → nothing emitted.

evaluated = 4, emitted = 0, skipped_duplicates = 0; recommendations empty.
