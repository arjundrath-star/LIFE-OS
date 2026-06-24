# Rathworkspace Agent Orchestration — Implementation Plan

Date: 2026-06-24
Author: Claude Code (Opus 4.8)
Repo: /home/Arjun/rathworkspace
Goal: make rathworkspace the visible control tower for named agent / subagent flows,
starting with Portable Charging lead-finding / draft-review. Cron = alarm clock,
Hermes = orchestrator, named agents emit events into the dashboard.

## Guiding constraints (from the mission + repo learnings)
- Additive only. New migration `0006`, never alter/overwrite existing tables or data.
- The **scheduler is the only poller**. Panels never poll a source; they read a live WS
  channel with an HTTP fallback (`live || data`). Mirror the `lib/vending.ts` pattern:
  one shared snapshot builder used by BOTH the API route and the scheduler tick.
- Do **not** weaken auth. New API stays behind `requireUser()` + middleware gate. No new
  public paths. No new public WS path (reuse the single gated `/ws`).
- Do **not** send outreach emails. PC integration is event-emission + docs only.
- Do **not** mutate Hermes cron config. Document the exact event calls in repo docs only.
- Secrets: read `process.env` live (never cache a frozen merge) — already handled by
  `lib/secrets.ts`; new code reuses it, adds no secrets.
- The event CLI must touch **only SQLite** (no internet, no browser, no auth).

## Architecture

```
cron (alarm clock)
  └─ hermes (orchestrator)  ── calls ──▶  scripts/agent-event.ts  ──writes──▶  SQLite
                                                                                  │
server scheduler tick (tickAgentRuns, 5s) ── reads SQLite ── broadcasts ─▶ WS "agent_runs"
                                                                                  │
                                                              /agents page ◀──────┘
                                              (AgentRunsPanel: useLiveData || /api/agents/runs)
```

The named-agent "source" is the SQLite orchestration tables themselves. The CLI (run by
Hermes/cron/Claude/shell, in a separate process) writes rows; the server's scheduler reads
them on a 5s timer and broadcasts. Decoupled, no IPC, no auth on the writer. UI latency ≤5s.

## 1. DB migration — `db/migrations/0006_agent_orchestration.sql`
Tables (additive, `IF NOT EXISTS`), matching the mission's suggested schema:
- `agent_registry(slug PK, display_name, description, enabled, schedule_label,
   current_status DEFAULT 'idle', last_run_id, last_run_at, updated_at)`
- `agent_runs(id PK, agent_slug FK→registry, status, trigger_type, trigger_source,
   summary, started_at, finished_at, detail)`
- `agent_run_events(id PK AUTOINCREMENT, run_id FK→runs, agent_slug FK→registry, ts,
   kind DEFAULT 'event', status, level DEFAULT 'info', summary, detail)`
- `agent_artifacts(id PK AUTOINCREMENT, run_id FK→runs, agent_slug FK→registry, type,
   title, uri, metadata, created_at)`
- Indexes: runs(agent_slug, started_at), run_events(run_id, id), artifacts(run_id).
- Seed 4 named agents via `INSERT OR IGNORE`:
  `hermes-orchestrator`, `portable-charging-lead-scout`,
    `portable-charging-outreach-sender`, `deliverability-monitor`.

Status enum (runs + registry.current_status):
`idle | queued | running | waiting_for_review | blocked | completed | failed`.

FK note: `foreign_keys = ON` is set, so writers MUST upsert the registry row, then the run
row, before inserting events/artifacts. The CLI does this ordering.

## 2. Shared snapshot + write helper — `lib/agents.ts` (server-only)
- `recordAgentEvent(input)` — the single write path (used by the CLI and any server code):
  1. upsert `agent_registry` (humanize slug for display_name if absent; apply
     display_name/description/schedule_label/enabled when provided).
  2. upsert `agent_runs` for `runId` (set trigger on create; update status/summary;
     set `finished_at` when status ∈ {completed, failed}).
  3. insert `agent_run_events`.
  4. update registry `current_status`, `last_run_id`, `last_run_at`, `updated_at`.
  5. optional `agent_artifacts` insert when artifact fields present.
  6. mirror "meaningful" events (started / waiting_for_review / blocked / completed /
     failed) to the `events` ticker via `pushEvent`. Returns the new event id + run status.
- `agentsOrchestrationSnapshot()` — read model:
  `{ agents:[registry + derived latest summary], activeRuns, recentRuns, recentEvents,
     stats:{total, active, waiting, idle} }`.
