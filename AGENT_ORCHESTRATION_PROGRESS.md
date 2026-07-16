# Agent Orchestration — Progress

> Historical implementation record for the June 2026 orchestration build. It is not a
> live operations checklist. Use `AGENTS.md`, `docs/agent-orchestration.md`, the versioned
> agent manifests, and the gated `/agents` page for current behavior and runtime state.

Mission: turn rathworkspace into the visible control tower for named agent/subagent flows.
Plan: `.agent-orchestration/PLAN.md`. Feature gates: `agent-orchestration-features.json`.

## Current state
- [x] Explored repo (db layer, scheduler, live hub, panels, auth gate, source pattern).
- [x] Wrote plan → `.agent-orchestration/PLAN.md`.
- [x] Hermes advisory checkpoint 1 (log: `.agent-orchestration/hermes-checkpoint1.log`) — feedback folded into the plan.
- [x] Implemented migration / lib / CLI / API / scheduler / UI / PC docs + wrapper.
- [x] Verified: migrate (idempotent), CLI smoke + negatives, read model, build, deploy, demo, auth 401/401/200, WS channels, screenshot.
- [x] Adversarial review workflow (4 lenses × verify pass, 26 agents, 22 findings) — 5 fix-now
  + cheap hardening applied and re-verified. Auth / SQL-injection / XSS / atomicity confirmed clean.
