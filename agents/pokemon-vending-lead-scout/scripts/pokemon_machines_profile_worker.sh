#!/usr/bin/env bash
# Dispatcher for the dedicated pokemon-scout Hermes profile.
set -euo pipefail

PROJECT_DIR="/home/Arjun/command-center/Pokemon Machines"
PROMPT_FILE="/home/Arjun/rathworkspace/agents/pokemon-vending-lead-scout/profile-worker-prompt.md"
RUN_ID="pokemon-leads-$(date -u +%Y%m%dT%H%M%SZ)"
export POKEMON_SCOUT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_TRIGGER_TYPE="manual"
export POKEMON_AGENT_TRIGGER_SOURCE="pokemon-scout profile worker"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Pokemon scout failed: missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi
if ! command -v hermes >/dev/null 2>&1; then
  echo "Pokemon scout failed: hermes CLI not on PATH" >&2
  exit 1
fi

cd "$PROJECT_DIR"

if [[ "${POKEMON_SCOUT_SMOKE:-}" == "1" ]]; then
  exec hermes -p pokemon-scout chat \
    --quiet \
    --source pokemon-scout-smoke \
    --toolsets file,terminal,skills \
    --skills pokemon-vending-lead-scout \
    --max-turns 6 \
    --query "Smoke test only. Do not edit files, contact businesses, create leads, commit, push, or schedule anything. Reply in one sentence with your profile name, project dir $PROJECT_DIR, run id $RUN_ID, and the Pokemon location-fit doctrine."
fi

USER_PROMPT="$(cat <<EOF
Run id: $RUN_ID
Project dir: $PROJECT_DIR
Terminal workdir symlink: /home/Arjun/command-center/Pokemon_Machines

When using terminal tools, set workdir to /home/Arjun/command-center/Pokemon_Machines.

$(cat "$PROMPT_FILE")
EOF
)"

exec hermes -p pokemon-scout chat \
  --quiet \
  --source pokemon-scout-profile-worker \
  --toolsets web,file,terminal,skills,session_search,todo \
  --skills pokemon-vending-lead-scout \
  --max-turns 90 \
  --query "$USER_PROMPT"
