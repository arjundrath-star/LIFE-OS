# BUILD_PLAN_PROPOSAL — Pokemon Card Vending Ops System

Date: 2026-07-17. Companion to `SYSTEM_DISCOVERY.md`. Design only; no code written.

---

## 1. Architecture

**Verdict: extend the existing stack. No new stack is justified.** rathworkspace already provides SQLite + migrations, a scheduler/WebSocket data plane, Google-allowlisted auth, panel conventions, an agent-event build harness, and a sibling Pokemon CRM. Hermes already provides the `pokemon-scout` profile, skill format, cron scheduler, and Telegram delivery. Everything below slots into those.

```
                    ┌─ rathworkspace (Next.js, 127.0.0.1:3000, Cloudflare tunnel) ─┐
 manual entry UI ──▶│  app/(dash)/pokemon-ops/          components/panels/          │
 CSV upload ───────▶│  app/api/pokemon-ops/*            PokemonOpsPanel             │
                    │            │                            ▲                     │
                    │            ▼                            │ useLiveData         │
                    │  lib/pokemon-ops/  (db fns, metrics, rules engine)            │
                    │            │                            │                     │
                    │            ▼                            │                     │
                    │  SQLite data/rathworkspace.db ──▶ scheduler tick ──▶ WS hub   │
                    │  (migration 0011: pk_* tables)   (tickPokemonOps,             │
                    │            ▲                      later tickNayax)            │
                    └────────────┼──────────────────────────────────────────────────┘
                                 │ IMMEDIATE txns (two-writer rule)
        ┌────────────────────────┼──────────────────────┐
        │ Hermes cron script job │                      │ alert cron (bash curl)
        │ agents/pokemon-sourcing-scout/                │ Telegram → Arjun
        │ (eBay/TCGplayer/retail-restock scans)         │
        └───────────────────────────────────────────────┘
```

### DB (migration `0011_pokemon_ops.sql`, additive)

All tables prefixed `pk_` to sit beside the CRM's `pokemon_*` without collision. History-over-overwrite per the `rathworkspace-data` skill: current state is derived by query, not mutated in place.

