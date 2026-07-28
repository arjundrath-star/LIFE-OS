#!/usr/bin/env bash
# Self-contained Phase 2 smoke test: exercises every app/api/pokemon-ops/* route
# against a fresh temp DB with a real (production-mode, prebuilt) server, plus
# the bulk CSV importer CLI's double-import idempotency. Builds NOTHING — run
# `npm run build` first (verify:pokemon-ops does this). Never touches
# data/rathworkspace.db (live): everything runs against a mktemp'd copy.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PORT="${SMOKE_PORT:-3210}"
BASE="http://127.0.0.1:${PORT}"

TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/pokemon-ops-smoke.XXXXXX")"
DB_PATH="$TMPDIR/pokemon-ops-smoke.db"

FAILS=0
fail() { echo "FAIL: $1"; FAILS=$((FAILS + 1)); }
ok() { echo "OK: $1"; }
assert_eq() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (got '$2' expected '$3')"; fi }
assert_true() { if [ "$2" = "true" ]; then ok "$1"; else fail "$1 (got '$2')"; fi }
assert_ge1() { if [ "${2:-0}" -ge 1 ] 2>/dev/null; then ok "$1"; else fail "$1 (got '$2')"; fi }

if [ "$PORT" = "3000" ]; then
  echo "refusing to use PORT=3000 (that's the live rathworkspace prod port) — pick another"
  exit 1
fi

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    # `tsx server.ts` forks a real child node process that does the actual
    # listening; killing only the tsx wrapper PID leaves that child orphaned
    # and still bound to $PORT. Kill the wrapper's children first, then it.
    pkill -P "$SERVER_PID" >/dev/null 2>&1 || true
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$TMPDIR"
}
trap cleanup EXIT

if curl -s -o /dev/null "http://127.0.0.1:${PORT}/api/auth/providers" 2>/dev/null; then
  echo "port $PORT is already in use — pick another (SMOKE_PORT=... bash scripts/pokemon-ops-smoke.sh)"
  exit 1
fi

echo "== migrate + seed temp db: $DB_PATH =="
RATHWORKSPACE_DB="$DB_PATH" npm run migrate || { fail "migrate"; exit 1; }
RATHWORKSPACE_DB="$DB_PATH" npm run seed:pokemon-ops || { fail "seed"; exit 1; }

echo "== boot server on port $PORT =="
# Invoke tsx directly (not `npm run start`) so $! is the tsx process itself,
# not npm's wrapper — needed for the pkill -P cleanup above to find its child.
NODE_ENV=production PORT="$PORT" RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx server.ts >"$TMPDIR/server.log" 2>&1 &
SERVER_PID=$!

READY=0
for _ in $(seq 1 60); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/providers" 2>/dev/null || true)
  if [ "$CODE" = "200" ]; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  fail "server did not become ready on $BASE"
  echo "---- server.log ----"; cat "$TMPDIR/server.log"
  exit 1
fi
ok "server ready on $BASE"

echo "== minting session cookie =="
COOKIE_VALUE="$(node_modules/.bin/tsx scripts/pokemon-ops-mint-session.ts)"
if [ -z "$COOKIE_VALUE" ]; then
  fail "could not mint session cookie"
  exit 1
fi
COOKIE_HEADER="__Secure-next-auth.session-token=${COOKIE_VALUE}"

req_unauth_code() { curl -s -o /dev/null -w "%{http_code}" -X "$1" "$BASE$2"; }
req_auth() {
  local method="$1" p="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -s -X "$method" -H "Content-Type: application/json" -H "Cookie: $COOKIE_HEADER" -d "$data" "$BASE$p"
  else
    curl -s -X "$method" -H "Cookie: $COOKIE_HEADER" "$BASE$p"
  fi
}
req_auth_code() {
  local method="$1" p="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -H "Cookie: $COOKIE_HEADER" -d "$data" "$BASE$p"
  else
    curl -s -o /dev/null -w "%{http_code}" -X "$method" -H "Cookie: $COOKIE_HEADER" "$BASE$p"
  fi
}

