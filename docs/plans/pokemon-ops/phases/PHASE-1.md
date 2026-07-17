# PHASE 1 — Schema 0011 + data layer + seeds + verify harness

Goal: the locked two-domain + bridge schema lands as migration
`db/migrations/0011_pokemon_ops.sql`, with a typed data layer, seed data, and the standing
`npm run verify:pokemon-ops` gate that every later phase extends.

Context: PLAN.md §2 is the LOCKED schema — implement it exactly (tables, columns, enums,
uniques, the '' -not-NULL rule for listing_ref/external_txn_id, append-only semantics).
PROJECT_CONTEXT.md §7–8 for rationale. Discovery §1 for migration conventions
(auto-apply on boot, `_migrations` tracking, additive-only). Machine facts (fill from
prompt): MACHINE_SLOT_CONFIG=<from Arjun>, REFILL_CYCLE_DAYS=<from Arjun, else 14>.

Work:
1. Migration 0011: pk_products, pk_price_observations, pk_sku_assignments,
   pk_stock_events, pk_sales, pk_import_receipts, pk_purchase_lots, pk_recommendations,
   view pk_v_benchmark_current (latest carddistro observation per product), and a small
   pk_config kv (refill_cycle_days=14 default, budget_cents=120000,
   alert_threshold_pct=15, min_margin_cents=1000). Indexes on the query paths
   (observations by product+source+date; sales by machine+sold_at; assignments by
   machine+ended_at).
2. `lib/pokemon-ops/types.ts` + `lib/pokemon-ops/db.ts`: typed insert/query functions,
   including the IMMEDIATE-transaction write helpers external CLIs will reuse.
3. Ensure Fixture Corner Store exists in `machines` (extend additively only if its columns
   cannot hold venue/name; discovery says check first) and record machine 1 facts.
4. Seed script `scripts/pokemon-ops-seed.ts` (idempotent): pk_products from the 15
   carddistro items (canonical set names; Mystery Slab form=slab tier=slab;
   Destined Rivals + Prismatic Evolutions reprint_status=active; Ascended Heroes
   announced) plus Storm Emerald (release 2026-07-31, premium); then import
   `docs/plans/pokemon-ops/seeds/carddistro-2026-07-17.csv` into pk_price_observations
   through the same code path Phase 2's importer will use (write the importer core here,
   Phase 2 wraps it in routes).
5. `npm run verify:pokemon-ops`: migrate idempotency + all pokemon-ops unit tests + build.
   Tests: round-trip inserts; stock-event math incl. audit_count baseline reset;
   benchmark view returns latest-by-date; UNIQUE dedupe works and the NULL-in-UNIQUE
   regression cases (inserting '' twice rejects; proving NULL would not) are covered;
   seed twice → identical row counts.

Out of scope: API routes, UI, metrics/rules, anything Nayax.

DoD:
- `npm run verify:pokemon-ops` → exit 0
- `npm run migrate` twice → second run applies nothing
- `sqlite3 data/rathworkspace.db "select count(*) from pk_price_observations where source='carddistro'"` → 15
- `sqlite3 data/rathworkspace.db "select count(*) from pk_products"` → 16
- build + restart healthy; tag `pokemon-ops/phase-1` pushed
