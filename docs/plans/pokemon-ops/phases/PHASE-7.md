# PHASE 7 — Nayax Lynx poller + reconciliation

PRECONDITION: human checklist item 1 complete (NAYAX_LYNX_TOKEN + NAYAX_DEVICE_SERIAL in
the environment, Core roles granted). If absent, halt immediately with a PROGRESS.md
entry; do not mock your way to "done".

Goal: sales flow into pk_sales automatically; Nayax's stock view reconciles against our
stock-event math; machine health is visible. Manual entry remains as fallback.

Context: the verified Lynx endpoint map (auth, gotchas — GMT fields,
MultivendNumverOfProducts misspelling, PAR doc mislabel, lastSales has NO date-range/
pagination → frequent poll + TransactionID dedupe, no historical backfill: pre-API
history stays manual/CSV). Full OpenAPI spec + vendor doc pages are saved locally —
copy relevant parts into fixtures.

Work:
1. `lib/sources/nayax/` client: Bearer auth, prod base https://lynx.nayax.com/operational,
   typed wrappers for devices, devices/{serial}/machine, machines/{id}/lastSales,
   machineProducts, pickList, status, lastAlerts. Startup resolution: serial → MachineID
   cached in kv.
2. Session-start capture script: with live creds, record real responses once into
   fixtures; all tests run against recordings.
3. `tickNayax` (15 min): lastSales → insert pk_sales source='lynx',
   external_txn_id=TransactionID, dedupe via the partial UNIQUE; map Nayax selection/
   MDB codes → pk_sku_assignments via a mapping seeded from machineProducts (surface
   unmapped codes as a recommendation, don't crash).
4. Hourly: machineProducts → reconcile MissingStockByMDB/PAR/last_sale_dt against our
   stock math → drift beyond tolerance emits rule='nayax_drift'. status → health tile
   data (LastKeepAliveDateTime, QTYSoldSinceLastVisitOnlineSales) on the WS snapshot.
5. ConnectionDef in lib/connections/registry.ts (configured() = token present,
   check() = status call) → connections panel 3-state health.
6. Restock flow doc note: refills must be confirmed in Nayax (pickList confirm or
   inventory/full) so Nayax-side stock stays true; our pk_stock_events remains the
   system of record.

Out of scope: SQS (Phase 8), auto price-push (manual-only v1 per the locked plan).

DoD:
- mocked-fixture tests → 0; verify:pokemon-ops → 0
- connections panel shows nayax on_healthy (screenshot to
  tests/pokemon-ops/artifacts/phase7-connection.png)
- two consecutive live ticks → real transactions inserted, zero duplicates
  (paste counts + the dedupe query)
- reconciliation runs without drift alarms on a freshly audited machine (or documents
  the drift found); tag `pokemon-ops/phase-7` pushed