MACHINE_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM machines WHERE name='Venue Alpha'")
CHAOS_PRODUCT_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM pk_products WHERE set_name='Chaos Rising'")
echo "machine_id=$MACHINE_ID chaos_product_id=$CHAOS_PRODUCT_ID"

echo "== unauthed requests -> 401 =="
for p in \
  "/api/pokemon-ops/observations" \
  "/api/pokemon-ops/lots" \
  "/api/pokemon-ops/sku-assignments" \
  "/api/pokemon-ops/stock-events?machine_id=1&slot_number=1" \
  "/api/pokemon-ops/sales" \
  "/api/pokemon-ops/products" \
  "/api/pokemon-ops/config"; do
  code=$(req_unauth_code GET "$p")
  assert_eq "unauthed GET $p -> 401" "$code" "401"
done

echo "== observations =="
RESP=$(req_auth POST /api/pokemon-ops/observations "{\"observed_date\":\"2026-07-17\",\"source\":\"ebay_active\",\"product_id\":$CHAOS_PRODUCT_ID,\"price_per_pack_cents\":650,\"listing_ref\":\"smoke-obs-1\"}")
assert_true "observation create ok" "$(echo "$RESP" | jq -r '.ok')"
assert_true "observation inserted" "$(echo "$RESP" | jq -r '.inserted')"
RESP=$(req_auth GET "/api/pokemon-ops/observations?product_id=$CHAOS_PRODUCT_ID")
assert_ge1 "observations list has rows" "$(echo "$RESP" | jq '.observations | length')"

echo "== lots =="
# Benchmark policy (lib/pokemon-ops/db.ts benchmarkForProductAtDate): only
# external market observations (tcgplayer primary, ebay_sold fallback) define
# benchmark value. Supplier quotes never do. The seed loads supplier quotes
# only, so a lot priced before any market observation exists has a null
# benchmark, and that is the correct answer rather than a missing feature.
RESP=$(req_auth POST /api/pokemon-ops/lots "{\"purchase_date\":\"2026-07-17\",\"source\":\"ebay_sold\",\"product_id\":$CHAOS_PRODUCT_ID,\"pack_count\":10,\"total_cost_cents\":6000,\"status\":\"in_transit\",\"notes\":\"smoke lot\"}")
LOT_ID=$(echo "$RESP" | jq -r '.lot.id')
assert_eq "lot landed_cost_per_pack_cents" "$(echo "$RESP" | jq -r '.lot.landed_cost_per_pack_cents')" "600"
assert_eq "lot benchmark_price_cents is null with no market observation" "$(echo "$RESP" | jq -r '.lot.benchmark_price_cents')" "null"
assert_eq "lot benchmark_delta_cents is null with no market observation" "$(echo "$RESP" | jq -r '.lot.benchmark_delta_cents')" "null"

# Now record a real market observation and confirm a later lot benchmarks off it.
req_auth POST /api/pokemon-ops/observations "{\"observed_date\":\"2026-07-17\",\"source\":\"tcgplayer\",\"product_id\":$CHAOS_PRODUCT_ID,\"price_per_pack_cents\":708,\"listing_ref\":\"smoke-mkt-1\"}" >/dev/null
RESP2=$(req_auth POST /api/pokemon-ops/lots "{\"purchase_date\":\"2026-07-17\",\"source\":\"ebay_sold\",\"product_id\":$CHAOS_PRODUCT_ID,\"pack_count\":10,\"total_cost_cents\":6000,\"status\":\"in_transit\",\"notes\":\"smoke lot benchmarked\"}")
assert_eq "lot benchmark_price_cents uses tcgplayer market (708c)" "$(echo "$RESP2" | jq -r '.lot.benchmark_price_cents')" "708"
assert_eq "lot benchmark_delta_cents" "$(echo "$RESP2" | jq -r '.lot.benchmark_delta_cents')" "-108"
RESP=$(req_auth PATCH /api/pokemon-ops/lots "{\"id\":$LOT_ID,\"status\":\"received\"}")
assert_eq "lot status transition" "$(echo "$RESP" | jq -r '.lot.status')" "received"
RESP=$(req_auth GET "/api/pokemon-ops/lots?product_id=$CHAOS_PRODUCT_ID")
assert_ge1 "lots list filtered by product" "$(echo "$RESP" | jq '.lots | length')"

