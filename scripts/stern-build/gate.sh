#!/usr/bin/env bash
# Mechanical gate for one worktree: typecheck, tests, migrate twice (idempotent), production build.
# Serialized with a lock because the box has 2 CPUs. Usage:
#   scripts/stern-build/gate.sh <worktree-dir> <db-copy-path> [label]
# Exit 0 only if every step passes. Full log in $STERN_LOGS/gate-<label>-<ts>.log
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
WT="${1:?worktree}"; DB="${2:?db copy}"; LABEL="${3:-$(basename "$WT")}"
LOG="$STERN_LOGS/gate-$LABEL-$(stern_ts).log"
case "$DB" in "$STERN_MAIN_REPO"/*) echo "refusing to gate against the prod DB"; exit 2;; esac
[ -e "$WT/node_modules" ] || ln -s "$STERN_MAIN_REPO/node_modules" "$WT/node_modules"
exec 9>"$STERN_LOGS/gate.lock"; flock 9
step() { local name="$1"; shift; echo "=== $name ($(stern_ts)) ===" | tee -a "$LOG"; ( cd "$WT" && "$@" ) >>"$LOG" 2>&1; local rc=$?; echo "--- $name rc=$rc" | tee -a "$LOG"; return $rc; }
FAIL=0
step typecheck npm run typecheck || FAIL=1
step tests npm test || FAIL=1
step migrate-1 env RATHWORKSPACE_DB="$DB" npm run migrate || FAIL=1
step migrate-2 env RATHWORKSPACE_DB="$DB" npm run migrate || FAIL=1
step build env NODE_ENV=production npx next build || FAIL=1
echo "GATE $LABEL result=$([ $FAIL -eq 0 ] && echo PASS || echo FAIL) log=$LOG" | tee -a "$LOG"
exit $FAIL
