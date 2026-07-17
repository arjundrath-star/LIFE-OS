# PLAN — Pokemon Card Vending Ops System

Status: APPROVED 2026-07-17. This file is STABLE: build sessions read it and MUST NOT edit
it. Volatile state lives in PROGRESS.md. Per-session instructions live in phases/PHASE-N.md.
Background and rationale live in PROJECT_CONTEXT.md. Environment facts live in
SYSTEM_DISCOVERY.md. This PLAN supersedes BUILD_PLAN_PROPOSAL.md where they differ
(the material difference: §2 schema unifies pricing into one observation table).

## 1. Verdict and shape

Extend the existing stack. rathworkspace (Next.js 15 / custom server.ts via tsx / SQLite
better-sqlite3 WAL / numbered additive migrations / scheduler-tick + WS-hub data plane /
Google-allowlist auth / panel conventions / agent-event harness) plus Hermes
(`pokemon-scout` profile, skills, cron, Telegram `deliver: origin`) provide every
surrounding layer. The new module is `pokemon-ops`: migration 0011, `lib/pokemon-ops/`,
`app/api/pokemon-ops/*`, `app/(dash)/pokemon-ops/`, scheduler ticks, one Hermes sourcing
agent, and OS-cron alert scripts. Architecture diagram: see BUILD_PLAN_PROPOSAL.md §1
(still accurate; only the table set changed).

Hard environment rules (from SYSTEM_DISCOVERY.md, non-negotiable):
- Additive-only migrations; never edit shipped migrations; next number 0011.
- External writers (Hermes/cron/CLI) use `db.transaction(fn).immediate()` (two-writer WAL
  rule; DEFERRED causes SQLITE_BUSY_SNAPSHOT).
- No new resident daemons (2 cores / ~4 GiB free). Pollers = scheduler ticks; scans =
  cron-fired scripts.
- No inbound ports; all integrations pull-based (Lynx REST polling, SQS receive).
- Never weaken the Google allowlist. Nayax/eBay creds → `~/.config/rathworkspace/secrets.env`
  + `connections` registry entries.
- Prod runs the checked-out branch from source; deploy = `npm run build` +
  `sudo systemctl restart rathworkspace`.

## 2. Database schema — migration `0011_pokemon_ops.sql` (LOCKED)

Two domains + one bridge (see PROJECT_CONTEXT.md §8). All tables `pk_`-prefixed.
History-over-overwrite: current state is derived by query, not mutated. All money in
integer cents. All timestamps UTC ISO-8601. Canonical-name rule: every table references
`pk_products.id`, never free-text set names ("Mega Evolution" vs "Mega Evolutions" must
resolve to one row).

### Reference

**`pk_products`** — one row per sellable pack type.
`id, set_name, form (booster|blister|tin_pack|slab|other), display_name, release_date NULL,
tier (premium|mid|entry|slab|unknown), reprint_status (none|announced|active),
active (0/1), created_at`.
Seeded from the 15 carddistro items + Storm Emerald (releases 2026-07-31).

### Domain 1 — market pricing (append-only)

**`pk_price_observations`** — one row = one price seen at one source on one date. NEVER
updated or deleted (exception: the scanner may set `alerted_at` on its own rows; all
price/identity fields are immutable).
`id, observed_date (YYYY-MM-DD), source
(carddistro|supplier_other|ebay_sold|ebay_active|tcgplayer|costco|target|walmart|sams|
fb_marketplace|local_shop|amazon|retail_restock|other),
product_id FK, price_per_pack_cents, lot_size NULL, total_cost_cents NULL,
includes_shipping (0/1/NULL), includes_tax (0/1/NULL), listing_ref DEFAULT ''
(URL/order#/'' — NOT NULL: it is in the dedupe key, and NULL-in-UNIQUE silently disables
dedupe, Learnings 2026-07-06), quantity_available NULL, alerted_at NULL, notes, created_at.
UNIQUE(source, listing_ref, observed_date, product_id)` for scanner idempotency.
- The mentor benchmark is NOT a separate table: benchmark = latest `source='carddistro'`
  observation per product (view `pk_v_benchmark_current`).
- Seed: `seeds/carddistro-2026-07-17.csv` (15 rows, observed_date 2026-07-17).
- Price history / cross-source comparison = plain queries over this table. That is the
  point of the design; do not denormalize it away.

### Domain 2 — machine performance

**`pk_sku_assignments`** — `id, machine_id FK machines, slot_number (1..8 Mini Wall),
product_id FK, price_cents, capacity, assigned_at, ended_at NULL while active, note`.
Price change / rotation = end old row + append new. `note` carries dated merchandising
rationale (cycle-one note per PROJECT_CONTEXT.md §4 goes here).

