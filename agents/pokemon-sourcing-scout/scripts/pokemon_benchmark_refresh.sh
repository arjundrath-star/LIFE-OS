#!/usr/bin/env bash
# Daily fail-closed Pokemon benchmark refresh.
# TCGplayer/TCGCSV is mandatory; CardDistro is an optional, best-effort collector.
set -Eeuo pipefail

REPO_ROOT="${RATHWORKSPACE_REPO:-/home/Arjun/rathworkspace}"
ARCHIVE_ROOT="${POKEMON_BENCHMARK_ARCHIVE_ROOT:-/home/Arjun/command-center/Pokemon Machines/Archive/benchmark-refresh}"
OBSERVED_DATE="${POKEMON_BENCHMARK_DATE:-$(date -u +%F)}"
RUN_STAMP="${POKEMON_BENCHMARK_RUN_STAMP:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
RUN_DIR="$ARCHIVE_ROOT/$RUN_STAMP"
PYTHON_BIN="${POKEMON_BENCHMARK_PYTHON:-python3}"
NPX_BIN="${POKEMON_BENCHMARK_NPX:-npx}"
NPM_BIN="${POKEMON_BENCHMARK_NPM:-npm}"
TIMEOUT_BIN="${POKEMON_BENCHMARK_TIMEOUT_BIN:-timeout}"
TIMEOUT_KILL_AFTER="${POKEMON_BENCHMARK_TIMEOUT_KILL_AFTER:-10s}"
TCG_COLLECT_TIMEOUT="${POKEMON_BENCHMARK_TCG_COLLECT_TIMEOUT:-5m}"
CSV_COVERAGE_TIMEOUT="${POKEMON_BENCHMARK_CSV_COVERAGE_TIMEOUT:-2m}"
IMPORT_TIMEOUT="${POKEMON_BENCHMARK_IMPORT_TIMEOUT:-2m}"
DB_COVERAGE_TIMEOUT="${POKEMON_BENCHMARK_DB_COVERAGE_TIMEOUT:-2m}"
CARDDISTRO_COLLECT_TIMEOUT="${POKEMON_BENCHMARK_CARDDISTRO_COLLECT_TIMEOUT:-5m}"
VALUATION_TIMEOUT="${POKEMON_BENCHMARK_VALUATION_TIMEOUT:-10m}"
TCG_SCRAPER="$REPO_ROOT/agents/pokemon-sourcing-scout/scripts/tcgplayer_scraper.py"
COVERAGE_SCRIPT="$REPO_ROOT/scripts/pokemon-benchmark-coverage.ts"
TCG_CSV="$RUN_DIR/tcgplayer.csv"
CARDDISTRO_CSV="$RUN_DIR/carddistro.csv"

