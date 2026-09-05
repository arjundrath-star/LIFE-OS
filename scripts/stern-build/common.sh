#!/usr/bin/env bash
# Shared paths for the Stern build. Source this; do not execute.
(return 0 2>/dev/null) || { echo "source this file"; exit 2; }
export STERN_BUILD_ROOT=/home/Arjun/stern-build
export STERN_MAIN_REPO=/home/Arjun/rathworkspace              # PROD checkout. Never build, migrate, or edit here before WP7.
export STERN_WT=$STERN_BUILD_ROOT/wt                          # worktrees: stern-tab (integration), wp1..wp8 (Codex)
export STERN_DB_DIR=$STERN_BUILD_ROOT/db                      # DB copies. stern-dev.db is the pristine copy of prod as of Sept 4.
export STERN_LOGS=$STERN_BUILD_ROOT/logs
export STERN_REPORTS=$STERN_BUILD_ROOT/reports
export STERN_EMAIL_TO=arjundrath@gmail.com
export STERN_EMAIL_FROM=arjun@kladeai.com
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR=/home/Arjun/.config/gws-arjun
export PATH="/home/Arjun/.local/bin:/home/Arjun/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
mkdir -p "$STERN_LOGS" "$STERN_REPORTS" "$STERN_DB_DIR"
stern_ts() { date -u +%Y%m%dT%H%M%SZ; }
