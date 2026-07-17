# DERIVATION — refill-sync-trigger

asOf = 2026-07-17T00:00:00.000Z; velocity window = (2026-07-03, 2026-07-17].
Config defaults: refill_cycle_days 30 → price_raise threshold = 30 × 50/100 = 15.

## Slot stats

Slot 1 (Epsilon): sales e1 (07-06, 14) + e2 (07-12, 14) both in window → 28 units.
velocity = 28/14 = 2. Stock = 38 − 28 = 10. dos = 10/2 = 5.

Slot 2 (Zeta): z1 (07-08, 7) in window → velocity = 7/14 = 0.5.
Stock = 17 − 7 = 10. dos = 10/0.5 = 20.

## refill_sync

Finite dos = [5, 20] → spread = 20 − 5 = 15 > 7 → FIRES (severity action,
machine-level, slot_number null). Fastest slot (min dos) = 1 → raise_price_slot;
slowest (max dos) = 2 → lower_price_or_rotate_slot.

## price_raise / add_slot

Slot 1: dos 5 < 15 → price_raise. Suggested price = 1600 + 100 .. 1600 + 200
= 1700..1800.
add_slot candidate: slots 1..8, active = {1,2} → lowest unassigned = 3 →
candidate_kind "unassigned", candidate_days_of_supply null.
Slot 2: dos 20 ≥ 15 → no trigger.

## dead_stock

Both slots sold within (2026-06-26, 2026-07-17] → no trigger.

## refill_order

No price observations at all → both products skipped (no_fresh_observation) →
item list empty → NOT emitted.

## Totals

evaluated = 1 machine × 4 rules = 4. emitted = 3 (add_slot, price_raise,
refill_sync). skipped_duplicates = 0.
Recommendation list order: rule ASC → add_slot, price_raise, refill_sync.