- [x] Hermes advisory checkpoint 2 (log: `.agent-orchestration/hermes-checkpoint2.log`) — clean
  pass, no blockers; polish notes (don't claim lint passed; demo review-packet is simulated)
  honored in the email.
- [x] Committed + pushed to `origin/main` (`c4d5a04`); completion email sent from
  operator@example.com to operator@example.com (Gmail message/thread id `MESSAGE_ID`).
- [x] Post-review semantic correction: renamed the top-level registry row from `daily-orchestrator`
  to `hermes-orchestrator` so the dashboard represents Hermes/this assistant as the orchestrator,
  not a separate fictional agent. Build re-verified after the rename.
- [x] Live wiring pass: added real agent manifests/context under `agents/<slug>/`, root
  `AGENTS.md`, the durable Hermes skill `rathworkspace-platform-developer`, a platform-developer
  dashboard registry row, and a Portable Charging cron prelude/helper so real daily runs emit
  to `/agents` instead of only demo runs.

## DONE — all feature gates pass (agent-orchestration-features.json).

## Review fixes applied (all re-verified)
1. **Snapshot showed OLDEST 40 events, not latest** — for a run >40 events the live tail was
   invisible. `runDetailRows(latest=true)` now selects newest-N DESC then reverses to
   chronological; `runDetail` keeps full ASC. Verified: 45-event run → snapshot shows
   evt-6..evt-45 in order.
2. **DEFERRED transaction could drop an event under CLI+server concurrency** (SQLITE_BUSY_SNAPSHOT
   is not retried by busy_timeout). `recordAgentEvent` now commits via `tx.immediate()`.
3. **Terminal run was mutable + could regress the registry pointer** when an event omitted
   `--status`. Terminal runs now reject ANY further event; registry pointer only advances to a
   run at least as new as the one it points to. Verified: late status-omitted event rejected;
   event on an older run keeps the pointer on the newer run.
4. **pc-lead-scout.sh leaked `set -uo pipefail` + cwd into a sourcing caller.** Source-detection
   now runs first; `set`/`cd` are in the executed branch only; `emit` runs tsx in a subshell
   cd'd to the repo (resolves the `@/` alias) without touching the caller's cwd. Verified:
   sourced emit from /tmp works, caller cwd unchanged, set -u does not leak.
5. **CLI `--enabled=false` enabled the agent** (truthy string). Boolean `=value` flags now parse
   explicitly. Verified: `--enabled=false`→enabled 0, bare `--enabled`→1.
Hardening: byte-accurate JSON size cap; `Array.isArray` guards + `aria-controls`/region id in the
panel; dangling `last_run_id` falls back to the most-recent run; `activeRuns` bounded (LIMIT 100).
Note-only (recorded, not changed): per-existing migrate() first-boot race (out of scope); hero
band is WS-only (repo-wide convention); a stale-run TTL reaper is a sensible post-ship follow-up.

## Decisions (final)
- Additive migration `0006`; existing tables/data untouched.
- New WS channel `agent_runs` (the existing `agents` payload is unchanged).
- Shared snapshot/write module `lib/agents.ts` used by the CLI, the API route, and the
  scheduler (mirrors `lib/vending.ts`).
- Single ticker path: only `recordAgentEvent` writes the `events` ticker (SQLite); the
  existing `tickAgents` broadcasts it. `tickAgentRuns` only broadcasts `agent_runs`.
- Event CLI writes ONLY SQLite (no net/email/auth/browser); server tick surfaces it ≤5s.
- Centralised validation + state-transition guards in `recordAgentEvent` (every writer).
- PC integration = event emission + docs only. No emails. No Hermes cron mutation.

## Files changed / added
- `db/migrations/0006_agent_orchestration.sql` (new) — registry/runs/events/artifacts + seed.
- `lib/agents.ts` (new) — `recordAgentEvent` (write path) + `agentsOrchestrationSnapshot` /
  `runDetail` (read model) + validation/transition rules.
- `scripts/agent-event.ts` (new) — local SQLite-only event CLI.
- `scripts/pc-lead-scout.sh` (new) — email-free PC emitter + `--demo`.
- `scripts/hermes-advisory.sh` (new) — wraps `hermes chat -q` for the two checkpoints.
- `docs/agent-orchestration.md` (new) — exact event calls / Hermes-wiring docs.
- `app/api/agents/runs/route.ts` (new) — gated snapshot.
- `app/api/agents/runs/[id]/route.ts` (new) — gated per-run detail.
- `server/scheduler.ts` (mod) — `tickAgentRuns` broadcasts `agent_runs` (5s); burst+timer.
- `components/panels/AgentRunsPanel.tsx` (new) — named-agent cards + timeline + event stream.
- `app/(dash)/agents/page.tsx` (mod) — renders `AgentRunsPanel` above the preserved
  `AgentsPanel`; adds a named-agents hero stat.
- `package.json` (mod) — `agent-event` npm script.

## Commands run + results (verified)
- `npm run migrate` ×2 → 0006 applied once; second run no-op (idempotent). 4 new tables,
  4 seed agents, all existing tables intact, `_migrations` lists 0001..0006.
- CLI happy path (started→progress→waiting_for_review +artifact): events ordered;
  `finished_at` NULL on waiting; a separate `completed` run set `finished_at`; registry
  `current_status`/`last_run_id` updated; ticker mirrored new-run + status-change only
  (a status-unchanged `progress` event did NOT push — quiet ticker as designed).
- CLI negatives (all correct exit codes, zero junk rows — transaction rollback):
  bad status→1, bad JSON detail→1, agent/run mismatch→1, transition-out-of-terminal→1,
  oversized detail (>8 KB)→1, uppercase slug→1, missing `--summary`→2.
- Read model `agentsOrchestrationSnapshot()`: stats correct, latest run embeds 8-event
  timeline + 3 artifacts, stable agent order.
- `npx next build` → exit 0 (TypeScript type gate); `/api/agents/runs` + `/api/agents/runs/[id]`
  + `/agents` all compiled. (`next lint` is unconfigured + deprecated in this repo — pre-existing.)
- Deploy: `sudo systemctl restart rathworkspace.service` → `active`, journal shows
  `[scheduler] started` + `ready ... (dev=false)`. Migration also ran clean on boot.
- `scripts/pc-lead-scout.sh --demo` → exit 0, 8-stage run ends `waiting_for_review`,
  3 artifacts (sheet link / draft path / gmail-msg-id), **no email sent**.
- Auth gate on `/api/agents/runs` (minted NextAuth JWT, `NEXTAUTH_SECRET`):
  no-cookie → **401**, non-allowlisted email token → **401**, allowlisted → **200**
  (correct payload); `/api/agents/runs/<id>` → **200**.
- WebSocket `/ws`: no-cookie → **401 rejected**; allowlisted → opens and receives
  `agent_runs` (new) AND `agents` (preserved), plus pulse/ticker/connections/etc.
- Puppeteer screenshot (`shots/agents-orchestration.png`, minted JWT over the tunnel):
  `/agents` 200 shows the named-agent cards (scout expanded → full timeline + 3 artifacts),
  the orchestration event stream, and the preserved Hermes/Telegram/Claude panel + ticker.

## Blockers
- None. Passwordless sudo for the service restart confirmed.

## Known pre-existing (NOT this mission)
- Missing favicon/icon assets → every page logs one benign 404 (untouched `/vending` 404s the
  same asset and returns 200). Cosmetic; out of scope.
- `next lint` is unconfigured + deprecated in Next 15 here (prompts interactively).

## Next task
Apply any fix-now findings from the review workflow, run Hermes checkpoint 2, commit + push,
send the completion email.
