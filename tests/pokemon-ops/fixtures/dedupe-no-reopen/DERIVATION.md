# DERIVATION — dedupe-no-reopen

Inputs identical to price-raise-trigger (see that case's derivation: slot 1 has
velocity 1, stock 10, dos 10 < 15 → price_raise + add_slot candidates, nothing
else fires). runRules executes TWICE at the same asOf.

Run 1: no open recommendations exist → both candidates insert.
→ { evaluated: 4, emitted: 2, skipped_duplicates: 0 }.

Run 2: the same two candidates are produced, but an OPEN row already exists for
each (rule, machine_id, slot_number) key — (price_raise, Fixture Machine, 1)
and (add_slot, Fixture Machine, 1) → both are dropped by dedupe.
→ { evaluated: 4, emitted: 0, skipped_duplicates: 2 }.

Final table: exactly the 2 rows from run 1 (payloads as derived in
price-raise-trigger).
