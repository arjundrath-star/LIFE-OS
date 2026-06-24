# Agent Orchestration — how named agents report into rathworkspace

The dashboard is the **control tower**. Cron is just the alarm clock; **Hermes is the
orchestrator**; named specialist agents do the work and **emit events** into rathworkspace so every run,
sub-step, and artifact is visible on `/agents`.

```
cron/user request  ──▶  Hermes Orchestrator (this assistant/runtime)  ──▶  named specialist agents (lead scout, sender, …)
                                                     │ emit events
                                                     ▼
                                   scripts/agent-event.ts  ──writes──▶  SQLite
                                                     │
                          server scheduler (5s)  reads + broadcasts  ──▶  /agents (live)
```

## The event CLI

One trusted local writer. It touches **only SQLite** — no network, no email, no auth, no
browser — so cron / Hermes / Claude Code / any shell task can call it safely.

```bash
# from the repo root (/home/Arjun/rathworkspace)
npm run agent-event -- \
  --agent portable-charging-lead-scout \
  --run pc-leads-$(date +%F) \
  --kind progress \
  --status running \
  --summary "Found 8 candidate leads"
# or directly: tsx scripts/agent-event.ts --agent ... (same flags)
```

### Flags
| flag | required | notes |
|------|----------|-------|
| `--agent <slug>` | yes | lowercase `a-z0-9._-`; auto-registers on first use |
| `--run <id>` | yes | stable per run, e.g. `pc-leads-2026-06-24` |
| `--summary <text>` | yes | the one-line status (≤500 chars) |
| `--kind <kind>` | no | free-form: `started`, `progress`, `drafts`, `waiting_for_review`, … |
| `--status <status>` | no | run lifecycle (see enum). Omit to keep the run's current status |
| `--level info\|success\|warn\|error` | no | default `info`; warn/error always hit the ticker |
| `--detail <json>` / `--detail-file <path>` | no | optional JSON blob (≤8 KB). Prefer the file form for anything with quotes |
| `--trigger-type` / `--trigger-source` | no | how the run started (e.g. `cron` / `pc-lead-scout.sh`) |
| `--display-name` / `--description` / `--schedule-label` | no | registry metadata, applied when given |
| `--enabled` / `--disabled` | no | toggle the agent's enabled flag |
| `--artifact-type --artifact-title --artifact-uri` | no | attach an artifact (all three together) |
| `--artifact-metadata <json>` / `--artifact-metadata-file <path>` | no | optional artifact JSON |

Status enum (run + registry):
`idle | queued | running | waiting_for_review | blocked | completed | failed`.

Rules enforced by the writer (exit non-zero on violation):
- a run can't move **out of** a terminal state (`completed`/`failed`);
- an event's `--agent` must match the run's existing agent;
- `finished_at` is set automatically on `completed`/`failed`, never otherwise;
- `--detail` / `--artifact-metadata` must be valid JSON within the size cap.

## Portable Charging lead scout — exact event calls

`scripts/pc-lead-scout.sh` is the email-free emitter. The real lead-finder should `source`
it and call `emit` at each lifecycle stage:

```bash
source scripts/pc-lead-scout.sh        # sets AGENT, RUN (pc-leads-YYYY-MM-DD), emit()

emit started running              "Daily lead scout run started"
emit spreadsheet_pull running     "Pulled venue spreadsheets" info \
     --artifact-type spreadsheet --artifact-title "Venue master sheet" \
     --artifact-uri "https://docs.google.com/spreadsheets/d/<id>/edit"
emit dedupe running               "Deduped against existing leads"
emit found running                "Found 8 candidate venues"
emit qualified running            "Appended 5 qualified leads"
emit drafts running               "Drafted 5 outreach emails (held for review)" info \
     --artifact-type draft --artifact-title "Draft packet" --artifact-uri "<path>"
emit review_packet running        "Sent review packet to operator@example.com" success \
     --artifact-type email --artifact-title "Review packet" --artifact-uri "gmail-msg-id:<id>"
emit waiting_for_review waiting_for_review "Waiting for Arjun to approve 5 drafts" warn
# later, after approval, the SENDER agent (portable-charging-outreach-sender) emits:
#   emit_sender ... completed "Sent 3 approved emails, checked bounces, updated sheet"
```

Walk the whole thing as a no-op demo (no email, sample data only):

```bash
scripts/pc-lead-scout.sh --demo
```

This emits `started → spreadsheet_pull → dedupe → found → qualified → drafts →
review_packet → waiting_for_review` under a `pc-demo-<ts>` run id, and the cards + timeline
appear on `/agents` within ~5 s.

## Live Hermes cron wiring

The live Hermes Portable Charging lead-finder cron is wired through a prelude script:

```text
/home/Arjun/.hermes/scripts/portable_charging_agent_prelude.sh
```

The prelude records a Hermes dispatch event, creates a unique
`portable-charging-lead-scout/<run-id>` dashboard run, then injects the run id and helper command
into the cron session. The cron prompt requires the agent to emit each milestone with:

```text
/home/Arjun/command-center/Portable Charging/agent_event.sh
```

The single safety invariant: the lead scout only finds/dedupes/drafts and sends the internal
review packet. The actual venue "send" step stays in the human-approved sender path, never in
the scout.

## Platform developer agent

Software/build sessions for this repo should report as `rathworkspace-platform-developer`.
Use the root `AGENTS.md`, the per-agent manifest at
`agents/rathworkspace-platform-developer/AGENTS.md`, and the Hermes skill
`rathworkspace-platform-developer`. This agent is normally idle and exists so build sessions are
visible without confusing them with Hermes orchestration or business-domain workers.

## Reading the data

- Live: the `/agents` page reads the `agent_runs` WebSocket channel (scheduler-pushed).
- HTTP: `GET /api/agents/runs` (snapshot) and `GET /api/agents/runs/<runId>` (full history),
  both behind the Google-allowlist auth gate.
- The bottom event ticker mirrors meaningful run events (new run, status change, warn/error).

## Cleaning up demo data

Demo runs use `pc-demo-*` ids. To remove them:

```sql
DELETE FROM agent_run_events WHERE run_id LIKE 'pc-demo-%';
DELETE FROM agent_artifacts  WHERE run_id LIKE 'pc-demo-%';
DELETE FROM agent_runs       WHERE id     LIKE 'pc-demo-%';
-- then reset the registry pointer if its last_run_id was a demo run.
```
