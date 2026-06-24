# rathworkspace Agent Operating Manual

This repo is the live `rathworkspace.cloud` life-OS dashboard. Agents working here must treat Hermes as the top-level orchestrator and the dashboard as the visible control tower.

## Control-plane model

- **Hermes Orchestrator** (`hermes-orchestrator`) is this assistant/runtime. Cron alarms and user requests wake Hermes; Hermes decides what specialist agent or build session should run.
- Specialist agents do bounded work and emit lifecycle events into SQLite via `scripts/agent-event.ts`.
- The `/agents` dashboard reads the `agent_runs` live channel and API routes; do not bypass the existing auth gate.

## Agent manifests

Canonical per-agent context lives under `agents/<slug>/`:

- `agents/hermes-orchestrator/AGENTS.md`
- `agents/portable-charging-lead-scout/AGENTS.md`
- `agents/portable-charging-outreach-sender/AGENTS.md`
- `agents/deliverability-monitor/AGENTS.md`
- `agents/rathworkspace-platform-developer/AGENTS.md`

Use those files as the source of truth for agent scope, event conventions, safety rules, and required skills/context.

## Event emission

Use the local SQLite-only writer. It performs validation and mirrors meaningful status changes to the ticker.

```bash
cd /home/Arjun/rathworkspace
npm run agent-event -- \
  --agent rathworkspace-platform-developer \
  --run platform-dev-$(date -u +%Y%m%dT%H%M%SZ) \
  --kind started \
  --status running \
  --summary "Build session started" \
  --trigger-type manual \
  --trigger-source "Claude Code / Hermes"
```

Status enum: `idle | queued | running | waiting_for_review | blocked | completed | failed`.

## Build-session rule

Any Claude Code / Ultra Code / Hermes session modifying this repo should report under `rathworkspace-platform-developer` unless it is intentionally operating as a different specialist agent. Use the `rathworkspace-platform-developer` Hermes skill for software changes.

## Verification gates

Before final handoff for repo changes:

1. `git status --short`
2. `npm run migrate` if DB/schema touched
3. relevant event CLI smoke test if agent flow touched
4. `npm run build`
5. service restart/status if deployed
6. concise summary of changed files + real outputs

## Hard safety rules

- Do not weaken Google allowlist auth or make `/api`, `/ws`, `/terminal`, or `/files` public.
- Do not expose `.env`, OAuth refresh tokens, Cloudflare secrets, or Gmail credentials.
- Do not send external outreach emails from lead-scout jobs; only internal review packets are autonomous.
- Prefer additive migrations and explicit status/event history over destructive DB edits.