- `runTimeline(runId)`, `artifactsForRun(runId)` helpers for the detail view.
- Status → UI mapping helper lives in the panel (client), not here.

## 3. Event CLI — `scripts/agent-event.ts` (tsx)
Flags: `--agent --run --kind --status --summary` (+ optional `--level --detail(JSON)
--trigger-type --trigger-source --display-name --description --schedule-label --finished
--artifact-type --artifact-title --artifact-uri --artifact-metadata`).
- Validates required flags + status against the enum; **exits non-zero on bad input**.
- Calls `recordAgentEvent`. Prints the resulting `{eventId, run, status}` as JSON. Exit 0.
- Touches only SQLite. No network. Does NOT broadcast (server tick picks it up ≤5s).
- npm script alias: `"agent-event": "tsx scripts/agent-event.ts"`.

## 4. API read model — `app/api/agents/runs/route.ts`
- `GET` → `requireUser()` (401 if not allowlisted) → `agentsOrchestrationSnapshot()`.
- `force-dynamic`. No POST (read-only). Existing `/api/agents` untouched.

## 5. Scheduler — `server/scheduler.ts`
- Add `tickAgentRuns()` (guarded, 5s interval): builds the snapshot, broadcasts channel
  `agent_runs`, and pushes NEW ticker events since the last seen `agent_run_events.id`
  (dedupe by max id in `hub.last.agentRunsLastEventId`, mirroring the telegram-ts dedupe).
- Keep `tickAgents` (Hermes/Telegram/Claude) and the `agents` channel **exactly as-is**.
- Add to the initial burst + timer list.

## 6. Dashboard UI
- New `components/panels/AgentRunsPanel.tsx`: reads `agent_runs` live channel,
  `/api/agents/runs` fallback. Renders a card per named agent (display name, status dot +
  badge, latest summary, last run time, schedule label). Click a card → expand the run
  timeline (compact `hh:mm kind — summary` rows) + artifacts (links / mono paths).
  Status→DotState/Badge mapping: running→live(pulse), waiting_for_review→warn,
  blocked/failed→error, completed→healthy, idle/queued→off.
- `app/(dash)/agents/page.tsx`: render `AgentRunsPanel` as the primary section, add an
  "active / waiting" hero stat, and KEEP `<AgentsPanel expanded />` (Hermes/Telegram/Claude
  rows + activity) below it. Responsive: cards collapse to one column on mobile.
- No nav changes (Agents route already exists). No change to Home (lower risk).

## 7. Portable Charging starter integration (no emails)
- `scripts/pc-lead-scout.sh`: a documented wrapper exposing a `pc_event()` helper that
  shells `agent-event.ts` for each lifecycle stage (run started → spreadsheet pull → lead
  search progress → drafts created → review packet sent → waiting_for_review →
  completed/failed). Includes a `--demo` mode that walks a full sample run end-to-end so the
  dashboard flow can be tested WITHOUT touching real leads or sending anything.
- `docs/agent-orchestration.md`: how Hermes / cron should emit events (exact commands), the
  status enum, the event-call sequence, and an explicit "this does not send email" note.
  Documentation only — Hermes cron config is NOT modified.

## 8. Hermes collaboration hook
- `scripts/hermes-advisory.sh`: wraps `hermes chat -q "<prompt>"` (fallback to `hermes -z`
  if `-q`/`chat` unavailable), logs output to `.agent-orchestration/hermes-checkpoint-N.log`.
- Used at most twice: checkpoint 1 (this plan, before coding) and checkpoint 2 (before email).

## 9. Completion email (last step, after verification + checkpoint 2)
- `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=$HOME/.config/gws-arjun`,
  `gws gmail +send --to operator@example.com --subject "rathworkspace agent orchestration
  update — <date>" --body "$(cat <body>)"`. Fallback: write body to
  `AGENT_ORCHESTRATION_COMPLETION_EMAIL.txt` and report the failure.
- Explicitly authorized by the mission prompt (satisfies the ask-before-arjun-send rule).

## Verification (objective gates — `passes` flips only on real output)
1. `git status --short`.
2. `npm run migrate` → 0006 applied; `.tables` shows the 4 new tables; 4 seed rows.
3. CLI smoke: started → progress → waiting_for_review (+artifact); query DB to confirm
   rows + registry `current_status` updated + run `finished_at` on a completed run.
4. Read model: `agentsOrchestrationSnapshot()` via tsx prints the run; AND mint a NextAuth
   JWT (NEXTAUTH_SECRET) to curl the live gated `/api/agents/runs` (401 without cookie).