- **`pk_products`** — pack-type catalog: set name, product form (booster, blister, ETB pack), display name. One row per sellable pack type.
- **`pk_purchase_lots`** — source (ebay | target | costco | local_shop | mentor | other), purchase_date, product_id FK, pack_count, total_cost_cents (tax + shipping included), landed_cost_per_pack_cents (stored, computed at insert), benchmark_price_cents at time of purchase, benchmark_delta_cents, status (in_transit | received | allocated | depleted), notes.
- **`pk_benchmarks`** — mentor supplier price list: product_id, price_per_pack_cents, effective_date. Append rows on each list update; current = latest per product.
- **`pk_sku_assignments`** — machine_id FK `machines`, slot_number (1–8 on VTM Mini Wall), product_id, price_cents, capacity, assigned_at, ended_at NULL while active. Reassignment/price change = end old row + append new (full pricing history preserved for the rules engine).
- **`pk_stock_events`** — machine_id, slot_number, event (refill | audit_count | shrink_adjust), qty_delta, lot_id NULL-able (which lot the packs came from), at. Current stock per slot = Σ(qty_delta) − sales since. Physical count on a service visit = `audit_count` event that resets the baseline.
- **`pk_sales`** — machine_id, slot_number, product_id, qty, unit_price_cents, sold_at, source (manual | csv | lynx | sqs), external_txn_id (nullable; store '' not NULL — it's in the dedupe key, and NULL-in-UNIQUE silently disables dedupe, per Learnings 2026-07-06), UNIQUE(source, external_txn_id) partial for source='lynx'. Manual and Lynx rows share one table; the hot-swap is a source swap, not a schema change.
- **`pk_import_receipts`** — file fingerprint, row counts, imported_at (copies the `pokemon_pipeline_sink_receipts` pattern; makes every CSV import idempotent).
- **`pk_sourcing_offers`** — scanner output: source (ebay_sold | ebay_active | tcgplayer | retail_restock), product_id, offer_price_per_pack_cents, total_price_cents, quantity, url, seen_at, benchmark_delta_cents, alerted_at NULL until Telegram fires, dedupe key on (source, url/listing id).
- **`pk_recommendations`** — rules-engine output: rule (refill_sync | price_raise | add_slot | dead_stock | refill_order), machine_id, slot_number NULL-able, payload_json (e.g. the full shopping list), severity, created_at, status (open | acked | done | dismissed). The UI and the Telegram digest both read this table; alerts are rows, so they're auditable and never double-sent.

**Not stored:** margin per pack, margin $/slot/day, velocity, days of supply, projected sellout. All computed in SQL/TS from the tables above (`lib/pokemon-ops/metrics.ts`) — single source of truth, no sync bugs.

**Expenses ledger:** purchase lots roll up into a "total invested" figure; a small export keeps `vending/finance/rath-vending-expenses.csv` semantics (SQLite becomes the source of truth for pokemon spend, CSV stays for the holding-company view).

### Ingest layer

- **Now (v1):** panel forms → `app/api/pokemon-ops/*` routes (auth free via middleware) for lots, benchmark updates, SKU assignments, refills, and quick sales entry ("sold N of slot X since last check" — computes per-day attribution from timestamps). CSV import route for bulk sales/lots using `pk_import_receipts`.
- **Later (Lynx):** `tickNayax` in `server/scheduler.ts` every 15 min — pulls per-machine transactions since last cursor (kv table), maps Nayax product/selection codes → `pk_sku_assignments` via a mapping kept in the machine config, inserts `pk_sales` with `source='lynx'` + external_txn_id dedupe. A backfill command (`npm run backfill-nayax -- --from ...`) reuses the same mapper. Manual entry stays available (fallback when the reader is offline). Nayax creds live in `~/.config/rathworkspace/secrets.env`; a `ConnectionDef` in `lib/connections/registry.ts` gives 3-state health on the connections panel.
- **Stretch (SQS):** a scheduler tick doing short `ReceiveMessage` batches on the Nayax SQS queue (outbound HTTPS, fits the no-inbound-ports constraint; no resident consumer daemon on this 2-core box). Writes the same `pk_sales` table; Lynx polling drops to hourly reconciliation.

### Metrics + rules engine

`lib/pokemon-ops/rules.ts` — pure deterministic functions, no LLM. Run by a daily scheduler tick and on-demand via API:

1. **Refill sync**: compute days-of-supply per SKU; when spread exceeds threshold, emit slot-reallocation / price-nudge recommendation to equalize sellout dates with the refill visit.
2. **Dynamic pricing trigger**: projected sellout < 50% of refill cycle → recommend price raise or extra slot.
3. **Dead stock**: no sales in 21 days → recommend rotate to mystery slot.
4. **Refill order generator**: given budget (default $1,200), current velocities, days-of-supply gaps, and best current sourcing offers (benchmark vs `pk_sourcing_offers`), output an exact shopping list (product, qty, source, expected landed cost, expected margin) as a `refill_order` recommendation payload.

Every rule is unit-tested against golden fixtures (synthetic sales histories with known correct outputs) so the engine is verifiable without a live machine.

### Dashboard plugin

New nav entry `pokemon-ops` (sits next to `pokemon-crm`), page `app/(dash)/pokemon-ops/page.tsx` on `ProjectPage`, panel(s) under `components/panels/`. WS channel `pokemon_ops` broadcast by a 60s `tickPokemonOps` snapshot (KPI band: **margin $/slot/day** primary, total invested, sell-through, days-of-supply spread; SKU/slot table with per-slot velocity + projected sellout; open recommendations; recent sales; sourcing-offer feed; entry forms). Cyan Jarvis theme per `rathworkspace-ui`; numbers in JetBrains Mono.

### Hermes sourcing skills

New agent dir `rathworkspace/agents/pokemon-sourcing-scout/` copying the lead-scout dispatcher architecture (deterministic Python scrapers + optional agentic phase, archive + idempotency + `agent_event.sh` built in), plus a Hermes skill `~/.hermes/skills/business/pokemon-sourcing-scout/SKILL.md` under the existing `pokemon-scout` profile:

- **eBay scan** (daily): sold + active listings for target sets, compute $/pack, write `pk_sourcing_offers` (IMMEDIATE txns via a small CLI like the existing `agent-event`). eBay Browse API if a developer key is provisioned (human checklist); otherwise the scraper path the lead-scout already uses via the headless-Chrome/CDP setup.
- **TCGplayer market prices** (daily): market price per target product as the "fair value" line next to the mentor benchmark. TCGplayer's own API keys are effectively closed to new operators; primary path is scraping their market-price pages, with pokemontcg.io / tcgcsv.com as backup structured sources — dealer's choice at build time based on which is stable.
- **Retail restock watch** (2026 reprint wave: Destined Rivals, Prismatic Evolutions at Target/Costco/Sam's): agentic Hermes phase checking stock-tracker sources + retailer pages, since this is fuzzy web work, not a stable API. MSRP restocks are the cheapest sourcing channel, so alerts fire immediately, not in the digest.
- **Alerting**: offers beating benchmark by threshold → Telegram via the gateway (`deliver: origin`); scheduled off-peak from the existing 09:00 / 10:30 / 23:45 jobs (single Codex credential). A separate tiny OS-cron bash script (curl pattern from `hermes-codex-watchdog.sh`) sends rules-engine alerts/digest so deterministic alerts don't depend on Hermes at all.

---

## 2. Phased build plan

Each phase = one autonomous session, no mid-session human input, machine-verifiable DoD. Every phase ends: all DoD commands green → commit + push → tag `pokemon-ops/phase-N` → `PROGRESS.md` updated → `agent-event` lifecycle emitted (per repo `AGENTS.md`). Every phase starts by re-running the previous phase's DoD as pre-flight.

### Human setup checklist (do once, before Phase 6/7 land; nothing else needs you)

1. **Nayax** (during onboarding this month): (a) make sure VTM registers the card reader under **your own operator account** in Nayax Core, not the distributor's, and give you a Core login with operator-admin rights plus the reader's device serial; (b) once you can log in, generate your **User Token** yourself (Core → username top-right → Account Settings → Security and Login → User Tokens → Show Token) — that token IS the API credential; paste it into `~/.config/rathworkspace/secrets.env` as `NAYAX_LYNX_TOKEN` (plus `NAYAX_DEVICE_SERIAL`); (c) ask for roles **Transaction Dispatcher** and **Transactions Report Subscriber** on your Core user (needed later for SQS); (d) ask VTM whether the Mini Wall's controller has its **DEX port wired to the Nayax unit** (yes = machine-audited stock counts; no = still fine, sales-decrement stock works). For the SQS stretch goal you'd also create an AWS account + SQS queue + IAM keys and paste them into Core's Transactions Report tab — defer until Phase 8 is actually wanted.
2. **eBay**: create a developer account at developer.ebay.com and generate a production keyset (Browse API is free-tier); paste as `EBAY_*` keys. If you skip this, Phase 6 falls back to scraping — works, but brittler.
3. **Mentor price list**: drop the supplier's current price list as a CSV (any columns; Phase 2's importer is told the format in its spec) at `~/rathworkspace/data/imports/mentor-benchmark.csv`, and re-drop when he updates it.
4. **Machine config facts** (answer in `phases/PHASE-1.md` prompt before launching it): slot count vs SKU count on your VTM Mini Wall config, per-slot capacity, planned refill visit cadence for Fixture Corner Store.
5. Confirm `sudo systemctl restart rathworkspace` works passwordless for build sessions (it has in prior sessions; verify once).

### Phase 0 — Repo hygiene (blocker removal)
Commit untracked migration 0010, resolve the two dirty files (commit or revert with justification in the commit message), merge `feature/pokemon-crm-mvp` → `main` (it's 0 behind, merge is clean fast-forward-able), make `main` the checked-out prod branch, restart service.
**DoD:** `git status --short` empty on `main`; `git log origin/main..main` empty (pushed); `npm run migrate` idempotent (no-op); `npm run build` exits 0; `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/health-or-signin` returns 200/302/307; tag `pokemon-ops/phase-0`.

### Phase 1 — Schema + data layer + verify harness
Migration `0011_pokemon_ops.sql` (tables above), `lib/pokemon-ops/{db,types}.ts`, seed script for `pk_products` (initial target sets), golden-fixture directory `tests/pokemon-ops/fixtures/`, and **`npm run verify:pokemon-ops`** — the standing gate that runs migrate + all pokemon-ops tests + build. Unit tests: insert/derive round-trips, stock-event math, the NULL-in-UNIQUE dedupe regression cases.
**DoD:** `npm run verify:pokemon-ops` exits 0; migration applies then re-applies as no-op; tag.

### Phase 2 — Ingest: API routes + CSV import
CRUD routes for lots / benchmarks / SKU assignments / stock events / manual sales; CSV importers (mentor benchmark, bulk sales, bulk lots) with `pk_import_receipts` idempotency; a `scripts/pokemon-ops-smoke.sh` that exercises every route with curl (session-cookie or a test bypass consistent with existing test patterns) and asserts responses.
**DoD:** `verify:pokemon-ops` green (now including route tests); smoke script exits 0; importing the same CSV twice yields identical row counts; tag.

### Phase 3 — Metrics + rules engine
`lib/pokemon-ops/metrics.ts` + `rules.ts` + daily scheduler tick writing `pk_recommendations`. Golden-fixture tests: synthetic 30-day sales histories with hand-computed expected outputs for margin $/slot/day, days of supply, projected sellout, each rule's trigger/non-trigger cases, and a full refill-order generation against a $1,200 budget.
**DoD:** fixture tests assert exact expected values; `verify:pokemon-ops` green; tag.

### Phase 4 — Dashboard tab
Nav entry, page, panels, forms, WS channel `pokemon_ops` + `tickPokemonOps`, API snapshot route. Puppeteer E2E (pattern already in repo; remember `page.evaluate(el.click())` for row handlers): load page authed, assert KPI band renders fixture-derived numbers, create a lot via the form, assert it appears; screenshot saved as artifact.
**DoD:** `npm run build` 0; E2E exits 0 with screenshot at a spec'd path; service restarts healthy; tag.

### Phase 5 — Alerts + daily digest
`scripts/pokemon-ops-alerts.sh` (bash + curl Telegram pattern) sending new open recommendations and a morning digest; OS-cron entries; `--dry-run` mode printing the exact payload for tests.
**DoD:** dry-run output matches fixture expectations; one real test message delivered (assert Telegram API `ok:true` in response JSON); cron entries present in `crontab -l`; tag.

### Phase 6 — Sourcing scanner (Hermes)
`agents/pokemon-sourcing-scout/` (dispatcher + Python scrapers for eBay + TCGplayer-or-backup + retail-restock agentic phase), Hermes skill dir, `hermes cron` job registration (off-peak slot), offers → `pk_sourcing_offers` via IMMEDIATE-tx CLI, threshold alerts.
**DoD:** scraper unit tests against recorded fixture pages exit 0; a live run writes ≥1 offer row and re-running is idempotent; `hermes cron list` shows the job enabled; sourcing feed renders on the tab; tag.

### Phase 7 — Lynx poller (needs checklist item 1 done)
`lib/sources/nayax/` client (Bearer token, prod base `https://lynx.nayax.com/operational`; the full OpenAPI spec + doc pages are already saved at `workspace/vending/pokemon/nayax-docs/` — copy into the phase's fixtures). Startup resolution: `GET /v1/devices/{serial}/machine` → store MachineID in `kv`. `tickNayax` (15 min): `GET /v1/machines/{id}/lastSales` → insert `pk_sales` with `source='lynx'`, dedupe on `TransactionID` (the endpoint has **no date-range or pagination**, so frequent-poll + dedupe is the design, and polling can't backfill history — pre-API history stays manual/CSV); `GET .../machineProducts` hourly → reconcile Nayax `MissingStockByMDB`/`PAR`/`last_sale_dt` against our `pk_stock_events` math and surface drift as a recommendation; `GET .../status` → machine-health tile (`LastKeepAliveDateTime`, `QTYSoldSinceLastVisitOnlineSales`). MDB-code → `pk_sku_assignments` mapping table seeded from `machineProducts`. `ConnectionDef` registry entry (`configured()` = token present, `check()` = status call). Mocked-response tests from recorded fixtures (one-shot capture script run at session start with live creds).
**DoD:** mocked-response tests green; live: connections panel shows nayax `on_healthy`, poller inserts real transactions with zero dupes across two consecutive ticks, stock reconciliation runs without drift alarms on a freshly-audited machine; tag.

### Phase 8 (stretch) — SQS stream
Receive tick + reconciliation against Lynx polling.
**DoD:** fixture-message tests green; live message ingested end-to-end; polling demoted to hourly; tag.

Phases 5–6 and 7 are independent after Phase 4; they can run as parallel sessions if desired. 0→1→2→3→4 is strictly ordered.

---

## 3. Plan artifact format (opinionated recommendation)

**Put the plan in `~/rathworkspace/docs/plans/pokemon-ops/`, not in the workspace.** The repo is where sessions run, it's pushed to origin, and `docs/plans/` + `docs/design/` precedent already exists from the CRM build. Structure:

```
docs/plans/pokemon-ops/
  PLAN.md            # architecture summary + phase index + invariants. Stable; sessions read, never edit.
  PROGRESS.md        # THE handoff contract. Current-state block + append-only session log.
  phases/PHASE-N.md  # one per phase: goal, files to touch, context pointers (file:line), exact DoD
                     #   commands with expected output, explicit OUT-OF-SCOPE list.
  prompts/PHASE-N-prompt.md  # the exact text you paste to launch that session.
  fixtures/          # shared golden fixtures referenced by phase specs.
```

Why this shape and not the alternatives:

- **One monolithic PLAN.md** drifts, bloats every session's context, and invites sessions to "helpfully" edit the plan mid-build. Split stable architecture (PLAN.md) from volatile state (PROGRESS.md) from per-session instructions (phases/).
- **A machine task manifest (JSON/YAML)** is over-engineering at 8 phases; markdown specs are what the driving model actually follows best, and your existing skills/AGENTS.md machinery is already markdown-based.
- **Prompt files per session** are the piece most people skip and the highest-leverage one for your workflow: you open tmux, paste `prompts/PHASE-3-prompt.md`, walk away. Each prompt is ~10 lines: "Read docs/plans/pokemon-ops/PROGRESS.md, then phases/PHASE-3.md. Pre-flight: re-run Phase 2's DoD. Build to the DoD. You may not edit PLAN.md or any phases/*.md. Finish with the handoff ritual."

**The handoff contract (hard rules, written into every phase spec):**

1. **Pre-flight**: session N re-runs phase N−1's DoD before writing code. If red, fix or halt with a PROGRESS.md entry — never build on a broken base.
2. **Self-verifying gate**: `npm run verify:pokemon-ops` is the single accumulating command; every phase adds its tests to it. A session cannot claim done while it's red — machine-checked, not vibes.
3. **Handoff ritual**: DoD green → commit + push → annotated tag `pokemon-ops/phase-N` (rollback points; `git describe` tells any session where the build stands) → append to PROGRESS.md: phase, verified-by (paste actual command output), deviations from spec, known gaps, next phase → `agent-event` complete.
4. **PROGRESS.md is append-only** below the current-state block; the current-state block (branch, last tag, next phase, open gaps) is the only mutable region. Sessions read PROGRESS.md + their own phase file, nothing else of the plan — keeps context small and prevents cross-phase scope creep.
5. **Specs are read-only to build sessions.** A session that discovers a spec problem records it in PROGRESS.md under "spec issues" and stops at the phase boundary; you (or a dedicated planning session) amend specs. This is the single best defense against autonomous drift.
6. **DoD commands must be copy-paste runnable and binary** (exit codes, exact strings to grep, screenshot paths) — "page looks right" is not a DoD.

Ultracode/Codex fit: phases 1–4 are well-bounded one-shot sessions for Fable driving solo; Phase 3 (rules engine) and Phase 4 (E2E) are good ultracode candidates (adversarial review caught the real bugs in both prior rathworkspace builds); Phase 6's scraper work is where Codex CLI subprocesses help least (browser/scrape iteration benefits from one coherent context).

---

## 4. Open questions (discovery could not answer)

1. **Machine slot config**: your VTM Mini Wall — are all 8 selections one slot each with uniform capacity (~15 packs), or can one SKU span multiple slots? Determines whether `pk_sku_assignments` needs the multi-slot case in v1 (I've modeled slot-level rows, which handles both, but capacity numbers need your reality).
2. **Refill cadence**: planned visit frequency for Fixture Corner Store (weekly?). The "sellout before 50% of refill cycle" trigger needs the cycle length as config.
3. **Mentor price list**: what form does it arrive in (text/screenshot/spreadsheet) and roughly how often does it change? Determines whether the benchmark importer is a CSV drop or needs an ingestion step.
4. **Dynamic pricing execution**: when a price-raise recommendation fires, manual-only (you change it in Nayax Core and log it in the tab), or auto-push? The API does support it (`PUT /v1/machines/{id}/machineProducts` updates `CreditCardPrice`), so this is purely a trust decision, not a feasibility one. Manual is the safe v1 default.
5. **$1,200 refill budget**: per refill cycle, per month, or a rolling cap? The order generator needs the period.
6. **eBay developer account**: will you do checklist item 2, or should Phase 6 plan scraping-only from the start?
