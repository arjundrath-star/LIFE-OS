# DERIVATION — price-raise-trigger

asOf = 2026-07-17T00:00:00.000Z; velocity window = (2026-07-03, 2026-07-17].
Config defaults: refill_cycle_days 30 → threshold = 30 × 50/100 = 15 days.

Slot 1 (Eta): h1 (07-10, qty 14) in window → velocity = 14/14 = 1.
Stock = 24 − 14 = 10. dos = 10/1 = 10.

price_raise: 10 < 15 → FIRES. Payload: current price 1200, suggested
1200+100 = 1300 .. 1200+200 = 1400, dos 10, threshold 15, velocity 1, stock 10.

add_slot: capacity check — active slots = {1}; lowest unassigned in 1..8 = 2 →
candidate_slot 2, kind "unassigned", candidate dos null. FIRES alongside.

refill_sync: only 1 finite-dos slot → spread null → no trigger.
dead_stock: sale on 07-10 inside 21-day window → no trigger.
refill_order: no observations → nothing.

evaluated = 4, emitted = 2 (add_slot, price_raise), skipped_duplicates = 0.
