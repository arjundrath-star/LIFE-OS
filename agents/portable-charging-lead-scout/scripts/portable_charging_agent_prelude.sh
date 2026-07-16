#!/usr/bin/env bash
# Hermes cron prelude for the SAFE Portable Charging lead scout.
# Runs before the LLM cron session. It creates the visible dashboard run and prints the
# run id + helper command into the cron prompt context.
set -euo pipefail

RW_REPO="/home/Arjun/rathworkspace"
RUN_ID="pc-leads-$(date -u +%Y%m%dT%H%M%SZ)"
HERMES_RUN_ID="hermes-dispatch-$(date -u +%Y%m%dT%H%M%SZ)"
export PATH="$RW_REPO/node_modules/.bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if [[ "${PC_PRELUDE_SMOKE:-}" == "1" ]]; then
  cat <<'EOF'
RATHWORKSPACE_AGENT_RUN_ID=pc-prelude-smoke
RATHWORKSPACE_AGENT_HELPER=/home/Arjun/command-center/Portable Charging/agent_event.sh
EOF
  exit 0
fi

cd "$RW_REPO"

# Record Hermes dispatch as the top-level orchestrator.
tsx scripts/agent-event.ts \
  --agent hermes-orchestrator \
  --run "$HERMES_RUN_ID" \
  --kind dispatch \
  --status completed \
  --summary "Dispatched Portable Charging Lead Scout safe daily cron" \
  --trigger-type cron \
  --trigger-source "Hermes cron CRON_JOB_ID" \
  >/dev/null

# Record the worker run start.
tsx scripts/agent-event.ts \
  --agent portable-charging-lead-scout \
  --run "$RUN_ID" \
  --kind started \
  --status running \
  --summary "Safe daily lead scout cron started" \
  --trigger-type cron \
  --trigger-source "Hermes cron CRON_JOB_ID" \
  --display-name "Portable Charging Lead Scout" \
  --description "Finds venue leads, dedupes, drafts outreach, and sends Arjun a review packet. Never sends outreach itself." \
  --schedule-label "daily 9:00 ET" \
  >/dev/null

cat <<EOF
RATHWORKSPACE_AGENT_RUN_ID=$RUN_ID
RATHWORKSPACE_AGENT_HELPER=/home/Arjun/command-center/Portable Charging/agent_event.sh

The /agents dashboard run has already been created as portable-charging-lead-scout/$RUN_ID.
For every milestone, run the helper with this exact run id, for example:
  export PC_AGENT_RUN_ID="$RUN_ID"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh spreadsheet_pull running "Pulled Drive spreadsheets"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh dedupe running "Built dedupe index from existing leads"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh found running "Found N candidate venues"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh qualified running "Appended N qualified non-duplicate leads"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh drafts running "Drafted N emails for review only"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh review_packet waiting_for_review "Sent review packet to operator@example.com"
  /home/Arjun/command-center/Portable\\ Charging/agent_event.sh completed completed "Lead scout completed; waiting on Arjun review" success
If blocked or failed, emit status blocked/failed with a truthful summary.
EOF
