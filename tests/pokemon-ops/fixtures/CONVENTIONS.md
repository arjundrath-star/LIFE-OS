# Golden fixture conventions — pokemon-ops metrics + rules

Every convention, constant, rounding rule, and tie-break the engine uses. A blind
re-deriver reading ONLY this file plus a case's `inputs.json` must be able to
reproduce that case's `expected.json` exactly. No case-specific numbers appear here.

Code under test: `lib/pokemon-ops/metrics.ts` and `lib/pokemon-ops/rules.ts`.

## Fixture layout

Each case directory contains:

- `inputs.json` — complete synthetic DB content + `asOf` + the queries/rules runs
  to execute.
- `expected.json` — exact expected output (hand-computed).
- `DERIVATION.md` — the hand arithmetic behind every expected number.

## inputs.json format

```
{
  "asOf": ISO-8601 UTC timestamp — the "now" threaded into every computation,
  "config": { optional pk_config overrides; defaults (seeded by migration 0011):
              refill_cycle_days=30, budget_cents=120000, alert_threshold_pct=15,
              min_margin_cents=1000 },
  "machines": [{ "name" }],
  "products": [{ "set_name", "form", "tier" }],
  "observations": [{ "ref", "product", "observed_date" (YYYY-MM-DD), "source",
                     "price_per_pack_cents" }],
  "lots": [{ "ref", "product", "purchase_date", "source", "pack_count",
             "total_cost_cents", "status" }],
  "assignments": [{ "machine", "slot_number", "product", "price_cents",
                    "capacity", "assigned_at" }],
  "stock_events": [{ "machine", "slot_number", "event", "qty_delta", "at" }],
  "sales": [{ "ref", "machine", "slot_number", "product", "qty",
              "unit_price_cents", "sold_at" }],
  "queries": [{ "name", "fn", ...args }]   (optional),
  "rules": { "runs": N }                    (optional; omit for metrics-only cases)
}
```

Rows are inserted in file order, per table, in the order the tables are listed
above. Cross-references use names/refs, not ids. Observation `ref` doubles as the
row's `listing_ref`. Lot `landed_cost_per_pack_cents` is computed at insert as
`Math.round(total_cost_cents / pack_count)`.

## expected.json format (= normalized runner output)

```
{
  "queries": { <query name>: <value> },          (present iff inputs has queries)
  "runs": [ { "evaluated", "emitted", "skipped_duplicates" }, ... per run ],
  "recommendations": [ { "rule", "machine_id", "slot_number", "severity",
                         "status", "payload" } ]  (present iff inputs has rules)
}
```

Normalization: every numeric id is replaced by its human name/ref, keeping the
key name — `machine_id` → machine name, `product_id` → set_name, `lot_id` → lot
ref, `sale_id` → sale ref, `observation_id` → observation ref. `Infinity`
serializes as JSON `null`. The recommendations list contains EVERY
`pk_recommendations` row after the last run, sorted by rule name ascending
(`add_slot` < `dead_stock` < `price_raise` < `refill_order` < `refill_sync`),
then `slot_number` (null sorts as 0), then insertion order.

## Global conventions

- **Money** is integer cents everywhere. The only money division points are
  documented per-metric below, each with explicit `Math.round` (JS semantics:
  half away from zero for positives) or `Math.floor`.
- **Time**: all timestamps UTC ISO-8601; 1 day = 86,400,000 ms exactly (no DST).
  A trailing window of N days ending at `asOf` is the half-open interval
  `(asOf − N days, asOf]`: a sale exactly AT the window start is EXCLUDED, a
  sale exactly at `asOf` is INCLUDED.
- **Rates/durations** (velocity, days of supply, spreads, days-since-last-sale)
  are raw IEEE doubles, never rounded. Fixtures only use values that are exact
  in binary (e.g. .5, .25 fractions), so exact JSON equality is well-defined.
- **Current stock** per slot: baseline from the latest `audit_count` event
  (absolute count in `qty_delta`), plus Σ refill/shrink_adjust deltas after it,
  minus Σ sales qty after it. No audit → baseline 0 over full history. Stock is
  computed over the FULL event history (no asOf cutoff; fixture DBs contain no
  rows after asOf).

## Metrics

