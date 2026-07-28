# PHASE 2 — Ingest: CRUD routes + CSV importers + smoke script

Goal: every table is writable through authed API routes and idempotent CSV imports, so
the operator can log the cycle-one buy (lots + observations) before the machine is live.

Context: PLAN.md §3 ingest-now; middleware auth is free for /api/*; existing importer
patterns: the CRM lead importer + sink receipts. Phase 1's db layer is the only
write path — routes must not hand-roll SQL.

Work:
1. Routes under `app/api/pokemon-ops/`: observations (create + list w/ filters
   product/source/date-range), lots (create incl. auto landed-cost + benchmark-delta
   computation + optional observation_id link; list; status transitions), sku-assignments
   (assign = end-old+append-new; list active + history), stock-events (refill/audit/
   shrink), sales (quick entry: "sold N of slot X since <ts>" with per-day attribution
   from timestamps; and single-sale), products (create/edit-tier), config (read/update).
2. CSV importers (multipart or path-based, consistent with existing patterns) for:
   benchmark/observation drops (the carddistro format + full observation format),
   bulk lots, bulk sales. All through pk_import_receipts fingerprinting; re-import of an
   identical file = no-op with a receipt hit.
3. `scripts/pokemon-ops-smoke.sh`: exercises every route with curl (auth via the repo's
   existing test/session pattern — do NOT weaken the allowlist), asserts status codes and
   response bodies, exercises double-import idempotency, exits non-zero on any failure.
4. Extend verify:pokemon-ops with route-level tests.

Out of scope: UI, metrics/rules, scanners, Nayax.

DoD:
- `npm run verify:pokemon-ops` → 0
- `bash scripts/pokemon-ops-smoke.sh` → 0
- importing seeds/carddistro-2026-07-17.csv twice → row counts identical both times
  (paste the two counts)
- build + restart healthy; tag `pokemon-ops/phase-2` pushed
