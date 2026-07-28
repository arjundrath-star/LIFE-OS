# Pokemon Vending Outreach Sender

## Identity

- Agent slug: `pokemon-vending-outreach-sender`
- Display name: Pokemon Vending Outreach Sender
- Hermes profile: default / manual script dispatch
- Role: send explicitly approved vending outreach packets with cadence, Gmail verification, logs, and lead-sheet updates.

The sender is deterministic and gated. It reads a reviewed Markdown packet, parses it into typed drafts, and refuses to send anything the packet did not contain.

## Approval contract

- Never send venue outreach without explicit operator approval naming the packet and the count.
- Draft existence is not approval. A live send requires `--approval-source`, a short auditable note identifying the approving message; without it the script aborts before the first send.
- Always run `--dry-run` first. Dry run parses, validates, and prints the batch without contacting Gmail.
- `--expected-count` is a tripwire: if the packet parses to a different number of drafts than the approver was shown, the run aborts.

## Outgoing content gate

Parsing aborts the whole batch (not just the offending draft) when any outgoing field fails a check:

- em dashes anywhere in `To`, `Subject`, or body
- the strings `PDF` or `attach` (this lane is plain text only, no attachments)
- a missing required product phrase, so a stripped-down draft cannot go out under the approved batch name
- duplicate recipients across the batch

## Send loop and idempotency

- One send per draft, `--cadence-seconds` apart (default 180).
- Each send is verified by re-reading the message and confirming the `SENT` label. A message that sends but does not verify is recorded as `sent_unverified`, not silently as sent.
- The per-run JSON log is written after every draft. Re-running the same `--run-id` skips drafts already recorded as sent, so an interrupted batch resumes instead of double-sending.
- The first hard failure stops the batch and emits a `failed` event.

## Configuration

Environment-driven, no live values in the repo:

- `OUTREACH_SENDER`: the sending mailbox. Default is a placeholder, not a live account.
- `POKEMON_PROJECT_DIR`: project workdir holding lead sheets, the outreach folder, and send logs.
- `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`: OAuth config dir for `gws`. Holds live tokens, never committed.
- `VENUE_ALIASES_PATH`: optional JSON map of packet venue spelling to lead-sheet venue spelling, used to avoid creating duplicate rows. Unset means no aliases.
- `RATHWORKSPACE_REPO`, `GOOGLE_WORKSPACE_PYTHON`: repo root and Python runtime.

## Event conventions

Run id format `pk-send-YYYYMMDDTHHMMSSZ`. Emitted kinds:

- `started/running` with the review packet attached as an artifact
- `sent/running` per draft, carrying the Gmail message id
- `spreadsheet_update/running` after the batch completes
- `bounce_check/running`
- `completed/completed` with the send log attached, or `failed/failed` with the failing draft id

## After a send

- Write JSON and CSV logs under `<project workdir>/Gmail Outreach/send_logs/`.
- Update MAIN and Active Leads (CSV and XLSX), then run the project's Drive sync script.
- Query Gmail for fresh bounces, auto-replies, and replies from the last hour, and record the counts in the run log.

## Main command

```bash
python3 agents/pokemon-vending-outreach-sender/scripts/send_approved_packet.py \
  --packet "$POKEMON_PROJECT_DIR/Gmail Outreach/<reviewed-packet>.md" \
  --expected-count 20 \
  --batch pokemon-first-20 \
  --cadence-seconds 180 \
  --run-id pk-send-YYYYMMDD-first-20 \
  --approval-source 'approval message id / quote naming this packet and count'
```

Drop `--approval-source` and add `--dry-run` to validate a packet without sending.
