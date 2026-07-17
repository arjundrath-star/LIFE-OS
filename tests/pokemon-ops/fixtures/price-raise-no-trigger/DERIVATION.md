# DERIVATION — price-raise-no-trigger (boundary: dos exactly at threshold)

Identical to price-raise-trigger except the refill is 29 packs.

Slot 1 (Eta): velocity = 14/14 = 1. Stock = 29 − 14 = 15. dos = 15/1 = 15.

price_raise threshold = 30 × 50/100 = 15; rule requires dos STRICTLY < 15 →
exactly 15 does NOT trigger (documented > vs ≥ boundary: no emission at the
threshold). No add_slot either (it only accompanies a price_raise).

refill_sync: 1 finite slot → null. dead_stock: sale inside window. refill_order:
no observations.

evaluated = 4, emitted = 0, skipped_duplicates = 0; recommendations empty.
