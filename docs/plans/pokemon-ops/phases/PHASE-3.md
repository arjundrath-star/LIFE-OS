# PHASE 3 — Metrics + rules engine + daily tick

Goal: the decision layer. Pure deterministic functions (no LLM) computing every derived
metric and emitting pk_recommendations, golden-fixture tested so it is verifiable with
zero live machine data.

Context: PLAN.md §3 rules engine + §2 "derived only" list. The defaults encode the
operator's merchandising heuristics. Ultracode-recommended phase.

Work:
1. `lib/pokemon-ops/metrics.ts`: margin per pack (FIFO lot allocation per product),
   margin $/slot/day per SKU (primary KPI), velocity (trailing window, config), days of
   supply per slot, projected sellout date, refill-sync spread, total invested,
   benchmark-delta series per product/source over time.
2. `lib/pokemon-ops/rules.ts` emitting pk_recommendations (dedupe: don't reopen an
   identical open rec):
   - refill_sync: days-of-supply spread over threshold → slot-reallocation/price-nudge
     payload targeting equalized sellout at the refill visit.
   - price_raise/add_slot: projected sellout < 50% of refill_cycle_days.
   - dead_stock: no sales in 21 days → rotate-to-mystery payload.
   - refill_order: given budget_cents, velocities, days-of-supply gaps, and the freshest
     observation per product per source, output an exact shopping list (product, qty,
     source, expected landed cost, expected margin, benchmark delta) as payload_json.
3. Daily scheduler tick `tickPokemonOpsRules` in server/scheduler.ts (house pattern) +
   on-demand `POST /api/pokemon-ops/rules/run`.
4. Golden fixtures in `tests/pokemon-ops/fixtures/`: synthetic 30-day sales histories
   with HAND-COMPUTED expected outputs (document the arithmetic in the fixture files);
   trigger and non-trigger cases per rule; one full refill-order run against a fixed
   fixture budget with expected list. Assert EXACT values.

Out of scope: UI, alert delivery (Phase 5 reads pk_recommendations), scanners, Nayax.

DoD:
- `npm run verify:pokemon-ops` → 0 (fixtures assert exact expected values)
- `curl -s -X POST localhost:3000/api/pokemon-ops/rules/run` (authed per smoke pattern)
  → 200 and ≥1 recommendation row from fixture-seeded dev data
- build + restart healthy; tag `pokemon-ops/phase-3` pushed
