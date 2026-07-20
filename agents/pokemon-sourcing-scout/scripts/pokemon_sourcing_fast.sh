#!/usr/bin/env bash
# Scheduler-safe deterministic sourcing pass; bounded below the 120-second cron ceiling.
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RUN_AGENTIC=0
export POKEMON_SOURCING_RATH_DIR="${POKEMON_SOURCING_RATH_DIR:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
exec timeout --signal=TERM --kill-after=5s 105s "$SCRIPT_DIR/pokemon_sourcing_worker.sh"
