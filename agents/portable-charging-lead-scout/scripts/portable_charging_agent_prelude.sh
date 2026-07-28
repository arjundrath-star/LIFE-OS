#!/usr/bin/env bash
# Hermes cron prelude for the SAFE Portable Charging lead scout.
# Runs before the LLM cron session. It creates the visible dashboard run and prints the
# run id + helper command into the cron prompt context.
set -euo pipefail

RW_REPO="${RATHWORKSPACE_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
PC_DIR="${CHARGING_PROJECT_DIR:-$HOME/command-center/Portable Charging}"
CRON_SOURCE="${PC_CRON_SOURCE:-Hermes cron}"
RUN_ID="pc-leads-$(date -u +%Y%m%dT%H%M%SZ)"
HERMES_RUN_ID="hermes-dispatch-$(date -u +%Y%m%dT%H%M%SZ)"
export PATH="$RW_REPO/node_modules/.bin:$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if [[ "${PC_PRELUDE_SMOKE:-}" == "1" ]]; then
  cat <<EOF
RATHWORKSPACE_AGENT_RUN_ID=pc-prelude-smoke
RATHWORKSPACE_AGENT_HELPER=$PC_DIR/agent_event.sh
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
  --trigger-source "$CRON_SOURCE" \
  >/dev/null

# Record the worker run start.
tsx scripts/agent-event.ts \
  --agent portable-charging-lead-scout \
  --run "$RUN_ID" \
  --kind started \
  --status running \
  --summary "Safe daily lead scout cron started" \
  --trigger-type cron \
  --trigger-source "$CRON_SOURCE" \
  --display-name "Portable Charging Lead Scout" \
  --description "Finds venue leads, dedupes, drafts outreach, and prepares an internal review packet. Never sends outreach itself." \
  --schedule-label "daily 9:00 ET" \
  >/dev/null

cat <<EOF
RATHWORKSPACE_AGENT_RUN_ID=$RUN_ID
RATHWORKSPACE_AGENT_HELPER=$PC_DIR/agent_event.sh

The /agents dashboard run has already been created as portable-charging-lead-scout/$RUN_ID.
For every milestone, run the helper with this exact run id, for example:
  export PC_AGENT_RUN_ID="$RUN_ID"
  "\$RATHWORKSPACE_AGENT_HELPER" spreadsheet_pull running "Pulled Drive spreadsheets"
  "\$RATHWORKSPACE_AGENT_HELPER" dedupe running "Built dedupe index from existing leads"
  "\$RATHWORKSPACE_AGENT_HELPER" found running "Found N candidate venues"
  "\$RATHWORKSPACE_AGENT_HELPER" qualified running "Appended N qualified non-duplicate leads"
  "\$RATHWORKSPACE_AGENT_HELPER" drafts running "Drafted N emails for review only"
  "\$RATHWORKSPACE_AGENT_HELPER" review_packet waiting_for_review "Sent review packet to the internal reviewer"
  "\$RATHWORKSPACE_AGENT_HELPER" completed completed "Lead scout completed; waiting on review" success
If blocked or failed, emit status blocked/failed with a truthful summary.
EOF