- **FIFO allocation** (per product, global across machines):
  - Lots ordered `purchase_date` ASC, then id ASC (= file order within equal
    dates). Only lots with `status != 'in_transit'` participate (an in-transit
    lot has not arrived; its packs cannot have been sold). `received`,
    `allocated`, `depleted` all participate — allocation is a historical replay.
  - Sales ordered `sold_at` ASC, then id ASC. Each sale of qty N consumes the
    next N available packs, splitting across lot boundaries.
  - Margin per pack = `unit_price_cents − landed_cost_per_pack_cents` of the lot
    the pack drew from. A sale's `margin_cents` = Σ over its units.
  - Units beyond total lot supply are "unallocated": costed at 0 (they add
    `unit_price_cents` each to margin) and counted in `unallocated_qty`.
  - Output per sale: `{ sale_id, machine_id, slot_number, sold_at, qty,
    unit_price_cents, allocations: [{ lot_id, qty, landed_cost_per_pack_cents }],
    margin_cents, unallocated_qty }`.
- **marginPerSlotDay(machine, slot, windowDays, asOf)** — PRIMARY KPI:
  `Math.round( Σ margin_cents of sales attributed to that (machine, slot) in
  the window / windowDays )`. Sale margins come from the product-level FIFO
  allocation; attribution is the slot on the sale row. Integer cents/day; the
  final division is the only rounding point.
- **velocity(machine, slot, asOf, windowDays)**: Σ sale qty in window /
  windowDays. Default windowDays = 14 (constant, not config). Raw double.
- **daysOfSupply(machine, slot, asOf, windowDays=14)**: currentStock / velocity.
  Stock ≤ 0 → 0 (checked before velocity). Velocity 0 with stock > 0 →
  `Infinity` (→ JSON null). Raw double otherwise.
- **projectedSelloutDate**: `asOf + Math.round(daysOfSupply × 86,400,000 ms)`
  as ISO string; `null` when daysOfSupply is Infinity.
- **refillSyncSpread(machine, asOf, windowDays=14)**: max − min of daysOfSupply
  over the machine's slots with an ACTIVE assignment, FINITE values only
  (Infinity slots excluded). Fewer than 2 finite values → `null`.
- **totalInvested()**: Σ `total_cost_cents` over ALL purchase lots, all-time,
  every status included (in_transit and depleted count).
- **benchmarkDeltaSeries(product)**: all observations (every source, carddistro
  included), ordered `observed_date` ASC then id ASC. Each point carries the
  benchmark current at its date: the carddistro observation with the max
  `observed_date ≤` the point's date, ties on date broken by max id (same-date
  carddistro rows count, regardless of relative id). No such row → benchmark
  and delta are `null`. `benchmark_delta_cents = price − benchmark` (negative =
  cheaper than the mentor list).

## Rules engine (`runRules(asOf)`)

Config read from pk_config: `refill_cycle_days`, `budget_cents`,
`min_margin_cents`. (`alert_threshold_pct` is the sourcing-alert threshold and
is NOT used by any of these rules.)

Engine constants (`RULE_CONSTANTS`):

| constant | value |
|---|---|
| REFILL_SYNC_SPREAD_DAYS | 7 |
| DEAD_STOCK_DAYS | 21 |
| SELLOUT_THRESHOLD_PCT | 50 |
| PRICE_RAISE_MIN_CENTS | 100 |
| PRICE_RAISE_MAX_CENTS | 200 |
| ADD_SLOT_MIN_SUPPLY_DAYS | 21 |
| OBSERVATION_MAX_AGE_DAYS | 30 |
| MACHINE_SLOT_COUNT | 8 |
| VELOCITY_WINDOW_DAYS | 14 |
| RULES_PER_MACHINE | 4 |

Machines evaluated: every machine with ≥ 1 active SKU assignment.
`evaluated` = machine count × RULES_PER_MACHINE (refill_sync,
price_raise/add_slot, dead_stock, refill_order count as one evaluation each per
machine, regardless of how many recommendations they emit).

Per-slot stats used by every rule: current stock, velocity (14-day window),
days of supply — all as defined above.

- **refill_sync** (machine-level; `slot_number` null; severity `action`):
  fires when refillSyncSpread (finite slots only, ≥ 2 required) is STRICTLY
  greater than 7. Payload: `{ spread_days, threshold_days: 7, slots: [per
  active slot, slot_number ASC: { slot_number, product_id, set_name,
  days_of_supply (null if Infinity), velocity_units_per_day, current_stock }],
  suggestion: { raise_price_slot: <slot with MIN finite days_of_supply>,
  lower_price_or_rotate_slot: <slot with MAX finite days_of_supply> } }`.
  Ties on min/max: lowest slot_number.
