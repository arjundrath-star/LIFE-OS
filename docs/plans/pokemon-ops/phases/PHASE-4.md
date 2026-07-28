# PHASE 4 — Dashboard tab

Goal: the pokemon-ops tab live on rathworkspace.cloud with real-time data and working
entry forms.

Context: PLAN.md §3 dashboard; the repo's add-module procedure (registry entry only if
an external service is involved — none yet); `rathworkspace-ui` skill; existing Puppeteer
E2E pattern (remember `page.evaluate(el.click())` for row handlers). Ultracode-recommended.

Work:
1. `tickPokemonOps` (60s) broadcasting WS channel `pokemon_ops` snapshot; API snapshot
   route for first paint.
2. Page `app/(dash)/pokemon-ops/page.tsx` + panels under `components/panels/`:
   KPI band (margin $/slot/day primary, total invested, sell-through, days-of-supply
   spread); per-slot table (SKU, price, velocity, stock, days of supply, projected
   sellout); open recommendations with ack/dismiss; recent sales; sourcing feed
   (latest observations w/ benchmark deltas per product); forms for lots, observations,
   sku assignment, stock events, quick sales; CSV upload.
3. Nav entry `pokemon-ops` beside `pokemon-crm` in components/shell/nav.tsx.
4. Puppeteer E2E: load authed, assert KPI band renders fixture-derived numbers, create a
   lot via the form, assert it appears in the table and total-invested updates;
   screenshot to `tests/pokemon-ops/artifacts/phase4.png`.

Out of scope: alerts, scanners, Nayax, any new rules.

DoD:
- `npm run verify:pokemon-ops` → 0; `npm run build` → 0
- E2E → exit 0; `test -f tests/pokemon-ops/artifacts/phase4.png` → 0
- service restart healthy; tag `pokemon-ops/phase-4` pushed