TCG_STATUS="pending"
TCG_DETAIL="not_started"
CARDDISTRO_STATUS="skipped_due_to_prerequisite"
CARDDISTRO_DETAIL="TCGplayer prerequisite did not complete; CardDistro collector was not evaluated."
VALUATION_STATUS="pending"
VALUATION_DETAIL="not_started"
DEGRADED=1
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [[ ! "$OBSERVED_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  printf 'invalid POKEMON_BENCHMARK_DATE (expected YYYY-MM-DD)\n' >&2
  exit 64
fi
if [[ ! "$RUN_STAMP" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  printf 'invalid POKEMON_BENCHMARK_RUN_STAMP\n' >&2
  exit 64
fi

mkdir -p "$RUN_DIR"
chmod 700 "$ARCHIVE_ROOT" "$RUN_DIR" 2>/dev/null || true

run_with_timeout() {
  local limit=$1
  shift
  "$TIMEOUT_BIN" --signal=TERM --kill-after="$TIMEOUT_KILL_AFTER" "$limit" "$@"
}

write_finalization_metadata() {
  "$PYTHON_BIN" - <<'PY'
import hashlib
import json
import os
from pathlib import Path

root = Path(os.environ["ARCHIVE_ROOT"])
run = Path(os.environ["RUN_DIR"])
run_id = os.environ["RUN_STAMP"]
status = os.environ["BENCHMARK_STATUS"]
exit_code = int(os.environ["BENCHMARK_EXIT_CODE"])
finalizer_error = os.environ.get("FINALIZER_ERROR", "")
recovery = os.environ.get("FINALIZER_RECOVERY") == "1"


def atomic_write(path: Path, payload: str) -> None:
    tmp = path.with_name(f".{path.name}.{run_id}.tmp")
    try:
        tmp.write_text(payload)
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


sources = {
    "tcgplayer": {
        "required": True,
        "status": os.environ["TCG_STATUS"],
        "detail": os.environ["TCG_DETAIL"],
    },
    "carddistro": {
        "required": False,
        "status": os.environ["CARDDISTRO_STATUS"],
        "detail": os.environ["CARDDISTRO_DETAIL"],
    },
}
summary = {
    "run_id": run_id,
    "observed_date": os.environ["OBSERVED_DATE"],
    "started_at": os.environ["STARTED_AT"],
    "finished_at": os.environ["FINISHED_AT"],
    "status": status,
    "exit_code": exit_code,
    "sources": sources,
    "valuation": {
        "status": os.environ["VALUATION_STATUS"],
        "detail": os.environ["VALUATION_DETAIL"],
    },
    "archive_dir": str(run),
}
if finalizer_error:
    summary["finalizer_error"] = finalizer_error

atomic_write(run / "source-outcomes.json", json.dumps(sources, indent=2) + "\n")
atomic_write(run / "run-summary.json", json.dumps(summary, indent=2) + "\n")
markdown = (
    "# Pokemon benchmark refresh\n\n"
    f"- Run: `{summary['run_id']}`\n- Date: `{summary['observed_date']}`\n"
    f"- Status: **{status}**\n- Exit: `{exit_code}`\n"
    f"- TCGplayer: `{sources['tcgplayer']['status']}` — {sources['tcgplayer']['detail']}\n"
    f"- CardDistro: `{sources['carddistro']['status']}` — {sources['carddistro']['detail']}\n"
    f"- Box Target valuations: `{summary['valuation']['status']}` — {summary['valuation']['detail']}\n"
)
if finalizer_error:
    markdown += f"- Finalizer: **failed** — {finalizer_error}\n"
atomic_write(run / "run-summary.md", markdown)

manifest = []
for path in sorted(
    p for p in run.iterdir()
    if p.is_file() and p.name != "manifest.json" and not p.name.startswith(".")
):
    payload = path.read_bytes()
    manifest.append({
        "file": path.name,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    })
atomic_write(
    run / "manifest.json",
    json.dumps({"run_id": summary["run_id"], "files": manifest}, indent=2) + "\n",
)

# Pointer ordering is intentional: all immutable run artifacts and the manifest
# are complete before latest-run moves, and latest-successful moves last.
atomic_write(root / "latest-run.json", json.dumps(summary, indent=2) + "\n")
if not recovery and exit_code == 0:
    atomic_write(root / "latest-successful-run.json", json.dumps(summary, indent=2) + "\n")
PY
}

finalize() {
  local rc=$?
  local finalizer_rc=0
  local recovery_rc=0
  local status="completed"
  local finished_at
  trap - EXIT
  set +e
  if (( rc != 0 )); then status="failed"; elif (( DEGRADED != 0 )); then status="degraded"; fi
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  export RUN_DIR ARCHIVE_ROOT RUN_STAMP OBSERVED_DATE TCG_STATUS TCG_DETAIL
  export CARDDISTRO_STATUS CARDDISTRO_DETAIL VALUATION_STATUS VALUATION_DETAIL
  export BENCHMARK_STATUS="$status" BENCHMARK_EXIT_CODE="$rc" STARTED_AT
  export FINISHED_AT="$finished_at" FINALIZER_ERROR="" FINALIZER_RECOVERY=0
  write_finalization_metadata
  finalizer_rc=$?
  if (( finalizer_rc != 0 )); then
    printf 'benchmark refresh finalizer failed exit=%s archive=%s\n' "$finalizer_rc" "$RUN_DIR" >&2
    rc=70
    status="failed"
    finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    export BENCHMARK_STATUS="$status" BENCHMARK_EXIT_CODE="$rc" FINISHED_AT="$finished_at"
    export FINALIZER_ERROR="archive/pointer finalization failed (writer exit $finalizer_rc)"
    export FINALIZER_RECOVERY=1
    write_finalization_metadata
    recovery_rc=$?
    if (( recovery_rc != 0 )); then
      printf 'benchmark refresh finalizer recovery failed exit=%s archive=%s\n' "$recovery_rc" "$RUN_DIR" >&2
    fi
  fi
  printf 'benchmark refresh status=%s exit=%s archive=%s\n' "$status" "$rc" "$RUN_DIR"
  exit "$rc"
}
trap finalize EXIT

cd "$REPO_ROOT"

# Mandatory TCGplayer loose-booster observations via the existing deterministic TCGCSV collector.
collector_args=(--observed-date "$OBSERVED_DATE" --out "$TCG_CSV" --require-complete)
if [[ -n "${POKEMON_BENCHMARK_TCG_FIXTURE_DIR:-}" ]]; then
  collector_args+=(--fixture-dir "$POKEMON_BENCHMARK_TCG_FIXTURE_DIR")
else
  collector_args+=(--live)
fi
if [[ -n "${POKEMON_BENCHMARK_TCG_COLLECTOR:-}" ]]; then
  tcg_collector=("$POKEMON_BENCHMARK_TCG_COLLECTOR")
else
  tcg_collector=("$PYTHON_BIN" "$TCG_SCRAPER")
fi
if ! run_with_timeout "$TCG_COLLECT_TIMEOUT" "${tcg_collector[@]}" "${collector_args[@]}" >"$RUN_DIR/tcgplayer-collect.log" 2>&1; then
  TCG_STATUS="failed"; TCG_DETAIL="collector fetch/parse/coverage failed or exceeded ${TCG_COLLECT_TIMEOUT}"; exit 10
fi
if ! run_with_timeout "$CSV_COVERAGE_TIMEOUT" "$NPX_BIN" tsx "$COVERAGE_SCRIPT" --mode csv --source tcgplayer --date "$OBSERVED_DATE" --file "$TCG_CSV" >"$RUN_DIR/tcgplayer-csv-coverage.json" 2>"$RUN_DIR/tcgplayer-csv-coverage.log"; then
  TCG_STATUS="failed"; TCG_DETAIL="collected CSV failed strict mapped-set coverage or exceeded ${CSV_COVERAGE_TIMEOUT}"; exit 11
fi
if ! run_with_timeout "$IMPORT_TIMEOUT" "$NPM_BIN" run --silent import:pokemon-ops -- observations "$TCG_CSV" >"$RUN_DIR/tcgplayer-import.log" 2>&1; then
  TCG_STATUS="failed"; TCG_DETAIL="observation import failed transactionally or exceeded ${IMPORT_TIMEOUT}"; exit 12
fi
if ! run_with_timeout "$DB_COVERAGE_TIMEOUT" "$NPX_BIN" tsx "$COVERAGE_SCRIPT" --mode db --date "$OBSERVED_DATE" >"$RUN_DIR/tcgplayer-db-coverage.json" 2>"$RUN_DIR/tcgplayer-db-coverage.log"; then
  TCG_STATUS="failed"; TCG_DETAIL="post-import database coverage failed or exceeded ${DB_COVERAGE_TIMEOUT}"; exit 13
fi
TCG_STATUS="completed"
TCG_DETAIL="complete mapped-set TCGplayer observations imported and verified"

# Optional CardDistro automation. There is no stable authenticated collector in the
# repository today, so no scraper is invented. A future legitimate executable can
# be supplied here; any failure is degraded and cannot erase prior append-only rows.
if [[ -n "${POKEMON_BENCHMARK_CARDDISTRO_COLLECTOR:-}" ]]; then
  CARDDISTRO_STATUS="attempted"
  CARDDISTRO_DETAIL="collector started"
  if ! run_with_timeout "$CARDDISTRO_COLLECT_TIMEOUT" "$POKEMON_BENCHMARK_CARDDISTRO_COLLECTOR" --observed-date "$OBSERVED_DATE" --out "$CARDDISTRO_CSV" >"$RUN_DIR/carddistro-collect.log" 2>&1; then
    CARDDISTRO_STATUS="failed"
    CARDDISTRO_DETAIL="collector failed or exceeded ${CARDDISTRO_COLLECT_TIMEOUT}; prior valid CardDistro observations retained"
    DEGRADED=1
  elif ! run_with_timeout "$CSV_COVERAGE_TIMEOUT" "$NPX_BIN" tsx "$COVERAGE_SCRIPT" --mode csv --source carddistro --date "$OBSERVED_DATE" --file "$CARDDISTRO_CSV" >"$RUN_DIR/carddistro-csv-validation.json" 2>"$RUN_DIR/carddistro-csv-validation.log"; then
    CARDDISTRO_STATUS="failed"
    CARDDISTRO_DETAIL="collector output failed validation or exceeded ${CSV_COVERAGE_TIMEOUT}; prior valid observations retained"
    DEGRADED=1
  elif ! run_with_timeout "$IMPORT_TIMEOUT" "$NPM_BIN" run --silent import:pokemon-ops -- observations "$CARDDISTRO_CSV" >"$RUN_DIR/carddistro-import.log" 2>&1; then
    CARDDISTRO_STATUS="failed"
    CARDDISTRO_DETAIL="transactional import failed or exceeded ${IMPORT_TIMEOUT}; prior valid observations retained"
    DEGRADED=1
  else
    CARDDISTRO_STATUS="completed"
    CARDDISTRO_DETAIL="new CardDistro observations imported"
    DEGRADED=0
  fi
else
  CARDDISTRO_STATUS="not_configured"
  CARDDISTRO_DETAIL="No legitimate automated CardDistro collector is configured; retained newest valid observations."
fi

# Valuation fetch/mutation is deliberately last: it cannot run until mandatory
# TCGplayer collection, import, and database coverage have all succeeded.
valuation_args=(--date "$OBSERVED_DATE")
if [[ -n "${POKEMON_BENCHMARK_TCG_FIXTURE_DIR:-}" ]]; then
  valuation_args+=(--fixture-dir "$POKEMON_BENCHMARK_TCG_FIXTURE_DIR")
fi
if ! run_with_timeout "$VALUATION_TIMEOUT" "$NPM_BIN" run --silent pokemon:source-products -- "${valuation_args[@]}" >"$RUN_DIR/valuation-refresh.json" 2>"$RUN_DIR/valuation-refresh.log"; then
  VALUATION_STATUS="failed"
  VALUATION_DETAIL="TCGCSV sealed-product refresh or valuation mutation failed or exceeded ${VALUATION_TIMEOUT}"
  exit 14
fi
VALUATION_STATUS="completed"
VALUATION_DETAIL="dated Box Target snapshot refreshed from TCGplayer and newest valid CardDistro observations"
