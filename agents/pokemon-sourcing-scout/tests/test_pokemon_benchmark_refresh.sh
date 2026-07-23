#!/usr/bin/env bash
# Hermetic behavior tests for pokemon_benchmark_refresh.sh.
# All collectors and npm/npx entrypoints are fakes; no network or live DB is used.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
WORKER="$REPO_ROOT/agents/pokemon-sourcing-scout/scripts/pokemon_benchmark_refresh.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pokemon-benchmark-refresh-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_status() {
  local file=$1 expected=$2 actual
  [[ -f "$file" ]] || fail "missing JSON file: $file"
  actual="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "$file")"
  [[ "$actual" == "$expected" ]] || fail "$file status=$actual, expected=$expected"
}

assert_json_value() {
  local file=$1 path=$2 expected=$3 actual
  [[ -f "$file" ]] || fail "missing JSON file: $file"
  actual="$(python3 -c 'import json,sys; value=json.load(open(sys.argv[1])); [value := value[key] for key in sys.argv[2].split(".")]; print(value)' "$file" "$path")"
  [[ "$actual" == "$expected" ]] || fail "$file $path=$actual, expected=$expected"
}

assert_successful_pointer_unchanged() {
  [[ "$(sha256sum "$CASE_SUCCESSFUL_POINTER_SENTINEL" | cut -d' ' -f1)" == "$CASE_SUCCESSFUL_POINTER_HASH" ]] \
    || fail "latest-successful pointer changed for $CASE_DIR"
}

assert_no_valuation() {
  local log=$1
  if [[ -f "$log" ]] && grep -Fq 'pokemon:source-products' "$log"; then
    fail "valuation ran after mandatory TCGplayer failure"
  fi
}

BIN_DIR="$TMP_ROOT/bin"
mkdir -p "$BIN_DIR"

cat >"$BIN_DIR/tcg-collector" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'tcg-collector %s\n' "$*" >>"$FAKE_COMMAND_LOG"
if [[ "${FAKE_TCG_COLLECTOR_SLEEP:-0}" != "0" ]]; then
  sleep "$FAKE_TCG_COLLECTOR_SLEEP"
fi
if (( ${FAKE_TCG_COLLECTOR_RC:-0} != 0 )); then
  exit "$FAKE_TCG_COLLECTOR_RC"