echo "== sku-assignments =="
RESP=$(req_auth POST /api/pokemon-ops/sku-assignments "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"product_id\":$CHAOS_PRODUCT_ID,\"price_cents\":1200,\"capacity\":15,\"note\":\"smoke assign 1\"}")
FIRST_ASSIGN_ID=$(echo "$RESP" | jq -r '.id')
assert_true "assign #1 ok" "$(echo "$RESP" | jq -r '.ok')"
RESP=$(req_auth POST /api/pokemon-ops/sku-assignments "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"product_id\":$CHAOS_PRODUCT_ID,\"price_cents\":1300,\"capacity\":15,\"note\":\"smoke assign 2\"}")
assert_eq "exactly one active assignment for slot 1 after rotation" \
  "$(echo "$RESP" | jq '[.assignments[] | select(.slot_number==1)] | length')" "1"
RESP=$(req_auth GET "/api/pokemon-ops/sku-assignments?machine_id=$MACHINE_ID&history=1")
OLD_ENDED=$(echo "$RESP" | jq --argjson id "$FIRST_ASSIGN_ID" '[.assignments[] | select(.id==$id)][0].ended_at')
if [ "$OLD_ENDED" != "null" ]; then ok "old assignment ended_at set"; else fail "old assignment not ended"; fi

echo "== stock-events =="
RESP=$(req_auth POST /api/pokemon-ops/stock-events "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"event\":\"refill\",\"qty_delta\":15,\"note\":\"smoke refill\"}")
assert_true "refill ok" "$(echo "$RESP" | jq -r '.ok')"
RESP=$(req_auth POST /api/pokemon-ops/stock-events "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"event\":\"audit_count\",\"qty_delta\":14,\"note\":\"smoke audit\"}")
assert_eq "audit_count resets current_stock baseline" "$(echo "$RESP" | jq -r '.current_stock')" "14"

echo "== sales =="
RESP=$(req_auth POST /api/pokemon-ops/sales "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"qty\":1,\"sold_at\":\"2026-07-17T15:00:00.000Z\"}")
assert_true "single sale ok" "$(echo "$RESP" | jq -r '.ok')"
assert_true "single sale inserted" "$(echo "$RESP" | jq -r '.inserted')"
RESP=$(req_auth POST /api/pokemon-ops/sales "{\"machine_id\":$MACHINE_ID,\"slot_number\":1,\"action\":\"quick_bulk\",\"qty\":7,\"since_ts\":\"2026-07-15T00:00:00.000Z\"}")
assert_ge1 "quick_bulk produced rows" "$(echo "$RESP" | jq '.rows | length')"
QTY_SUM=$(echo "$RESP" | jq '[.rows[].qty] | add')
assert_eq "quick_bulk row qtys sum to requested qty" "$QTY_SUM" "7"

echo "== products =="
RESP=$(req_auth POST /api/pokemon-ops/products "{\"set_name\":\"Smoke Test Set\",\"form\":\"booster\",\"tier\":\"entry\"}")
SMOKE_PRODUCT_ID=$(echo "$RESP" | jq -r '.id')
assert_true "product create ok" "$(echo "$RESP" | jq -r '.ok')"
CODE=$(req_auth_code POST /api/pokemon-ops/products "{\"set_name\":\"Smoke Test Set\",\"form\":\"booster\",\"tier\":\"entry\"}")
assert_eq "duplicate set_name -> 409" "$CODE" "409"
RESP=$(req_auth PATCH /api/pokemon-ops/products "{\"id\":$SMOKE_PRODUCT_ID,\"tier\":\"mid\"}")
assert_eq "product tier patch" "$(echo "$RESP" | jq -r '.product.tier')" "mid"

