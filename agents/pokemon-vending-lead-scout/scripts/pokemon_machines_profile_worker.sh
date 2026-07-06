#!/usr/bin/env bash
# Dispatcher for the dedicated pokemon-scout Hermes profile.
set -euo pipefail

PROJECT_DIR="/home/Arjun/command-center/Pokemon Machines"
PROMPT_FILE="/home/Arjun/rathworkspace/agents/pokemon-vending-lead-scout/profile-worker-prompt.md"
RUN_ID="pokemon-leads-$(date -u +%Y%m%dT%H%M%SZ)"
HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
if [[ -z "$HERMES_BIN" && -x /home/Arjun/.local/bin/hermes ]]; then
  HERMES_BIN="/home/Arjun/.local/bin/hermes"
fi
export POKEMON_SCOUT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_RUN_ID="$RUN_ID"
export POKEMON_AGENT_TRIGGER_TYPE="manual"
export POKEMON_AGENT_TRIGGER_SOURCE="pokemon-scout profile worker"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Pokemon scout failed: missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi
if [[ -z "$HERMES_BIN" || ! -x "$HERMES_BIN" ]]; then
  echo "Pokemon scout failed: hermes CLI not found; set HERMES_BIN or install at /home/Arjun/.local/bin/hermes" >&2
  exit 1
fi

cd "$PROJECT_DIR"

if [[ "${POKEMON_SCOUT_SMOKE:-}" == "1" ]]; then
  exec "$HERMES_BIN" -p pokemon-scout chat \
    --quiet \
    --source pokemon-scout-smoke \
    --toolsets file,terminal,skills \
    --skills pokemon-vending-lead-scout \
    --max-turns 6 \
    --query "Smoke test only. Do not edit files, contact businesses, create leads, commit, push, or schedule anything. Reply in one sentence with your profile name, project dir $PROJECT_DIR, run id $RUN_ID, and the Pokemon location-fit doctrine."
fi

if [[ "${POKEMON_AGENTIC_RUN:-}" != "1" ]]; then
  EVENT="$PROJECT_DIR/agent_event.sh"
  SCRAPER="$PROJECT_DIR/scripts/pokemon_lead_system.py"
  SYNC="$PROJECT_DIR/scripts/sync_pokemon_vending_drive.py"
  GOOGLE_PY="/home/Arjun/.hermes/google-venv/bin/python"
  "$EVENT" started running "Pokemon vending lead scraper started" success >/dev/null
  "$EVENT" context_loaded running "Loaded owner-first Pokemon context and initial prospect sheet" success >/dev/null
  POKEMON_USE_OSM_CACHE=1 "$GOOGLE_PY" "$SCRAPER" >/tmp/pokemon_lead_system_${RUN_ID}.json
  "$EVENT" sheet_build running "Built Pokemon vending MAIN and Active sheets" success >/dev/null
  "$EVENT" found running "Migrated initial leads and scraped at least 100 additional candidates" success >/dev/null
  "$GOOGLE_PY" "$SYNC" >/tmp/pokemon_drive_sync_${RUN_ID}.json
  "$EVENT" drive_sync running "Updated Drive copies in pokemon vending folder" success >/dev/null
  SUMMARY=$(python3 - <<PY
import csv, json
from pathlib import Path
root=Path('$PROJECT_DIR')
rows=list(csv.DictReader((root/'pokemon vending/Pokemon_Vending_Lead_Pipeline.csv').open(encoding='utf-8')))
manifest=json.loads((root/'pokemon_vending_drive_manifest.json').read_text())
print(f"Pokemon vending lead system refreshed: {len(rows)} MAIN rows, {sum(r['Source']=='Initial Claude prospect sheet' for r in rows)} seed, {sum(r['Source']!='Initial Claude prospect sheet' for r in rows)} scraped, Drive {manifest['pokemon_vending_folder']['id']}")
PY
)
  "$EVENT" completed completed "$SUMMARY" success >/dev/null
  printf 'VPS: %s\n' "$SUMMARY"
  exit 0
fi

USER_PROMPT="$(cat <<EOF
Run id: $RUN_ID
Project dir: $PROJECT_DIR
Terminal workdir symlink: /home/Arjun/command-center/Pokemon_Machines

When using terminal tools, set workdir to /home/Arjun/command-center/Pokemon_Machines.

$(cat "$PROMPT_FILE")
EOF
)"

exec "$HERMES_BIN" -p pokemon-scout chat \
  --quiet \
  --source pokemon-scout-profile-worker \
  --toolsets web,file,terminal,skills,session_search,todo \
  --skills pokemon-vending-lead-scout \
  --max-turns 90 \
  --query "$USER_PROMPT"