fi
out=''
while (( $# )); do
  if [[ "$1" == '--out' ]]; then out=$2; shift 2; else shift; fi
done
[[ -n "$out" ]]
printf 'fixture tcg csv\n' >"$out"
SH

cat >"$BIN_DIR/carddistro-collector" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'carddistro-collector %s\n' "$*" >>"$FAKE_COMMAND_LOG"
if (( ${FAKE_CARDDISTRO_COLLECTOR_RC:-0} != 0 )); then
  exit "$FAKE_CARDDISTRO_COLLECTOR_RC"
fi
out=''
while (( $# )); do
  if [[ "$1" == '--out' ]]; then out=$2; shift 2; else shift; fi
done
[[ -n "$out" ]]
printf 'fixture carddistro csv\n' >"$out"
SH

cat >"$BIN_DIR/fake-npx" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'npx %s\n' "$*" >>"$FAKE_COMMAND_LOG"
args=" $* "
if [[ "$args" == *' --mode csv '* && "$args" == *' --source tcgplayer '* ]]; then
  rc=${FAKE_TCG_CSV_COVERAGE_RC:-0}
elif [[ "$args" == *' --mode db '* ]]; then
  rc=${FAKE_TCG_DB_COVERAGE_RC:-0}
elif [[ "$args" == *' --mode csv '* && "$args" == *' --source carddistro '* ]]; then
  rc=${FAKE_CARDDISTRO_COVERAGE_RC:-0}
else
  rc=98
fi
printf '{"fake":true}\n'
exit "$rc"
SH

cat >"$BIN_DIR/fake-npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >>"$FAKE_COMMAND_LOG"
args=" $* "
if [[ "$args" == *' import:pokemon-ops '* && "$args" == *tcgplayer.csv* ]]; then
  rc=${FAKE_TCG_IMPORT_RC:-0}
elif [[ "$args" == *' import:pokemon-ops '* && "$args" == *carddistro.csv* ]]; then
  rc=${FAKE_CARDDISTRO_IMPORT_RC:-0}
elif [[ "$args" == *' pokemon:source-products '* ]]; then
  rc=${FAKE_VALUATION_RC:-0}
else
  rc=97
fi
printf '{"fake":true}\n'
exit "$rc"
SH
chmod 755 "$BIN_DIR"/*

run_case() {
  local name=$1 tcg_collector_rc=$2 tcg_coverage_rc=$3 tcg_import_rc=$4 tcg_db_coverage_rc=$5
  local carddistro_collector_rc=$6 carddistro_coverage_rc=${7:-0} carddistro_import_rc=${8:-0}
  local tcg_collector_sleep=${9:-0} tcg_collect_timeout=${10:-30s} pointer_mode=${11:-file}
  local case_dir="$TMP_ROOT/$name"
  local successful_pointer_sentinel
  mkdir -p "$case_dir/repo" "$case_dir/archive"
  printf 'prior-carddistro-observation\n' >"$case_dir/prior-observations.txt"
  if [[ "$pointer_mode" == "directory" ]]; then
    mkdir "$case_dir/archive/latest-successful-run.json"
    successful_pointer_sentinel="$case_dir/archive/latest-successful-run.json/previous.json"
  else
    successful_pointer_sentinel="$case_dir/archive/latest-successful-run.json"
  fi
  printf '{"status":"previous","run_id":"previous"}\n' >"$successful_pointer_sentinel"
  local prior_hash
  prior_hash="$(sha256sum "$case_dir/prior-observations.txt" | cut -d' ' -f1)"
  local successful_pointer_hash
  successful_pointer_hash="$(sha256sum "$successful_pointer_sentinel" | cut -d' ' -f1)"

  set +e
  env \
    PATH="$PATH" \
    RATHWORKSPACE_REPO="$case_dir/repo" \
    RATHWORKSPACE_DB="$case_dir/test.db" \
    POKEMON_BENCHMARK_ARCHIVE_ROOT="$case_dir/archive" \
    POKEMON_BENCHMARK_DATE='2026-07-22' \
    POKEMON_BENCHMARK_RUN_STAMP="$name" \
    POKEMON_BENCHMARK_TCG_COLLECTOR="$BIN_DIR/tcg-collector" \
    POKEMON_BENCHMARK_CARDDISTRO_COLLECTOR="$BIN_DIR/carddistro-collector" \
    POKEMON_BENCHMARK_NPX="$BIN_DIR/fake-npx" \
    POKEMON_BENCHMARK_NPM="$BIN_DIR/fake-npm" \
    POKEMON_BENCHMARK_TCG_COLLECT_TIMEOUT="$tcg_collect_timeout" \
    POKEMON_BENCHMARK_TIMEOUT_KILL_AFTER='1s' \
    FAKE_COMMAND_LOG="$case_dir/commands.log" \
    FAKE_TCG_COLLECTOR_RC="$tcg_collector_rc" \
    FAKE_TCG_COLLECTOR_SLEEP="$tcg_collector_sleep" \
    FAKE_TCG_CSV_COVERAGE_RC="$tcg_coverage_rc" \
    FAKE_TCG_DB_COVERAGE_RC="$tcg_db_coverage_rc" \
    FAKE_TCG_IMPORT_RC="$tcg_import_rc" \
    FAKE_CARDDISTRO_COLLECTOR_RC="$carddistro_collector_rc" \
    FAKE_CARDDISTRO_COVERAGE_RC="$carddistro_coverage_rc" \
    FAKE_CARDDISTRO_IMPORT_RC="$carddistro_import_rc" \
    FAKE_VALUATION_RC=0 \
    bash "$WORKER" >"$case_dir/stdout.log" 2>"$case_dir/stderr.log"
  CASE_RC=$?
  set -e

  CASE_DIR=$case_dir
  CASE_PRIOR_HASH=$prior_hash
  CASE_SUCCESSFUL_POINTER_HASH=$successful_pointer_hash
  CASE_SUCCESSFUL_POINTER_SENTINEL=$successful_pointer_sentinel
}

run_case tcg-collector-failure 7 0 0 0 0
[[ "$CASE_RC" -eq 10 ]] || fail "collector failure exit=$CASE_RC, expected=10"
assert_status "$CASE_DIR/archive/tcg-collector-failure/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-run.json" failed
assert_status "$CASE_DIR/archive/latest-successful-run.json" previous
assert_json_value "$CASE_DIR/archive/tcg-collector-failure/run-summary.json" sources.carddistro.status skipped_due_to_prerequisite
assert_successful_pointer_unchanged
assert_no_valuation "$CASE_DIR/commands.log"

run_case tcg-coverage-failure 0 9 0 0 0
[[ "$CASE_RC" -eq 11 ]] || fail "coverage failure exit=$CASE_RC, expected=11"
assert_status "$CASE_DIR/archive/tcg-coverage-failure/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-successful-run.json" previous
assert_successful_pointer_unchanged
assert_no_valuation "$CASE_DIR/commands.log"
if grep -Fq 'import:pokemon-ops' "$CASE_DIR/commands.log"; then
  fail "TCGplayer import ran after strict CSV coverage failure"
fi

run_case tcg-import-failure 0 0 8 0 0
[[ "$CASE_RC" -eq 12 ]] || fail "import failure exit=$CASE_RC, expected=12"
assert_status "$CASE_DIR/archive/tcg-import-failure/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-successful-run.json" previous
assert_successful_pointer_unchanged
assert_no_valuation "$CASE_DIR/commands.log"

run_case tcg-db-coverage-failure 0 0 0 5 0
[[ "$CASE_RC" -eq 13 ]] || fail "database coverage failure exit=$CASE_RC, expected=13"
assert_status "$CASE_DIR/archive/tcg-db-coverage-failure/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-successful-run.json" previous
assert_successful_pointer_unchanged
assert_no_valuation "$CASE_DIR/commands.log"

run_case tcg-collector-timeout 0 0 0 0 0 0 0 2 1s
[[ "$CASE_RC" -eq 10 ]] || fail "collector timeout exit=$CASE_RC, expected=10"
assert_status "$CASE_DIR/archive/tcg-collector-timeout/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-run.json" failed
assert_status "$CASE_DIR/archive/latest-successful-run.json" previous
assert_json_value "$CASE_DIR/archive/tcg-collector-timeout/run-summary.json" sources.carddistro.status skipped_due_to_prerequisite
assert_successful_pointer_unchanged
assert_no_valuation "$CASE_DIR/commands.log"

assert_carddistro_degraded_case() {
  local name=$1 collector_rc=$2 coverage_rc=$3 import_rc=$4 expected_import_state=$5
  run_case "$name" 0 0 0 0 "$collector_rc" "$coverage_rc" "$import_rc"
  [[ "$CASE_RC" -eq 0 ]] || fail "$name exit=$CASE_RC, expected=0"
  assert_status "$CASE_DIR/archive/$name/run-summary.json" degraded
  assert_status "$CASE_DIR/archive/latest-run.json" degraded
  assert_status "$CASE_DIR/archive/latest-successful-run.json" degraded
  grep -Fq 'pokemon:source-products' "$CASE_DIR/commands.log" || fail "valuation did not run after successful mandatory TCGplayer pipeline in $name"
  if [[ "$expected_import_state" == "skipped" ]] && grep -Eq '^npm .*import:pokemon-ops .*carddistro\.csv' "$CASE_DIR/commands.log"; then
    fail "CardDistro import ran after an earlier optional failure in $name"
  fi
  if [[ "$expected_import_state" == "attempted" ]] && ! grep -Eq '^npm .*import:pokemon-ops .*carddistro\.csv' "$CASE_DIR/commands.log"; then
    fail "CardDistro import was not attempted in $name"
  fi
  current_hash="$(sha256sum "$CASE_DIR/prior-observations.txt" | cut -d' ' -f1)"
  [[ "$current_hash" == "$CASE_PRIOR_HASH" ]] || fail "prior CardDistro observation sentinel changed in $name"
  grep -Fq '"status": "failed"' "$CASE_DIR/archive/$name/source-outcomes.json" || fail "CardDistro source outcome was not failed in $name"
  grep -Fq 'run-summary.json' "$CASE_DIR/archive/$name/manifest.json" || fail "archive manifest omitted run-summary.json in $name"
  grep -Fq 'source-outcomes.json' "$CASE_DIR/archive/$name/manifest.json" || fail "archive manifest omitted source-outcomes.json in $name"
}

assert_carddistro_degraded_case carddistro-collector-failure 6 0 0 skipped
assert_carddistro_degraded_case carddistro-validation-failure 0 6 0 skipped
assert_carddistro_degraded_case carddistro-import-failure 0 0 6 attempted

run_case finalizer-success-pointer-failure 0 0 0 0 0 0 0 0 30s directory
[[ "$CASE_RC" -eq 70 ]] || fail "finalizer pointer failure exit=$CASE_RC, expected=70"
assert_status "$CASE_DIR/archive/finalizer-success-pointer-failure/run-summary.json" failed
assert_status "$CASE_DIR/archive/latest-run.json" failed
assert_json_value "$CASE_DIR/archive/finalizer-success-pointer-failure/run-summary.json" exit_code 70
assert_json_value "$CASE_DIR/archive/latest-run.json" exit_code 70
assert_json_value "$CASE_DIR/archive/finalizer-success-pointer-failure/run-summary.json" finalizer_error 'archive/pointer finalization failed (writer exit 1)'
assert_successful_pointer_unchanged
[[ -d "$CASE_DIR/archive/latest-successful-run.json" ]] || fail "failed latest-successful replacement changed prior pointer type"
grep -Fq 'pokemon:source-products' "$CASE_DIR/commands.log" || fail "finalizer test did not complete main valuation pipeline"
if ! python3 - "$CASE_DIR/archive/finalizer-success-pointer-failure" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
manifest = json.loads((run / "manifest.json").read_text())
entries = {entry["file"]: entry for entry in manifest["files"]}
for name in ("run-summary.json", "run-summary.md", "source-outcomes.json"):
    payload = (run / name).read_bytes()
    assert entries[name]["bytes"] == len(payload)
    assert entries[name]["sha256"] == hashlib.sha256(payload).hexdigest()
PY
then
  fail "recovery manifest does not match rewritten failed run artifacts"
fi

printf 'PASS: mandatory stages fail closed (including timeout), optional CardDistro failures degrade, and finalizer recovery publishes failed exit-70 metadata without advancing latest-successful\n'