echo "== config =="
RESP=$(req_auth GET /api/pokemon-ops/config)
assert_eq "config initial budget_cents" "$(echo "$RESP" | jq -r '.config[] | select(.k=="budget_cents") | .v')" "120000"
RESP=$(req_auth PATCH /api/pokemon-ops/config "{\"budget_cents\":\"150000\"}")
assert_eq "config patched budget_cents" "$(echo "$RESP" | jq -r '.config[] | select(.k=="budget_cents") | .v')" "150000"
CODE=$(req_auth_code PATCH /api/pokemon-ops/config "{\"bogus_key\":\"1\"}")
assert_eq "config unknown key -> 400" "$CODE" "400"

echo "== CSV double-import via CLI (idempotency) =="
CARDDISTRO_CSV="docs/plans/pokemon-ops/seeds/carddistro-2026-07-17.csv"
IMPORT1=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts carddistro "$CARDDISTRO_CSV")
echo "carddistro import run 1: $IMPORT1"
IMPORT2=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts carddistro "$CARDDISTRO_CSV")
echo "carddistro import run 2: $IMPORT2"
ROWCOUNT1=$(echo "$IMPORT1" | jq -r '.receipt.row_count')
ROWCOUNT2=$(echo "$IMPORT2" | jq -r '.receipt.row_count')
echo "PASTE: carddistro row counts -> run1=$ROWCOUNT1 run2=$ROWCOUNT2"
assert_eq "carddistro double-import row_count identical" "$ROWCOUNT1" "$ROWCOUNT2"

LOTS_CSV="$TMPDIR/smoke-lots.csv"
cat >"$LOTS_CSV" <<CSV
purchase_date,source,set_name,pack_count,total_cost_usd,observation_ref,status,notes
2026-07-17,ebay_sold,Perfect Order,8,50.00,,in_transit,smoke bulk lot
CSV
L1=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts lots "$LOTS_CSV")
echo "lots import run 1: $L1"
L2=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts lots "$LOTS_CSV")
echo "lots import run 2: $L2"
assert_eq "lots import run1 imported/skipped" "$(echo "$L1" | jq -r '.imported'),$(echo "$L1" | jq -r '.skipped')" "1,0"
assert_eq "lots import run2 no-op" "$(echo "$L2" | jq -r '.imported'),$(echo "$L2" | jq -r '.skipped')" "0,1"

SALES_CSV="$TMPDIR/smoke-sales.csv"
cat >"$SALES_CSV" <<CSV
sold_at,machine,slot_number,set_name,qty,unit_price_usd,source,external_txn_id
2026-07-17T09:00:00.000Z,Venue Alpha,2,Perfect Order,1,12.00,manual,
CSV
S1=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts sales "$SALES_CSV")
echo "sales import run 1: $S1"
S2=$(RATHWORKSPACE_DB="$DB_PATH" node_modules/.bin/tsx scripts/pokemon-ops-import.ts sales "$SALES_CSV")
echo "sales import run 2: $S2"
assert_eq "sales import run1 imported/skipped" "$(echo "$S1" | jq -r '.imported'),$(echo "$S1" | jq -r '.skipped')" "1,0"
assert_eq "sales import run2 no-op" "$(echo "$S2" | jq -r '.imported'),$(echo "$S2" | jq -r '.skipped')" "0,1"

echo
echo "== summary: $FAILS failing checks =="
if [ "$FAILS" -gt 0 ]; then exit 1; fi
exit 0