**`pk_stock_events`** — `id, machine_id, slot_number, event (refill|audit_count|
shrink_adjust), qty_delta (audit_count rows carry absolute count in qty_delta with
event semantics: resets baseline), lot_id FK NULL, at, note`.
Current stock per slot = baseline-from-last-audit + Σ qty_delta − sales since.

**`pk_sales`** — `id, machine_id, slot_number, product_id, qty, unit_price_cents,
sold_at, source (manual|csv|lynx|sqs), external_txn_id DEFAULT '' (same NULL-in-UNIQUE
rule), created_at. UNIQUE(source, external_txn_id) WHERE source IN ('lynx','sqs')`.
Manual and Lynx rows share the table; the API hot-swap is a source swap, not a schema change.

**`pk_import_receipts`** — file fingerprint (sha256), filename, kind, row_count,
imported_at. Copies the `pokemon_pipeline_sink_receipts` idempotent-import pattern.

### Bridge

**`pk_purchase_lots`** — `id, purchase_date, source (same enum as observations),
product_id FK, pack_count, total_cost_cents (tax+shipping INCLUDED),
landed_cost_per_pack_cents (computed at insert), observation_id FK NULL (the observation
that triggered the buy), benchmark_price_cents (latest carddistro at purchase time),
benchmark_delta_cents, status (in_transit|received|allocated|depleted), notes, created_at`.
Sales draw down lots FIFO per product (allocation computed in metrics, not stored).
Lots roll up to "total invested"; a small exporter preserves
`workspace/vending/finance/rath-vending-expenses.csv` semantics (SQLite is source of
truth for pokemon spend; CSV remains the holding-company view).

### Rules output

**`pk_recommendations`** — `id, rule (refill_sync|price_raise|add_slot|dead_stock|
refill_order|sourcing_offer|nayax_drift), machine_id NULL, slot_number NULL, payload_json,
severity (info|action|urgent), created_at, status (open|acked|done|dismissed),
alerted_at NULL`. UI and Telegram digest both read this table; alerts are rows —
auditable, never double-sent.

### Derived only (NEVER stored)

Margin per pack, margin $/slot/day (primary KPI), velocity, days of supply, projected
sellout, refill-sync spread, FIFO lot allocation, benchmark deltas over time. All in
`lib/pokemon-ops/metrics.ts` + SQL views. Single source of truth; no sync bugs.

## 3. Layers (summary; details per phase spec)

- **Ingest now:** panel forms + `app/api/pokemon-ops/*` CRUD (lots, observations incl.
  benchmark re-drops, SKU assignments, stock events, quick sales) + CSV importers with
  receipts. Machine not live for ~a month → v1's first real use is entering cycle-one
  purchase lots and price observations.
- **Ingest later:** `tickNayax` scheduler tick, 15 min, `lastSales` cursor+dedupe;
  hourly `machineProducts` reconciliation (Nayax MissingStockByMDB/PAR vs our
  stock-event math → drift recommendation); `status` health tile. See
  SYSTEM_DISCOVERY.md §5 and the saved docs at `workspace/vending/pokemon/nayax-docs/`.
- **Stretch:** SQS receive tick; Lynx demoted to hourly reconciliation.
- **Rules engine:** `lib/pokemon-ops/rules.ts`, pure deterministic, no LLM, golden-fixture
  tested. Rules: refill sync (days-of-supply equalization), dynamic-pricing trigger
  (projected sellout < 50% of refill cycle → recommend raise/add-slot), dead stock
  (21 days no sales → mystery-slot rotation), refill order generator ($1,200 budget +
  velocities + freshest observations per product → exact shopping list with source and
  expected landed cost/margin). Config table or kv: refill_cycle_days (default 14 until
  Arjun confirms), budget_cents (120000), alert_threshold_pct (15), min_margin_cents (1000).
- **Dashboard:** nav `pokemon-ops` next to `pokemon-crm`; WS channel `pokemon_ops`
  (60s snapshot tick); KPI band (margin $/slot/day primary, total invested, sell-through,
  days-of-supply spread); slot table; recommendations; recent sales; sourcing feed
  (recent observations with benchmark deltas); entry forms. Cyan Jarvis theme,
  JetBrains Mono numbers, per `rathworkspace-ui` skill.
- **Hermes sourcing:** `agents/pokemon-sourcing-scout/` cloning the lead-scout dispatcher
  (deterministic Python scrapers + optional agentic phase + archive/idempotency/
  agent-event); skill `~/.hermes/skills/business/pokemon-sourcing-scout/`; `hermes cron`
  job off-peak (avoid 09:00/10:30/23:45 — single Codex credential). Scans write
  `pk_price_observations` (IMMEDIATE-tx CLI). eBay via Browse API if keys provisioned,
  else scraper; TCGplayer via scrape with pokemontcg.io/tcgcsv.com backup; retail-restock
  watch (reprint wave) is the agentic phase and alerts immediately, not in digest.
