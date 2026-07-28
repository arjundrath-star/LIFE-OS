#!/usr/bin/env bash
# Cron-facing bounded dispatcher for the daily Pokemon benchmark refresh.
# A successful or supplier-degraded run is silent; any nonzero worker result
# is propagated so Hermes records the cron tick as failed and alerts the user.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${POKEMON_BENCHMARK_WORKER:-$SCRIPT_DIR/pokemon_benchmark_refresh.sh}"
LOCK_FILE="${POKEMON_BENCHMARK_LOCK:-$HOME/.cache/pokemon-benchmark-refresh.lock}"
TIMEOUT_BIN="${POKEMON_BENCHMARK_TIMEOUT_BIN:-timeout}"
# Hermes cron hard-interrupts near three minutes. The production dispatcher and
# every worker stage are therefore explicitly bounded inside that window.
CRON_TIMEOUT="${POKEMON_BENCHMARK_CRON_TIMEOUT:-165s}"
KILL_AFTER="${POKEMON_BENCHMARK_TIMEOUT_KILL_AFTER:-5s}"
export POKEMON_BENCHMARK_TCG_COLLECT_TIMEOUT="${POKEMON_BENCHMARK_TCG_COLLECT_TIMEOUT:-30s}"
export POKEMON_BENCHMARK_CSV_COVERAGE_TIMEOUT="${POKEMON_BENCHMARK_CSV_COVERAGE_TIMEOUT:-15s}"
export POKEMON_BENCHMARK_IMPORT_TIMEOUT="${POKEMON_BENCHMARK_IMPORT_TIMEOUT:-20s}"
export POKEMON_BENCHMARK_DB_COVERAGE_TIMEOUT="${POKEMON_BENCHMARK_DB_COVERAGE_TIMEOUT:-15s}"
export POKEMON_BENCHMARK_CARDDISTRO_COLLECT_TIMEOUT="${POKEMON_BENCHMARK_CARDDISTRO_COLLECT_TIMEOUT:-15s}"
export POKEMON_BENCHMARK_VALUATION_TIMEOUT="${POKEMON_BENCHMARK_VALUATION_TIMEOUT:-45s}"
export POKEMON_BENCHMARK_VALUATION_COVERAGE_TIMEOUT="${POKEMON_BENCHMARK_VALUATION_COVERAGE_TIMEOUT:-15s}"
mkdir -p "$(dirname "$LOCK_FILE")"

set +e
output="$("$TIMEOUT_BIN" --signal=TERM --kill-after="$KILL_AFTER" "$CRON_TIMEOUT" \
  flock -n "$LOCK_FILE" "$WORKER" 2>&1)"
rc=$?
set -e

if (( rc != 0 )); then
  printf 'Pokemon benchmark refresh failed (exit %s). TCGplayer is mandatory; inspect the archived run packet.\n' "$rc"
  [[ -n "$output" ]] && printf '%s\n' "$output"
elif [[ "${POKEMON_BENCHMARK_CRON_VERBOSE:-0}" == "1" && -n "$output" ]]; then
  printf '%s\n' "$output"
fi
exit "$rc"
