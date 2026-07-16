#!/usr/bin/env bash
# Nightly Rathworkspace/VPS/Obsidian developer maintenance dispatcher.
# Cron invokes ~/.hermes/scripts/rath_platform_dev_nightly.sh, which delegates here.
# The real reasoning happens in the dedicated rath-platform-dev Hermes profile.
set -euo pipefail

RW_REPO="/home/Arjun/rathworkspace"
PROMPT_FILE="$RW_REPO/agents/rathworkspace-platform-developer/nightly-maintenance-prompt.md"
MEMO_DIR="/home/Arjun/command-center/Hermes/daily-memo-inputs"
LOG_DIR="/home/Arjun/command-center/Hermes/logs/rath-platform-dev-nightly"
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
mkdir -p "$MEMO_DIR" "$LOG_DIR"

cd "$RW_REPO"

if [[ "${RATH_PLATFORM_DEV_SMOKE:-}" == "1" ]]; then
  exec hermes -p rath-platform-dev chat \
    --quiet \
    --source smoke-test \
    --toolsets file,terminal,skills \
    --skills rathworkspace-platform-developer,software-development-workflows,rathworkspace-nightly-maintainer,google-workspace,placement-business-lead-finder-fit-scorer,pokemon-vending-lead-scout \
    --max-turns 6 \
    --query "Smoke test only. Do not edit files, commit, push, restart services, or clean anything. Reply in one sentence with your profile, repo cwd, run id $RUN_ID, and nightly safety posture."
fi

npm run agent-event -- \
  --agent rathworkspace-platform-developer \
  --run "$RUN_ID" \
  --kind started \
  --status running \
  --summary "Nightly developer maintenance started" \
  --schedule-label "nightly 11:45 PM ET + manual" \
  --trigger-type cron \
  --trigger-source "rath-platform-dev nightly maintenance" >/dev/null || true

USER_PROMPT="$(cat <<EOF
## Script context

- Run id: $RUN_ID
- Memo dir: $MEMO_DIR
- Repo cwd: $RW_REPO
- Trigger: cron nightly 11:45 PM ET
- Wrapper mode: background dispatch. Cron should not wait for the whole agent run; write the memo and events from the worker.

$(cat "$PROMPT_FILE")
EOF
)"

PROMPT_TMP="/tmp/rath-platform-dev-${RUN_ID}.prompt.md"
LOG_FILE="$LOG_DIR/${RUN_ID}.log"
printf '%s\n' "$USER_PROMPT" > "$PROMPT_TMP"

write_fallback_memo() {
  local status="$1"
  local memo="$MEMO_DIR/$(date +%F)-nightly-dev-review.md"
  if [[ -s "$memo" ]]; then
    return 0
  fi
  cat > "$memo" <<EOF
# Nightly developer review - $(date +%F)

Run id: $RUN_ID
Profile: rath-platform-dev

## Cleaned / fixed
- Nightly worker did not complete normally before writing a full memo.

## Verified
- Wrapper created this fallback memo so the morning briefing has a durable pointer.

## Git/repo status
- Not inspected by fallback wrapper.

## VPS / services
- Not inspected by fallback wrapper.

## Security
- Not inspected by fallback wrapper.

## For Arjun tomorrow
- Review worker status: $status.
- Log: $LOG_FILE
EOF
}

run_worker() {
  cd "$RW_REPO"
  hermes -p rath-platform-dev chat \
    --quiet \
    --source cron-nightly-maintenance \
    --toolsets web,file,terminal,skills,session_search,todo,delegation \
    --skills rathworkspace-platform-developer,software-development-workflows,github-operations,obsidian,rathworkspace-nightly-maintainer,google-workspace,placement-business-lead-finder-fit-scorer,pokemon-vending-lead-scout \
    --max-turns 120 \
    --query "$(cat "$PROMPT_TMP")"
}

if [[ "${RATH_PLATFORM_DEV_FOREGROUND:-}" == "1" ]]; then
  set +e
  run_worker > "$LOG_FILE" 2>&1
  STATUS=$?
  set -e
  rm -f "$PROMPT_TMP"
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
    write_fallback_memo "failed foreground status=$STATUS"
    printf 'VPS: rath-platform-dev nightly maintenance failed for `%s`. Log: `%s`\n' "$RUN_ID" "$LOG_FILE"
    exit $STATUS
  fi
  printf 'VPS: rath-platform-dev nightly maintenance completed for `%s`. Log: `%s`\n' "$RUN_ID" "$LOG_FILE"
  exit 0
fi

(
  trap '' HUP
  set +e
  run_worker > "$LOG_FILE" 2>&1
  STATUS=$?
  rm -f "$PROMPT_TMP"
  if [[ $STATUS -ne 0 ]]; then
    npm run agent-event -- \
      --agent rathworkspace-platform-developer \
      --run "$RUN_ID" \
      --kind failed \
      --status failed \
      --level error \
      --summary "Nightly developer maintenance profile worker exited non-zero; see $LOG_FILE" \
      --trigger-type cron \
      --trigger-source "rath-platform-dev nightly maintenance" >/dev/null || true
    write_fallback_memo "failed background status=$STATUS"
  fi
  exit $STATUS
) </dev/null >/dev/null 2>&1 &
PID=$!

GRACE_SECONDS="${RATH_PLATFORM_DEV_DISPATCH_GRACE_SECONDS:-20}"
sleep "$GRACE_SECONDS"
if ! kill -0 "$PID" 2>/dev/null; then
  set +e
  wait "$PID"
  STATUS=$?
  set -e
  if [[ $STATUS -ne 0 ]]; then
    printf 'VPS: rath-platform-dev nightly maintenance failed immediately for `%s`. Log: `%s`\n' "$RUN_ID" "$LOG_FILE"
    exit $STATUS
  fi
  printf 'VPS: rath-platform-dev nightly maintenance completed quickly for `%s`. Log: `%s`\n' "$RUN_ID" "$LOG_FILE"
  exit 0
fi

disown "$PID" 2>/dev/null || true
printf 'VPS: rath-platform-dev nightly maintenance dispatched for `%s` in background. Memo dir: `%s`; log: `%s`\n' "$RUN_ID" "$MEMO_DIR" "$LOG_FILE"
