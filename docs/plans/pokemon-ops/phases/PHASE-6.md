# PHASE 6 — Hermes sourcing scanner

Goal: automated Domain 1 feeds. Daily scans write dated pk_price_observations for target
products from eBay, TCGplayer(-or-backup), and the 2026 reprint-wave retail-restock
watch; threshold beats alert immediately via Phase 5's pipeline.

Context: PLAN.md §3 Hermes sourcing; discovery §3 (dispatcher reference:
pokemon_machines_profile_worker.sh; agents/pokemon-vending-lead-scout as the template;
google-venv python; headless Chrome CDP :18800; single Codex credential → schedule
off-peak, away from 09:00/10:30/23:45). This phase is one-coherent-context work; skip
Codex subprocesses.

Decision at session start: if EBAY_* keys exist in secrets.env → Browse API path; else
scraper path. Record which in PROGRESS.md.

Work:
1. `agents/pokemon-sourcing-scout/` cloning the lead-scout dispatcher architecture:
   deterministic Python scrapers for (a) eBay sold+active bulk-lot listings per target
   set — compute $/pack from total incl. shipping, lot size from title/desc heuristics,
   flag ETB lots as excluded per operator doctrine; (b) TCGplayer market price per
   product (scrape; pokemontcg.io / tcgcsv.com as backup structured sources — pick the
   stable one at build time and record the choice); writes via the IMMEDIATE-tx CLI with
   the UNIQUE(source, listing_ref, observed_date, product_id) dedupe.
2. Agentic phase (hermes -p pokemon-scout) for the retail-restock watch: Destined
   Rivals / Prismatic Evolutions restocks at Target/Costco/Sam's/Walmart — fuzzy web
   work; findings land as source='retail_restock' observations; MSRP-level finds are
   urgent (Phase 5 picks them up immediately).
3. Hermes skill `~/.hermes/skills/business/pokemon-sourcing-scout/SKILL.md` + `hermes
   cron create` script job at an off-peak slot; archive/idempotency/agent-event handling
   per the dispatcher pattern.
4. Scraper unit tests against RECORDED fixture pages (save fixtures in the agent dir).

Out of scope: Nayax, UI beyond what already renders observations, FB Marketplace
(manual-only per plan).

DoD:
- scraper tests vs recorded fixtures → exit 0
- one live run → ≥1 new pk_price_observations row (paste count before/after);
  immediate re-run → 0 new rows (dedupe)
- `hermes cron list` shows the job enabled at the off-peak time (paste line)
- sourcing feed on the tab shows the new rows; verify:pokemon-ops → 0;
  tag `pokemon-ops/phase-6` pushed
