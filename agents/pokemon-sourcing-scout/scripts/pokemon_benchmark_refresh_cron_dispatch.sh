#!/usr/bin/env bash
# Cron-facing bounded dispatcher for the daily Pokemon benchmark refresh.
# A successful or CardDistro-degraded run is silent; any nonzero worker result
# is propagated so Hermes records the cron tick as failed and alerts the user.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${POKEMON_BENCHMARK_WORKER:-$SCRIPT_DIR/pokemon_benchmark_refresh.sh}"
LOCK_FILE="${POKEMON_BENCHMARK_LOCK:-/home/Arjun/.cache/pokemon-benchmark-refresh.lock}"
TIMEOUT_BIN="${POKEMON_BENCHMARK_TIMEOUT_BIN:-timeout}"
# The worker's bounded stages can legitimately total about 26 minutes. Keep an
# outer limit above that budget so the dispatcher remains bounded without
# killing a healthy run before its own stage deadlines.
CRON_TIMEOUT="${POKEMON_BENCHMARK_CRON_TIMEOUT:-30m}"
KILL_AFTER="${POKEMON_BENCHMARK_TIMEOUT_KILL_AFTER:-10s}"
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
