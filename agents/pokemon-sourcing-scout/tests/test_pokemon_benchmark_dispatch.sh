#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DISPATCHER="$REPO_ROOT/agents/pokemon-sourcing-scout/scripts/pokemon_benchmark_refresh_cron_dispatch.sh"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/pokemon-benchmark-dispatch-test.XXXXXX")"
trap 'rm -rf "$TMP_ROOT"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

cat >"$TMP_ROOT/worker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[[ "${FAKE_SLEEP:-0}" == "0" ]] || sleep "$FAKE_SLEEP"
printf '%s\n' "${FAKE_OUTPUT:-worker completed}"
exit "${FAKE_RC:-0}"
SH
chmod 755 "$TMP_ROOT/worker"

run_dispatch() {
  local name=$1 rc=$2 sleep_seconds=$3 timeout=$4 verbose=${5:-0}
  set +e
  output="$(env \
    POKEMON_BENCHMARK_WORKER="$TMP_ROOT/worker" \
    POKEMON_BENCHMARK_LOCK="$TMP_ROOT/$name.lock" \
    POKEMON_BENCHMARK_CRON_TIMEOUT="$timeout" \
    POKEMON_BENCHMARK_TIMEOUT_KILL_AFTER='1s' \
    POKEMON_BENCHMARK_CRON_VERBOSE="$verbose" \
    FAKE_RC="$rc" FAKE_SLEEP="$sleep_seconds" FAKE_OUTPUT="$name output" \
    bash "$DISPATCHER" 2>&1)"
  dispatch_rc=$?
  set -e
}

run_dispatch success 0 0 10s
[[ "$dispatch_rc" -eq 0 ]] || fail "success exit=$dispatch_rc"
[[ -z "$output" ]] || fail "successful cron dispatch was not silent: $output"

run_dispatch verbose 0 0 10s 1
[[ "$dispatch_rc" -eq 0 ]] || fail "verbose success exit=$dispatch_rc"
[[ "$output" == "verbose output" ]] || fail "verbose output mismatch: $output"

run_dispatch failure 7 0 10s
[[ "$dispatch_rc" -eq 7 ]] || fail "failure exit=$dispatch_rc"
grep -Fq 'Pokemon benchmark refresh failed (exit 7)' <<<"$output" || fail "failure alert missing"
grep -Fq 'failure output' <<<"$output" || fail "worker failure output missing"

start=$(date +%s)
run_dispatch timeout 0 3 1s
elapsed=$(( $(date +%s) - start ))
[[ "$dispatch_rc" -eq 124 ]] || fail "timeout exit=$dispatch_rc, expected 124"
(( elapsed < 3 )) || fail "dispatcher timeout was not bounded (elapsed=${elapsed}s)"
grep -Fq 'Pokemon benchmark refresh failed (exit 124)' <<<"$output" || fail "timeout alert missing"

grep -Fq 'POKEMON_BENCHMARK_CRON_TIMEOUT:-165s' "$DISPATCHER" || fail "production dispatcher is not bounded below the Hermes three-minute limit"
grep -Fq 'POKEMON_BENCHMARK_VALUATION_TIMEOUT:-45s' "$DISPATCHER" || fail "dispatcher does not enforce a bounded valuation stage"

printf 'PASS: cron dispatcher is silent on success, bounded below the Hermes limit, and propagates worker failures\n'
