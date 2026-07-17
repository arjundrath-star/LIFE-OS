# DERIVATION — dead-stock-trigger

asOf = 2026-07-17T00:00:00.000Z. Dead-stock window = (asOf − 21 days, asOf]
= (2026-06-26T00:00:00.000Z, 2026-07-17T00:00:00.000Z].

Slot 1 (Theta): stock = 10 − 2 = 8 > 0. Only sale t1 at 2026-06-20T12:00 —
BEFORE the window start → zero sales in window → FIRES (severity info).

last_sale_at = 2026-06-20T12:00:00.000Z.
days_since_last_sale = (2026-07-17T00:00 − 2026-06-20T12:00) / 1 day.
06-20T12:00 → 07-17T00:00 = 10 days to July 1 minus 12 h + 16 days
= 26 days 12 h = 26.5 days (raw double, exact binary).

Other rules: velocity window (2026-07-03, 2026-07-17] has no sales → velocity 0,
stock 8 > 0 → dos = Infinity → price_raise cannot trigger (Infinity is never
< 15). refill_sync: 0 finite-dos slots → null. refill_order: no observations →
Theta skipped (no fresh source) → items empty → not emitted.

evaluated = 4, emitted = 1, skipped_duplicates = 0.
