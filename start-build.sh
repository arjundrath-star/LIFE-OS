#!/usr/bin/env bash
# Safe interactive Rathworkspace build-session launcher. The agent must discover the current
# task and repository state; never revive the historical OpenClaw build prompt or bypass gates.
set -euo pipefail

REPO="/home/Arjun/rathworkspace"
cd "$REPO"
exec tmux new-session -s build -c "$REPO" \
  "claude 'Read AGENTS.md and CLAUDE.md, inspect git status, then ask for the exact task before editing. Keep all permission gates enabled.'"
