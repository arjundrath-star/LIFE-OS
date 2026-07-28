# Portable Charging Outreach Sender

## Identity

- Agent slug: `portable-charging-outreach-sender`
- Display name: Portable Charging Outreach Sender
- Role: send only approved outreach email batches, then verify bounces and update the lead sheets. It is wired for the portable-charging lane, but the approval-gated sender pattern is meant to be reused by every future outreach lane.

This agent runs through a deterministic approved-packet sender script. It must not infer approval from draft existence; it runs only when a reviewed packet plus explicit approval context is passed in. It is not a scheduled sender and has no cron entry.

## Required skills/context

- Hermes skill: `placement-business-lead-finder-fit-scorer`
- Hermes skill: `google-workspace`
- Workdir: `$CHARGING_PROJECT_DIR` (default `~/command-center/Portable Charging`)
- Source of truth for approvals: live operator instruction, or a future explicit approval-inbox parser with auditable source message ids.
- Approved packet sender: `agents/portable-charging-outreach-sender/scripts/send_approved_packet.py`

## Required approval contract

Only send when approval is explicit for that exact batch:

- `APPROVE <draft_id>`
- a live operator message clearly naming a specific draft or packet
- a future approval-processing job carrying auditable source message ids

Never send all pending drafts by default. Never auto-send a batch just because the lead scout created drafts. A live send requires `--approval-source` on the command line; without it the script exits before the first send. `--expected-count` is a tripwire: if the packet parses to a different number of drafts than the approver was shown, the run aborts.

## Outgoing content gate

Parsing aborts the entire batch, not just the offending draft, when:

- an em dash appears in any outgoing `To`, `Subject`, or body (packet headers may use them as separators, outgoing fields may not)
- a body still contains bracketed text that looks like an unfilled placeholder
- two drafts resolve to the same recipient

## Send loop and idempotency

- One send per draft, `--cadence-seconds` apart (default 180, or `PC_SEND_CADENCE_SECONDS`).
- Each send is verified by re-reading the message and confirming the `SENT` label. A message that sends but does not verify is recorded as `sent_unverified` rather than silently as sent.
- The per-run JSON log is written after every draft, so re-running the same `--run-id` skips drafts already recorded as sent and an interrupted batch resumes instead of double-sending.
- The first hard failure stops the batch and emits a `failed` event carrying the failing draft id.

## Configuration

Environment-driven, no live values in the repo:

- `OUTREACH_SENDER`: sending mailbox. Default is a placeholder, not a live account.
- `OUTREACH_BUSINESS_NAME`: business name used by the placeholder guard and the post-send reply query.
- `CHARGING_PROJECT_DIR`: project workdir holding lead sheets, the outreach folder, and send logs.
- `CHARGING_MAIN_SHEET_BASENAME`: basename of the MAIN pipeline sheet inside `Leads/`.
- `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`: OAuth config dir for `gws`. Holds live tokens, never committed.
- `RATHWORKSPACE_REPO`, `GOOGLE_WORKSPACE_PYTHON`: repo root and Python runtime.

## Event conventions

Run id format `pc-send-YYYYMMDDTHHMMSSZ`. Emitted kinds:

- `started/running`, with the review packet attached as an artifact
- `sent/running` per draft, carrying the Gmail message id
- `bounce_check/running`, fresh bounce and auto-reply counts
- `spreadsheet_update/running`, MAIN and Active Leads updated
- `completed/completed` with the send log attached, or `failed/failed`

## Safety rules

- No bulk send without explicit approval for that exact batch.
- The sender identity comes from the environment, never a hardcoded address.
- Record Gmail message ids and run a fresh bounce check after every batch.
- Update the lead sheets and push Drive after sends, and record the push return code in the run log.
