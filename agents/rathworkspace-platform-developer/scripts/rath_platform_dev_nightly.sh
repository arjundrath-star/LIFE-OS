#!/usr/bin/env bash
# Nightly Rathworkspace/VPS/Obsidian developer maintenance dispatcher.
# Cron invokes ~/.hermes/scripts/rath_platform_dev_nightly.sh, which delegates here.
# The real reasoning happens in the dedicated rath-platform-dev Hermes profile.
set -euo pipefail

RW_REPO="/home/Arjun/rathworkspace"
PROMPT_FILE="$RW_REPO/agents/rathworkspace-platform-developer/nightly-maintenance-prompt.md"
MEMO_DIR="/home/Arjun/command-center/Hermes/daily-memo-inputs"
RUN_ID="platform-nightly-$(date -u +%Y%m%dT%H%M%SZ)"
export RATH_PLATFORM_DEV_RUN_ID="$RUN_ID"
export RATH_PLATFORM_DEV_MEMO_DIR="$MEMO_DIR"

if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Rath platform nightly failed: missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi
if ! command -v hermes >/dev/null 2>&1; then
  echo "Rath platform nightly failed: hermes CLI not on PATH" >&2
  exit 1
fi
mkdir -p "$MEMO_DIR"

cd "$RW_REPO"

if [[ "${RATH_PLATFORM_DEV_SMOKE:-}" == "1" ]]; then
  exec hermes -p rath-platform-dev chat \
    --quiet \
    --source smoke-test \
    --toolsets file,terminal,skills \
    --skills rathworkspace-platform-developer,software-development-workflows,rathworkspace-nightly-maintainer \
    --max-turns 6 \
    --query "Smoke test only. Do not edit files, commit, push, restart services, or clean anything. Reply in one sentence with your profile, repo cwd, run id $RUN_ID, and nightly safety posture."
fi

npm run agent-event -- \
  --agent rathworkspace-platform-developer \
  --run "$RUN_ID" \
  --kind started \
  --status running \
  --summary "Nightly developer maintenance started" \
  --trigger-type cron \
  --trigger-source "rath-platform-dev nightly maintenance" >/dev/null || true

USER_PROMPT="$(cat <<EOF
## Script context

- Run id: $RUN_ID
- Memo dir: $MEMO_DIR
- Repo cwd: $RW_REPO
- Trigger: cron nightly 11:45 PM ET

$(cat "$PROMPT_FILE")
EOF
)"

set +e
OUTPUT="$(hermes -p rath-platform-dev chat \
  --quiet \
  --source cron-nightly-maintenance \
  --toolsets web,file,terminal,skills,session_search,todo,delegation \
  --skills rathworkspace-platform-developer,software-development-workflows,github-operations,obsidian,rathworkspace-nightly-maintainer \
  --max-turns 120 \
  --query "$USER_PROMPT" 2>&1)"
STATUS=$?
set -e

if [[ $STATUS -ne 0 ]]; then
  npm run agent-event -- \
    --agent rathworkspace-platform-developer \
    --run "$RUN_ID" \
    --kind failed \
    --status failed \
    --level error \
    --summary "Nightly developer maintenance profile worker exited non-zero" \
    --trigger-type cron \
    --trigger-source "rath-platform-dev nightly maintenance" >/dev/null || true
  printf 'VPS: rath-platform-dev nightly maintenance failed for `%s`.\n\n```\n%s\n```\n' "$RUN_ID" "$OUTPUT"
  exit $STATUS
fi

printf '%s\n' "$OUTPUT"
