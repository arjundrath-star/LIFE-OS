#!/usr/bin/env bash
# Scheduler-safe deterministic sourcing pass; bounded below the 120-second cron ceiling.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RUN_AGENTIC=0
export POKEMON_SOURCING_RATH_DIR="${POKEMON_SOURCING_RATH_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
timeout --signal=TERM --kill-after=3s 83s "$SCRIPT_DIR/pokemon_sourcing_worker.sh" || { rc=$?; echo "Deterministic sourcing phase failed (status $rc)." >&2; exit "$rc"; }
timeout --signal=TERM --kill-after=3s 24s python3 "$SCRIPT_DIR/discord_deal_watch.py" || { rc=$?; echo "Discord watcher phase failed (status $rc)." >&2; exit "$rc"; }
