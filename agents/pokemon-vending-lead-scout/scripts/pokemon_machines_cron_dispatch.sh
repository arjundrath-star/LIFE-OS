#!/usr/bin/env bash
# Background dispatcher for the weekly Pokemon field-packet worker.
# Hermes no-agent cron scripts have a short runtime boundary. This wrapper
# returns after a bounded startup grace period while the versioned worker owns
# the archive, stable pointer, and terminal dashboard event.
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER="${POKEMON_FIELD_PACKET_WORKER:-$SCRIPT_DIR/pokemon_machines_profile_worker.sh}"
RUN_ID="${POKEMON_AGENT_RUN_ID:-pokemon-leads-$(date -u +%Y%m%dT%H%M%SZ)}"
LOG_DIR="${POKEMON_FIELD_PACKET_LOG_DIR:-$HOME/command-center/Pokemon Machines/Logs/profile-worker}"
LOG_FILE="${POKEMON_FIELD_PACKET_LOG_FILE:-$LOG_DIR/$RUN_ID.log}"
LOCK_FILE="${POKEMON_FIELD_PACKET_LOCK_FILE:-/tmp/pokemon-field-packet-worker.lock}"
GRACE_SECONDS="${POKEMON_FIELD_PACKET_DISPATCH_GRACE_SECONDS:-5}"

[[ -x "$WORKER" ]] || {
  printf 'Pokemon field-packet dispatch failed: worker is not executable: %s\n' "$WORKER" >&2
  exit 1
}

if [[ "${1:-}" == "--check" ]]; then
  [[ $# -eq 1 ]] || { printf 'Too many arguments for --check.\n' >&2; exit 64; }
  bash -n "$WORKER"
  "$WORKER" --check
  printf 'OK: Pokemon field-packet dispatcher and worker are available; no run was started.\n'
  exit 0
fi

[[ $# -eq 0 ]] || {
  printf 'Pokemon field-packet dispatcher accepts only --check.\n' >&2
  exit 64
}

mkdir -p "$LOG_DIR"
umask 077
export POKEMON_AGENT_RUN_ID="$RUN_ID"
export POKEMON_FIELD_PACKET_RUN=1
export POKEMON_AGENT_TRIGGER_TYPE="${POKEMON_AGENT_TRIGGER_TYPE:-cron}"
export POKEMON_AGENT_TRIGGER_SOURCE="${POKEMON_AGENT_TRIGGER_SOURCE:-Hermes default cron -> pokemon-scout weekly field packet}"

if [[ "${POKEMON_FIELD_PACKET_FOREGROUND:-}" == "1" ]]; then
  exec "$WORKER"
fi

# The detached child inherits this locked descriptor, preventing overlapping
# scheduled/manual field-packet runs until the real worker exits.
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  printf 'Pokemon field-packet dispatch skipped: another worker holds %s\n' "$LOCK_FILE"
  exit 0
fi

(
  trap '' HUP
  exec "$WORKER"
) </dev/null >"$LOG_FILE" 2>&1 &
PID=$!

sleep "$GRACE_SECONDS"
if ! kill -0 "$PID" 2>/dev/null; then
  set +e
  wait "$PID"
  STATUS=$?
  set -e
  if [[ $STATUS -ne 0 ]]; then
    printf 'Pokemon field-packet worker failed during startup for %s (status %s). Log: %s\n' "$RUN_ID" "$STATUS" "$LOG_FILE" >&2
    exit "$STATUS"
  fi
  printf 'Pokemon field-packet worker completed during startup grace for %s. Log: %s\n' "$RUN_ID" "$LOG_FILE"
  exit 0
fi

disown "$PID" 2>/dev/null || true
printf 'Pokemon field-packet worker dispatched in background for %s (pid %s). Log: %s\n' "$RUN_ID" "$PID" "$LOG_FILE"
