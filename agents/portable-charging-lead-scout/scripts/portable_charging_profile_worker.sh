#!/usr/bin/env bash
# Dispatch Portable Charging Lead Scout work to the dedicated portable-scout Hermes profile.
# This script is intended to be run by the default Hermes cron scheduler in no-agent mode.
# The LLM work happens in the separate portable-scout profile; stdout is delivered by cron.
set -euo pipefail

RW_REPO="/home/Arjun/rathworkspace"
PC_DIR="/home/Arjun/command-center/Portable Charging"
PRELUDE="$RW_REPO/agents/portable-charging-lead-scout/scripts/portable_charging_agent_prelude.sh"
PROMPT_FILE="$RW_REPO/agents/portable-charging-lead-scout/profile-worker-prompt.md"
HELPER="$PC_DIR/agent_event.sh"

if [[ ! -x "$PRELUDE" ]]; then
  echo "Portable scout dispatch failed: prelude not executable: $PRELUDE" >&2
  exit 1
fi
if [[ ! -f "$PROMPT_FILE" ]]; then
  echo "Portable scout dispatch failed: missing prompt file: $PROMPT_FILE" >&2
  exit 1
fi
if ! command -v hermes >/dev/null 2>&1; then
  echo "Portable scout dispatch failed: hermes CLI not on PATH" >&2
  exit 1
fi

if [[ "${PC_PROFILE_WORKER_SMOKE:-}" == "1" ]]; then
  cd "$PC_DIR"
  exec hermes -p portable-scout chat \
    --quiet \
    --source smoke-test \
    --toolsets file,terminal,skills \
    --skills placement-business-lead-finder-fit-scorer \
    --max-turns 5 \
    --query "Smoke test only. Do not edit files. Reply in one sentence: identify your profile, workdir, and venue-outreach permission."
fi

PRELUDE_OUTPUT="$($PRELUDE)"
RUN_ID="$(printf '%s\n' "$PRELUDE_OUTPUT" | awk -F= '/^RATHWORKSPACE_AGENT_RUN_ID=/{print $2; exit}')"
if [[ -z "${RUN_ID:-}" ]]; then
  echo "Portable scout dispatch failed: prelude did not emit RATHWORKSPACE_AGENT_RUN_ID" >&2
  exit 1
fi
export PC_AGENT_RUN_ID="$RUN_ID"
export PC_AGENT_TRIGGER_TYPE="cron"
export PC_AGENT_TRIGGER_SOURCE="Hermes default cron -> portable-scout profile worker"

ARCHIVE_DIR="$PC_DIR/Archive/lead-gen/$(date -u +%F)/$RUN_ID"
mkdir -p "$ARCHIVE_DIR"

USER_PROMPT="$(cat <<EOF
## Dashboard/script prelude context

