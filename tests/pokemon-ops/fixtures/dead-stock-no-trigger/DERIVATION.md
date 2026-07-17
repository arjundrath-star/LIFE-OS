# DERIVATION — dead-stock-no-trigger (sale on day 20)

asOf = 2026-07-17T00:00:00.000Z. Dead-stock window
= (2026-06-26T00:00:00.000Z, 2026-07-17T00:00:00.000Z].

Slot 1 (Theta): stock = 10 − 2 = 8 > 0. Sale t1 at 2026-06-27T12:00 is 19.5
days before asOf — INSIDE the window (06-27T12:00 > 06-26T00:00) → dead_stock
does NOT trigger.

Other rules: t1 is outside the 14-day velocity window (06-27 < 07-03 start) →
velocity 0 → dos Infinity → no price_raise. refill_sync: 0 finite slots → null.
refill_order: no observations → nothing.

evaluated = 4, emitted = 0, skipped_duplicates = 0; recommendations empty.
