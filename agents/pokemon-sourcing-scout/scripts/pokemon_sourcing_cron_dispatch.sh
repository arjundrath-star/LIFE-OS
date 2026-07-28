#!/usr/bin/env bash
# Background dispatcher for the long-running Pokemon sourcing worker.
# Hermes no-agent cron scripts have a hard runtime boundary; this wrapper returns
# after a short startup grace period while the versioned worker owns archives and
# terminal dashboard events.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${POKEMON_SOURCING_WORKER:-$SCRIPT_DIR/pokemon_sourcing_worker.sh}"
RUN_ID="${POKEMON_SOURCING_RUN_ID:-pokemon-sourcing-$(date -u +%Y%m%dT%H%M%SZ)}"
LOG_DIR="${POKEMON_SOURCING_LOG_DIR:-$HOME/command-center/Pokemon Machines/Logs/sourcing-worker}"
LOG_FILE="${POKEMON_SOURCING_LOG_FILE:-$LOG_DIR/$RUN_ID.log}"
LOCK_FILE="${POKEMON_SOURCING_LOCK_FILE:-/tmp/pokemon-sourcing-worker.lock}"
GRACE_SECONDS="${POKEMON_SOURCING_DISPATCH_GRACE_SECONDS:-5}"

[[ -x "$WORKER" ]] || {
  printf 'Pokemon sourcing dispatch failed: worker is not executable: %s\n' "$WORKER" >&2
  exit 1
}

if [[ "${1:-}" == "--check" ]]; then
  bash -n "$WORKER"
  printf 'OK: Pokemon sourcing dispatcher and worker are available; no scan was started.\n'
  exit 0
fi

mkdir -p "$LOG_DIR"
umask 077

export POKEMON_SOURCING_RUN_ID="$RUN_ID"
export POKEMON_SOURCING_TRIGGER_TYPE="${POKEMON_SOURCING_TRIGGER_TYPE:-cron}"
export POKEMON_SOURCING_TRIGGER_SOURCE="${POKEMON_SOURCING_TRIGGER_SOURCE:-pokemon-sourcing-scout cron worker}"

if [[ "${POKEMON_SOURCING_FOREGROUND:-}" == "1" ]]; then
  exec "$WORKER" "$@"
fi

# Keep the lock descriptor open in the detached child so overlapping manual or
# scheduled launches cannot import the same sourcing run concurrently.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf 'Pokemon sourcing dispatch skipped: another worker holds %s\n' "$LOCK_FILE"
  exit 0
fi

(
  trap '' HUP
  exec "$WORKER" "$@"
) </dev/null >"$LOG_FILE" 2>&1 &
PID=$!

sleep "$GRACE_SECONDS"
if ! kill -0 "$PID" 2>/dev/null; then
  set +e
  wait "$PID"
  STATUS=$?
  set -e
  if [[ $STATUS -ne 0 ]]; then
    printf 'Pokemon sourcing worker failed during startup for %s (status %s). Log: %s\n' "$RUN_ID" "$STATUS" "$LOG_FILE" >&2
    exit "$STATUS"
  fi
  printf 'Pokemon sourcing worker completed during startup grace for %s. Log: %s\n' "$RUN_ID" "$LOG_FILE"
  exit 0
fi

disown "$PID" 2>/dev/null || true
printf 'Pokemon sourcing worker dispatched in background for %s (pid %s). Log: %s\n' "$RUN_ID" "$PID" "$LOG_FILE"
