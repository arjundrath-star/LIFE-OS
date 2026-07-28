#!/usr/bin/env bash
# Interactive build-session launcher. Opens a tmux session at the repo root running an
# agent that must discover the current task and repo state before it edits anything.
# Permission gates stay enabled; the agent never gets a standing mandate to change things.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
exec tmux new-session -s build -c "$REPO" \
  "claude 'Read AGENTS.md and CLAUDE.md, inspect git status, then ask for the exact task before editing. Keep all permission gates enabled.'"