\`\`\`
$PRELUDE_OUTPUT
\`\`\`

## Runtime instruction

You are being launched by the default Hermes cron scheduler, but all work in this turn must be performed by the dedicated \`portable-scout\` Hermes profile. Use the run id above for Rathworkspace dashboard events.

Durable archive folder for this run: \`$ARCHIVE_DIR\`. You must write the archive files described in the worker prompt even if the run is blocked or produces zero new leads.

$(cat "$PROMPT_FILE")
EOF
)"

LOG_DIR="$PC_DIR/Logs/profile-worker"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${RUN_ID}.log"
PROMPT_FILE_TMP="/tmp/portable-scout-${RUN_ID}.prompt.md"
printf '%s\n' "$USER_PROMPT" > "$PROMPT_FILE_TMP"
cp "$PROMPT_FILE_TMP" "$ARCHIVE_DIR/request-prompt.md"
cat > "$ARCHIVE_DIR/run-summary.md" <<EOF
# Portable Charging lead scout archive

Run id: $RUN_ID
Status: dispatched
Started UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Log: $LOG_FILE

This summary is initialized by the cron wrapper. The portable-scout worker must update this archive with final lead/draft/Drive results.
EOF
cat > "$ARCHIVE_DIR/manifest.md" <<EOF
# Manifest

- Run id: $RUN_ID
- Prompt: $ARCHIVE_DIR/request-prompt.md
- Worker log: $LOG_FILE
- Cron wrapper archive: $ARCHIVE_DIR
EOF
printf 'run_id,status,venue\n' > "$ARCHIVE_DIR/new-leads.csv"
printf 'No drafts created by wrapper before worker completion. Worker should replace/update this file.\n' > "$ARCHIVE_DIR/drafts.md"

run_worker() {
  cd "$PC_DIR"
  hermes -p portable-scout chat \
    --quiet \
    --source cron-profile-worker \
    --toolsets web,file,terminal,delegation,skills,session_search,todo \
    --skills placement-business-lead-finder-fit-scorer,google-workspace,obsidian \
    --max-turns 90 \
    --query "$(cat "$PROMPT_FILE_TMP")"
}

if [[ "${PC_PROFILE_WORKER_FOREGROUND:-}" == "1" ]]; then
  set +e
  OUTPUT="$(run_worker 2>&1)"
  STATUS=$?
  set -e
  rm -f "$PROMPT_FILE_TMP"
  printf '%s\n' "$OUTPUT" > "$LOG_FILE"

  if [[ $STATUS -ne 0 ]]; then
    "$HELPER" failed failed "portable-scout profile worker exited non-zero before completing lead scout; archive=$ARCHIVE_DIR" error >/dev/null || true
    cat > "$ARCHIVE_DIR/run-summary.md" <<EOF
# Portable Charging lead scout archive

Run id: $RUN_ID
Status: failed
Completed UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Log: $LOG_FILE
Archive: $ARCHIVE_DIR

The worker exited non-zero before completing. No venue outreach was sent by this wrapper.
EOF
    printf 'VPS: portable-scout profile worker failed for `%s`. Archive: `%s`; log: `%s`\n' "$RUN_ID" "$ARCHIVE_DIR" "$LOG_FILE"
    exit $STATUS
  fi

  printf '%s\n' "$OUTPUT"
  exit 0
fi

(
  trap '' HUP
  set +e
  run_worker > "$LOG_FILE" 2>&1
  STATUS=$?
  rm -f "$PROMPT_FILE_TMP"
  if [[ $STATUS -ne 0 ]]; then
    "$HELPER" failed failed "portable-scout profile worker exited non-zero before completing lead scout; see $LOG_FILE; archive=$ARCHIVE_DIR" error >/dev/null || true
    cat > "$ARCHIVE_DIR/run-summary.md" <<EOF
# Portable Charging lead scout archive

Run id: $RUN_ID
Status: failed
Completed UTC: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Log: $LOG_FILE
Archive: $ARCHIVE_DIR

The worker exited non-zero before completing. No venue outreach was sent by this wrapper.
EOF
  else
    printf 'completed_at_utc=%s\nlog=%s\narchive=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LOG_FILE" "$ARCHIVE_DIR" > "$ARCHIVE_DIR/worker-status.txt"
  fi
  exit $STATUS
) </dev/null >/dev/null 2>&1 &
PID=$!
"$HELPER" dispatched running "portable-scout profile worker dispatched in background pid=$PID; log=$LOG_FILE; archive=$ARCHIVE_DIR" >/dev/null || true

GRACE_SECONDS="${PC_PROFILE_WORKER_DISPATCH_GRACE_SECONDS:-20}"
sleep "$GRACE_SECONDS"
if ! kill -0 "$PID" 2>/dev/null; then
  set +e
  wait "$PID"
  STATUS=$?
  set -e
  if [[ $STATUS -ne 0 ]]; then
    printf 'VPS: portable-scout profile worker failed immediately for `%s`. Archive: `%s`; log: `%s`\n' "$RUN_ID" "$ARCHIVE_DIR" "$LOG_FILE"
    exit $STATUS
  fi
  printf 'VPS: portable-scout profile worker completed quickly for `%s`. Archive: `%s`; log: `%s`\n' "$RUN_ID" "$ARCHIVE_DIR" "$LOG_FILE"
  exit 0
fi

disown "$PID" 2>/dev/null || true
printf 'VPS: portable-scout profile worker dispatched for `%s` in background. Dashboard will track progress. Archive: `%s`; log: `%s`\n' "$RUN_ID" "$ARCHIVE_DIR" "$LOG_FILE"
