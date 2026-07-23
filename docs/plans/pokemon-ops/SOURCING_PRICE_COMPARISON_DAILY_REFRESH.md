# Sourcing Set Price Comparison and Daily Refresh Plan

## User outcome

On Business → Sourcing → Box Targets, selecting a set must surface three existing per-pack values above the product table:

1. **Medium buy level** = the set or selected product's existing **medium buy price per pack** (not a newly calculated target).
2. **TCGplayer price per pack** = the latest existing TCGplayer loose-booster benchmark.
3. **CardDistro price per pack** = the latest existing CardDistro supplier quote.

TCGplayer and CardDistro must each display compact numeric-hour freshness text derived from `pk_price_observations.created_at`, for example `4 hours behind` or `56 hours behind`. Preserve each source's date-only `observed_date` separately in the API/read model and tooltip metadata; never present that date as an exact scrape time. The comparison should remain clear when `All sets` is selected or data is missing.

## Implementation tasks

### Task 1: Read model and UI

- Inspect the current sourcing API/read model and `SourceProductTargets` component.
- Expose a per-set benchmark summary using values already stored in the sourcing database.
- Ensure `medium buy level` exactly equals the medium acquisition target per pack for the selected set or clicked product.
- Render the three values in a legible high-contrast comparison strip above the exact-product table.
- Add targeted tests for selected-set behavior, value definitions, missing data, and freshness formatting.

### Task 2: Daily benchmark refresh

- Reuse the existing deterministic TCGplayer/TCGCSV collector and observation importer; do not create a second pricing system.
- Add a versioned repo dispatcher plus thin Hermes cron entrypoint suitable for one run every 24 hours.
- TCGplayer is mandatory: any fetch/parse/import/coverage failure must make the whole run non-zero and must not silently advance the successful refresh state.
- CardDistro is best-effort: attempt it after TCGplayer, preserve the prior valid CardDistro quote and report degraded status if scraping/import fails, while allowing the run to succeed if TCGplayer succeeded.
- Refresh the dated Box Target valuation snapshot only after mandatory TCGplayer success, using the newest valid CardDistro data available.
- Produce a durable dated run archive with logs/manifest and exact source outcomes.
- Register/update a default-profile cron for once every 24 hours without creating duplicate schedules. Archive degraded CardDistro status but keep successful TCGplayer/valuation runs silent; deliver only mandatory-source failures or decision-relevant alerts.
- Add fail-closed tests proving TCGplayer failure exits non-zero and CardDistro failure degrades without erasing old data.

### Task 3: High-leverage priority

- Record in the durable Pokémon sourcing plan/backlog that automated first-party retail restock monitoring and bot-assisted MSRP purchasing is the highest-leverage sourcing initiative.
- This is monitoring/purchase tooling planning only. Do not bypass retailer protections or perform purchases in this build.

## Release gates

- No unrelated changes or secrets.
- Relevant targeted tests.
- `npm run lint`
- `npm run typecheck`
- `npm run migrate` if migrations/schema change.
- Production build as Arjun with normal HOME.
- Commit/push `main`.
- Deploy/restart and verify auth gate plus authenticated sourcing API/UI.
- Verify the exact registered cron/runtime path and one bounded test run.