- **Alerts:** OS-cron bash + curl Telegram (watchdog script pattern) reads
  `pk_recommendations`/fresh observations → immediate alerts + morning digest; sets
  `alerted_at`. Deterministic alerts must not depend on Hermes.
- **Obsidian:** render-only. A cron renders a markdown ops snapshot into
  `~/command-center/Pokemon Machines/`; never a data source.

## 4. Phase index

Specs in `phases/`, launch prompts in `prompts/`. 0→1→2→3→4 strictly ordered; 5, 6, 7
independent after 4 (parallel sessions allowed); 8 stretch after 7.

| Phase | Session | Gate command |
|---|---|---|
| 0 | Repo hygiene (commit 0010, clean tree, merge crm branch → main) | git clean + build + service healthy |
| 1 | Schema 0011 + data layer + seeds + verify harness | `npm run verify:pokemon-ops` |
| 2 | Ingest: CRUD routes + CSV importers + smoke script | verify + smoke |
| 3 | Metrics + rules engine + daily tick | verify (golden fixtures exact) |
| 4 | Dashboard tab + WS + E2E | build + E2E + screenshot |
| 5 | Telegram alerts + digest (OS cron) | dry-run fixtures + live ok:true |
| 6 | Hermes sourcing scanner | scraper fixtures + live offer row + cron listed |
| 7 | Nayax Lynx poller + reconciliation (needs human checklist §5.1) | mocked fixtures + live healthy/no-dupe |
| 8 | SQS stream (stretch) | fixture + live message end-to-end |

## 5. Human setup checklist (Arjun, once; front-loaded so sessions never need him)

1. **Nayax (during onboarding this month):** reader registered under YOUR operator
   account (not the distributor's); Core login with operator-admin; device serial;
   self-serve User Token (Core → Account Settings → Security and Login → User Tokens) →
   `NAYAX_LYNX_TOKEN` + `NAYAX_DEVICE_SERIAL` in `~/.config/rathworkspace/secrets.env`;
   request roles Transaction Dispatcher + Transactions Report Subscriber; ask VTM if the
   Mini Wall's DEX port is wired to the Nayax unit. (SQS/AWS setup deferred to Phase 8.)
2. **eBay:** developer.ebay.com production keyset (Browse API, free tier) → `EBAY_*`
   in secrets.env. Skipping = Phase 6 scraper path (works, brittler).
3. **Mentor list re-drops:** updated carddistro CSVs →
   `~/rathworkspace/data/imports/mentor-benchmark.csv` (importer appends dated rows).
4. **Machine config facts** (edit into `prompts/PHASE-1-prompt.md` before launching):
   slot/SKU config and per-slot capacity on the Mini Wall; Fixture Corner Store refill cadence.
5. Verify `sudo systemctl restart rathworkspace` is passwordless once.
6. **MA tax (business, not code):** file for the ST-4 resale certificate via
   MassTaxConnect; email the accountant re: MA vend-tax setup.

## 6. Session protocol (hard rules; every phase spec restates them)

1. **Pre-flight:** re-run previous phase's DoD. Red → fix or halt with a PROGRESS.md
   entry. Never build on a broken base.
2. **Gate:** `npm run verify:pokemon-ops` accumulates every phase's tests. A session
   cannot claim done while it is red.
3. **Handoff ritual:** DoD green → commit + push → annotated tag `pokemon-ops/phase-N` →
   PROGRESS.md append (phase, verified-by with pasted command output, deviations, gaps,
   next) → `npm run agent-event` complete.
4. **PROGRESS.md:** current-state block is the only mutable region; everything below is
   append-only.
5. **Specs are read-only to build sessions.** Spec problems → PROGRESS.md "spec issues"
   → stop at the phase boundary. Planning sessions (or Arjun) amend specs.
6. **DoD commands are copy-paste runnable and binary** (exit codes, grep strings,
   screenshot paths). "Looks right" is not a DoD.
7. Follow repo `AGENTS.md` (lifecycle events, build verification, allowlist untouchable).

## 7. Driver notes

Fable 5 solo one-shots for 1–4; ultracode recommended for Phase 3 (rules engine) and
Phase 4 (E2E) — adversarial review has caught real bugs in prior rathworkspace builds;
Phase 6 scraping benefits from one coherent context (skip Codex subprocesses there).
Phases 5/6/7 may run as parallel tmux sessions after 4.
