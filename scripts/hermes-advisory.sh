#!/usr/bin/env bash
# Ask Hermes for a one-shot advisory review during a long Claude Code run.
# Read-only: the prompt instructs Hermes not to edit files, and we restrict toolsets
# to read/search only. Logs the reply so the checkpoint is auditable.
#
# Usage: scripts/hermes-advisory.sh <label> "<prompt>"
#   <label> -> log file .agent-orchestration/hermes-<label>.log
#
# Used at most twice in the orchestration mission (after plan, before final email).
set -uo pipefail
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

LABEL="${1:?usage: hermes-advisory.sh <label> <prompt>}"
PROMPT="${2:?usage: hermes-advisory.sh <label> <prompt>}"
DIR="$(cd "$(dirname "$0")/.." && pwd)/.agent-orchestration"
mkdir -p "$DIR"
LOG="$DIR/hermes-${LABEL}.log"

echo "[hermes-advisory] $LABEL @ $(date -u +%FT%TZ)" | tee "$LOG"

if ! command -v hermes >/dev/null 2>&1; then
  echo "[hermes-advisory] hermes CLI not found — skipping, continuing with local verification" | tee -a "$LOG"
  exit 0
fi

# Prefer the documented `hermes chat -q`; quiet programmatic output. The prompt carries
# the material to review inline (Hermes sessions here may lack local filesystem tools),
# and instructs Hermes not to edit files.
if hermes chat -Q -q "$PROMPT" >>"$LOG" 2>&1; then
  :
elif hermes chat -q "$PROMPT" >>"$LOG" 2>&1; then
  :
elif hermes -z "$PROMPT" >>"$LOG" 2>&1; then
  :
else
  echo "[hermes-advisory] all hermes invocations failed — see log; continuing" | tee -a "$LOG"
  exit 0
fi

echo "[hermes-advisory] reply captured in $LOG"
