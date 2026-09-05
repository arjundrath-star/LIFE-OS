#!/usr/bin/env bash
# Open the orchestrator tmux session. Run once, from any directory:
#   bash /home/Arjun/stern-build/wt/stern-tab/scripts/stern-build/session.sh
# Window 0: Fable (Claude Code, permissions off) reading the kickoff prompt. Window 1: live logs.
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
INT="$STERN_WT/stern-tab"
if tmux has-session -t stern-build 2>/dev/null; then echo "session exists; attaching"; exec tmux attach -t stern-build; fi
tmux new-session -d -s stern-build -n orchestrator -c "$INT" \
  "claude --dangerously-skip-permissions 'ultracode. Read docs/plans/stern/prompts/ORCHESTRATOR-KICKOFF.md in this worktree and execute it end to end. You are the orchestrator for the Stern tab weekend build.'"
tmux new-window -t stern-build -n logs -c "$STERN_LOGS" "tail -F $STERN_LOGS/*.log 2>/dev/null"
tmux select-window -t stern-build:orchestrator
exec tmux attach -t stern-build
