#!/usr/bin/env bash
# Portable Charging Lead Scout — event emitter for the rathworkspace control tower.
#
# This wrapper does NOT find leads and does NOT send any email. It is the thin layer that
# emits run/timeline/artifact events into the dashboard so the real lead-finder (a Hermes
# cron / orchestrator step) becomes visible. Two ways to use it:
#
#   1. Source it and call `emit` at each stage from the real lead-finder:
#        source scripts/pc-lead-scout.sh         # sets AGENT, RUN, and the emit() fn
#        emit started running "Daily lead scout run started"
#        emit found running "Found 8 candidate leads"
#        emit waiting_for_review waiting_for_review "Draft packet ready for Arjun"
#
#   2. Run a self-contained demo that walks a full sample run (no email, no real leads):
#        scripts/pc-lead-scout.sh --demo
#
# Set PC_RUN_ID / PC_TRIGGER_TYPE / PC_TRIGGER_SOURCE to override the defaults.
#
# IMPORTANT: when SOURCED we must not impose `set -uo pipefail` or change the caller's cwd.
# So we set up PATH + emit() first, return early if sourced, and only harden our own shell
# (set/cd) in the executed branch below.
RW_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# cron strips npm-global from PATH; `tsx` is a LOCAL dep — put the repo's node_modules/.bin
# (and the usual npm-global dirs) on PATH so `tsx` resolves whether run by cron or by hand.
export PATH="$RW_REPO/node_modules/.bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

AGENT="portable-charging-lead-scout"
RUN="${PC_RUN_ID:-pc-leads-$(date +%F)}"

# emit <kind> <status> <summary> [level] [extra agent-event flags...]
# Runs tsx inside a SUBSHELL cd'd to the repo so tsx finds tsconfig.json (the `@/` alias)
# and node_modules — without changing the caller's cwd when this file is sourced.
emit() {
  local kind="$1" status="$2" summary="$3"; shift 3
  local level="info"
  if [[ "${1:-}" != "" && "${1:-}" != --* ]]; then level="$1"; shift; fi
  ( cd "$RW_REPO" && tsx scripts/agent-event.ts \
      --agent "$AGENT" --run "$RUN" \
      --kind "$kind" --status "$status" --summary "$summary" --level "$level" \
      --trigger-type "${PC_TRIGGER_TYPE:-cron}" \
      --trigger-source "${PC_TRIGGER_SOURCE:-pc-lead-scout.sh}" \
      "$@" )
}

# When sourced (not executed), expose AGENT/RUN/emit + PATH and return WITHOUT touching the
# caller's shell options or working directory.
(return 0 2>/dev/null) && return 0

# --- executed directly from here on: now it's safe to harden our own shell ---
set -euo pipefail
cd "$RW_REPO" || exit 1

if [[ "${1:-}" != "--demo" ]]; then
  echo "usage: $0 --demo            # walk a sample run end-to-end (no email, no real leads)"
  echo "       source $0            # then call emit <kind> <status> <summary> [level] [flags]"
  exit 2
fi

# ---- demo run: simulated happy path that terminates cleanly without external actions ----
command -v tsx >/dev/null 2>&1 || { echo "error: tsx not found on PATH (run from the repo; node_modules/.bin missing?)" >&2; exit 2; }
RUN="pc-demo-$(date +%s)"
echo "[pc-lead-scout] demo run: $RUN  (agent=$AGENT) — no email is sent"

DETAIL_TMP="$(mktemp)"; printf '{"source":"demo","note":"sample data, no real venues contacted"}' > "$DETAIL_TMP"
trap 'rm -f "$DETAIL_TMP"' EXIT

PC_TRIGGER_TYPE="demo" PC_TRIGGER_SOURCE="pc-lead-scout.sh --demo" \
  emit started running "Daily lead scout run started" info \
    --description "Finds venue leads for portable charging, dedupes, drafts outreach, and sends a review packet to Arjun. Never sends outreach itself." \
    --detail-file "$DETAIL_TMP"
sleep 1
emit spreadsheet_pull running "Simulated spreadsheet pull (no external request)" info \
  --artifact-type link --artifact-title "Demo documentation" \
  --artifact-uri "$RW_REPO/docs/agent-orchestration.md"
sleep 1
emit dedupe running "Simulated dedupe against 214 sample leads"
sleep 1
emit found running "Simulated discovery of 8 candidate venues"
sleep 1
emit qualified running "Simulated qualification of 5 candidate venues"
sleep 1
emit drafts running "Simulated 5 outreach drafts (not written or sent)" info \
  --artifact-type link --artifact-title "Demo documentation" \
  --artifact-uri "$RW_REPO/docs/agent-orchestration.md"
sleep 1
emit review_packet running "Simulated review-packet stage (no email sent)" success
sleep 1
emit completed completed "Demo completed; no outreach or review email sent" success

echo "[pc-lead-scout] demo complete — run $RUN is completed on /agents"