- **price_raise** (per slot; severity `action`): fires when days of supply is
  STRICTLY below `refill_cycle_days × 50 / 100` (with the default 30-day cycle:
  < 15; exactly 15 does NOT trigger). Infinity never triggers; 0 (stock 0)
  does. Payload: `{ product_id, set_name, days_of_supply, threshold_days,
  velocity_units_per_day, current_stock, current_price_cents,
  suggested_price_min_cents: current + 100, suggested_price_max_cents:
  current + 200 }`.
- **add_slot** (per fast slot; severity `action`): emitted IN ADDITION to each
  price_raise when capacity allows. Candidate preference: (1) the
  lowest-numbered slot in 1..8 with no active assignment (`candidate_kind:
  "unassigned"`, `candidate_days_of_supply: null`); else (2) the OTHER assigned
  slot with the highest days of supply, if ≥ 21 days (Infinity qualifies and
  outranks any finite value; ties → lowest slot_number) — `candidate_kind:
  "rotate"`, `candidate_days_of_supply` = that value (null if Infinity). No
  candidate → no add_slot row. The rec's `slot_number` is the FAST slot.
  Payload: `{ product_id, set_name, fast_slot, fast_days_of_supply,
  candidate_slot, candidate_kind, candidate_days_of_supply }`.
- **dead_stock** (per slot; severity `info`): fires when current stock > 0 and
  there are ZERO sales for that (machine, slot) in `(asOf − 21 days, asOf]`
  (a sale exactly at the cutoff is OUTSIDE the window and does not save the
  slot; any sale strictly inside does). No assignment-age gate: a fresh
  assignment with stock and no sales in the window triggers. Payload:
  `{ product_id, set_name, current_stock, window_days: 21, last_sale_at
  (latest sold_at ≤ asOf, else null), days_since_last_sale ((asOf − last)/day,
  raw double; null if never sold), suggestion: "rotate_to_mystery" }`.
- **refill_order** (machine-level; `slot_number` null; severity `action`):
  1. Group the machine's active slots by product: `need` = Σ max(0,
     capacity − stock) over the product's slots; ordering key = MIN days of
     supply across its slots (Infinity last), tie → lowest slot number;
     `price` used for margin = LOWEST active assignment price for the product
     on this machine. Products with need = 0 are omitted entirely.
  2. Source per product: freshest observation per source (max observed_date,
     tie → max id); drop sources whose freshest observation has
     `observed_date < date(asOf − 30 days)` (an observation EXACTLY 30 days
     old is still fresh; comparison on YYYY-MM-DD strings). Among the fresh
     ones pick the cheapest `price_per_pack_cents`; ties → most recent
     observed_date, then source name ascending alphabetically. All sources
     participate, carddistro included. The observation price IS the expected
     landed cost per pack (includes_shipping / includes_tax ignored in v1).
     No fresh source → product recorded in `skipped` with reason
     `"no_fresh_observation"`.
  3. Margin gate: `expected_margin_per_pack_cents = price − unit_cost`. If
     STRICTLY below `min_margin_cents` → recorded in `skipped` with reason
     `"below_min_margin"` (plus source, unit_cost_cents, price_cents, margin).
     Exactly at the minimum is kept.
  4. Greedy budget walk in the order from step 1, starting from
     `budget_cents`: `qty = min(need, Math.floor(remaining / unit_cost))`;
     qty ≤ 0 → product silently omitted; otherwise emit an item and subtract
     `qty × unit_cost` from remaining.
  5. Item fields: `{ product_id, set_name, slot_numbers (insertion order),
     need, days_of_supply (product min; null if Infinity), qty, source,
     observed_date, unit_cost_cents, line_total_cents,
     expected_margin_per_pack_cents, benchmark_delta_cents (unit_cost −
     current benchmark = latest carddistro observation any age; null if
     none) }`.
  6. Payload: `{ budget_cents, spent_cents, remaining_cents, items, skipped }`
     with items in walk order and skipped in walk order. Emitted ONLY when
     `items` is non-empty (skipped-only results emit nothing).

**Dedupe**: before insert, a candidate is dropped (counted in
`skipped_duplicates`) when an OPEN recommendation row exists with the same
`(rule, machine_id, slot_number)` — payload differences do NOT reopen. Non-open
rows (acked/done/dismissed) do not block.

Emission order within a machine (affects only ids): refill_sync, then per-slot
(slot ASC) price_raise then its add_slot, then dead_stock (slot ASC), then
refill_order.