5. `npm run build` → exit 0.
6. Deploy: `next build` + `sudo systemctl restart rathworkspace.service`; confirm
   `[scheduler] started` in journal, service `active`, WS still gated.
7. Puppeteer screenshot of `/agents` (minted-JWT cookie) showing the named-agent cards +
   timeline, existing Hermes/Telegram/Claude rows preserved.
8. Adversarial review workflow over the diff (security + correctness + completeness); fix
   confirmed findings before the email.

## Risks / mitigations
- Two SQLite writers (CLI + server): WAL + busy_timeout=5000 serialize writes — low volume,
  safe. (Already proven by the existing scheduler writing while routes write.)
- FK violations: writer upserts registry→run→event in order. CLI enforces it.
- Breaking the existing `agents` channel: untouched; new data on a new `agent_runs` channel.
- Build window: `next build` rewrites `.next` under the live server → build THEN restart;
  WS clients auto-reconnect with backoff.
- Demo data polluting real view: demo runs use clearly-namespaced run ids (`pc-demo-*`) and
  are documented as test fixtures; can be deleted with a one-line SQL if undesired.

## Checkpoint 1 feedback — incorporated (Hermes, 2026-06-24, log: hermes-checkpoint1.log)
- Single ticker path: only `recordAgentEvent` writes the `events` ticker row (pure SQLite
  via `pushEvent`, safe for the CLI). The existing `tickAgents` already broadcasts the
  `ticker` channel, so `tickAgentRuns` broadcasts ONLY the `agent_runs` snapshot. No
  in-memory `lastEventId` and no double-push.
- Strict validation centralised in `recordAgentEvent` (so every writer is covered, not just
  the CLI): slug `^[a-z0-9][a-z0-9._-]{0,63}$`, runId `^[a-z0-9][a-z0-9._-]{0,127}$`,
  summary ≤500, title ≤200, uri ≤1000, kind ≤64, detail/metadata must be valid JSON ≤8 KB,
  status ∈ enum, level ∈ {info,success,warn,error}. Throws → CLI exits non-zero.
- State-transition guards: reject a non-terminal status after a terminal one; reject an
  event whose `agent` differs from the run's existing `agent_slug`; auto-set `finished_at`
  only on completed/failed (never on non-terminal).
- Migration CHECK constraints on `status`/`current_status`/`level` (kind stays free-form).
  Whole migration+seed already runs in one transaction (migrate() wraps each file).
  `INSERT OR IGNORE` seeds (runs once; documented). FK ON DELETE left NO ACTION (never
  delete) — intentional.
- `registry.last_run_at` = latest activity ts on the agent's current/most-recent run
  (UI label: "last activity"); `run.started_at` = run start. Documented to remove ambiguity.
- Detail data path: snapshot embeds, per agent's latest run, up to 40 timeline events + 20
  artifacts (bounded); plus a gated `GET /api/agents/runs/[id]` for full history of any run.
  Snapshot caps: recentRuns ≤30, recentEvents ≤60.
- CLI gains `--detail-file` / `--metadata-file` (JSON via file, not fragile quoted args);
  `pc-lead-scout.sh` uses them. agent-event.ts header states the no-network/no-email
  invariant (imports only `@/db` + `@/lib/agents`, both SQLite-only).
- UI: http(s) artifacts → `<a target=_blank rel="noopener noreferrer">`; local paths → mono
  text, not clickable. Empty/loading/disconnected/malformed-detail states all handled.
  Existing /agents hero + `<AgentsPanel expanded/>` preserved; cards added as a new section.
- Verification additions: `npm run lint` before build; 401-unauth / 200-allowlisted /
  non-allowlisted-blocked on `/api/agents/runs`; WS unauth-rejected + authed-receives +
  `agents`-channel-intact; `npm run migrate` twice clean (no dup seeds, existing tables
  untouched); CLI negatives (bad status / bad JSON / agent-run mismatch / oversized detail
  all exit non-zero); confirm CLI and server resolve the SAME DB path before claiming done.

## Open questions for Hermes checkpoint 1
- Any safety gate missing on the writer path (e.g., should the CLI refuse to mark a run
  `completed` without a prior `started`)?
- Is a separate `agent_runs` WS channel preferable to folding into `agents`? (I chose
  separate to avoid touching the existing payload shape.)
- Any dashboard integration step missing for the "control tower" goal beyond /agents?
