# Claude Code Mission: Rathworkspace Agent Orchestration + Dashboard Hooks

**Repo:** `/home/Arjun/rathworkspace`  
**Site:** `https://rathworkspace.cloud`  
**Owner:** Arjun Rath  
**Mission type:** long-running Claude Code / Ultra Code implementation mission  
**Primary outcome:** turn rathworkspace into the visible control tower for named agent/subagent flows, starting with Portable Charging lead-finding/draft-review.

---

## Research-backed operating rules

Use these practices throughout the run:

1. **Explore → plan → implement → verify.** Claude Code best-practice docs recommend letting the agent inspect the codebase first, form a plan, then implement with concrete verification commands.
2. **Give yourself objective completion gates.** Do not declare completion because the UI “looks done.” Run migrations/build/type/lint checks where available and test the event flow with real SQLite rows or CLI calls.
3. **Manage long-running context with explicit artifacts.** Anthropic’s long-running-agent harness guidance recommends persistent progress files and feature lists so future sessions can continue from disk, not memory.
4. **Make incremental progress.** Do not one-shot a huge redesign. Build the MVP hooks and dashboard flow first, then refine.
5. **Use hooks where events must be captured with zero exceptions.** Claude Code hook docs support lifecycle hooks such as SessionStart, Stop, SubagentStart/SubagentStop, PostToolUse, etc. If adding Claude Code hooks, keep them local, auditable, and non-secret.
6. **Show evidence.** Every completion claim must include commands run, exit status, changed files, and any screenshots/log snippets needed to verify.

Useful references if network is available:
- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/hooks
- https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents

---

## Existing system facts

The dashboard is already live and protected:

- `rathworkspace.cloud` redirects unauthenticated visitors to `/signin?callbackUrl=%2F`.
- Next.js custom server runs from `/home/Arjun/rathworkspace/server.ts` on local `127.0.0.1:3000`.
- Cloudflare tunnel `rathworkspace` exposes the app.
- Local embedded services:
  - `/terminal/` → `ttyd` on `127.0.0.1:7681`
  - `/files/` → FileBrowser on `127.0.0.1:8088`
- Both embedded services are gated by the same Google auth allowlist check.

Important code paths:

- App shell/nav: `components/shell/nav.tsx`, `components/shell/NavRail.tsx`, `components/shell/DashShell.tsx`
- Agents panel: `components/panels/AgentsPanel.tsx`
- Live store: `hooks/useLiveData.tsx`
- Server/WebSocket/scheduler: `server.ts`, `server/live.ts`, `server/scheduler.ts`
- DB: `db/index.ts`, `db/migrations/*.sql`, SQLite at `data/rathworkspace.db`
- Current API: `app/api/agents/route.ts`
- Current scheduler channels: `agents`, `pulse`, `connections`, `projects`, `email`, `calendar`, `health`, `vending`

Existing DB has:

- `agent_activity` — append-only high-level Hermes/Telegram/Claude activity
- `events` — ticker events
- `connections`, `email_state`, `vending_outreach`, `whoop_daily`, etc.

Current limitation:

- rathworkspace can see high-level Hermes/gateway/Telegram status, but it does **not** yet show detailed named agent runs, subagent status, artifacts, approvals, or each meaningful orchestration event.

---

## Target architecture

Cron should become only the **alarm clock**. Hermes should become the **orchestrator**. Named agents/subagents should do the work and emit events into rathworkspace.

Example desired flow:

```text
Hermes Orchestrator
  ↓
Portable Charging Lead Scout
  ✓ pulled spreadsheets
  ✓ deduped existing leads
  ✓ found 8 candidates
  ✓ appended 5 qualified leads
  ✓ drafted 5 emails
  ✓ sent review packet to operator@example.com
  ⏳ waiting for Arjun approval
```

Later:

```text
Portable Charging Outreach Sender
  ✓ received approvals
  ✓ sent 3 approved emails
  ✓ checked bounces
  ✓ updated spreadsheets
```

---

## MVP deliverable

Build the first production-quality slice of agent orchestration visibility.

### Required capabilities

1. **Named agent registry**
   - Store/display named agents, at minimum:
     - `hermes-orchestrator`
     - `portable-charging-lead-scout`
     - `portable-charging-outreach-sender` (can be idle/not fully wired)
     - `deliverability-monitor` (can be idle/not fully wired)
   - Fields should include slug, display name, description, enabled, status, last run, current run.

2. **Agent runs**
   - Store per-run lifecycle:
     - run id
     - agent slug
     - status: `idle | queued | running | waiting_for_review | blocked | completed | failed`
     - trigger type/source
     - started/finished timestamps
     - summary

3. **Agent events**
   - Store timeline events for runs:
     - ts
     - agent slug
     - run id
     - kind
     - status/level
     - summary
     - optional detail JSON
   - Also mirror important events into existing `agent_activity` and/or `events` ticker where appropriate.

4. **Agent artifacts**
   - Store/display artifact references:
     - spreadsheet path/link
     - review email message id/thread id
     - draft packet path
     - run log path
     - blockers

5. **Local event CLI/hook script**
   - Add a simple local script that Hermes, Claude Code, cron, or shell tasks can call on the VPS.
   - Suggested path: `scripts/agent-event.ts` or `scripts/agent_event.py`.
   - Required example command shape:

```bash
# exact implementation can differ, but keep it easy to call from bash
pnpm_or_npm_or_tsx scripts/agent-event.ts \
  --agent portable-charging-lead-scout \
  --run pc-leads-$(date +%F) \
  --kind progress \
  --status running \
  --summary "Found 8 candidate leads"
```

   - If using Python is simpler, Python is fine. Prefer whatever fits this repo with minimal dependencies.
   - It must write to the same SQLite database that the app reads.
   - It must not require internet or a logged-in browser.

6. **API/read model**
   - Add or extend API endpoint(s) so the UI can read:
     - agent registry
     - active runs
     - recent run events
     - artifacts
   - Must remain behind existing auth gate.

7. **Dashboard UI**
   - Improve `/agents` or Agents panel so it shows named agent flows, not just Hermes/Telegram/Claude rows.
   - At minimum show:
     - agent display name
     - current status
     - latest summary
     - last run time
     - current/last run timeline
     - artifacts/links if present
   - Keep current Hermes/Telegram/Claude status rows.
   - Do not break mobile/responsive shell.

8. **Portable Charging starter integration**
   - Do **not** send outreach emails from this task.
   - Add documentation and/or a wrapper script showing how the existing Portable Charging safe daily lead-finder cron/orchestrator can emit events:
     - run started
     - spreadsheet pull
     - lead search progress
     - drafts created
     - review packet sent
     - waiting for review
     - completed/failed
   - If you can safely modify the existing Hermes cron prompt from inside repo docs only, document the exact event calls; do not mutate Hermes cron config unless explicitly instructed by Arjun in the live session.

9. **Claude Code / Hermes collaboration hook**
   - Add a practical way for a Claude Code run to ask Hermes for mid-session feedback.
   - Minimum acceptable: document and use this advisory command after exploration/plan and before final completion:

```bash
hermes chat -q "Review the rathworkspace agent orchestration plan/progress in /home/Arjun/rathworkspace. Focus on missing safety gates, dashboard integration gaps, and verification. Reply with concise actionable feedback only. Do not edit files."
```

   - If `hermes chat -q` is unavailable, log the failure and continue with local verification.
   - Do **not** let this recurse forever. Use at most two Hermes advisory calls in this mission: once after plan, once before final.

10. **Completion email**
   - At the very end, send Arjun a completion email from Klade/GWS:
     - From/account: `operator@example.com` via configured `gws-arjun` environment
     - To: `operator@example.com`
     - Subject: `rathworkspace agent orchestration update — <YYYY-MM-DD>`
   - Body must summarize:
     - what agents were set up
     - what dashboard surfaces were added/changed
     - what scripts/hooks were created
     - how to trigger a test event/run
     - verification commands and results
     - any blockers or remaining manual steps
   - Use:

```bash
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$HOME/.config/gws-arjun"
gws gmail +send --to operator@example.com --subject "rathworkspace agent orchestration update — $(date +%F)" --body "$(cat /tmp/rathworkspace-agent-orchestration-email.txt)"
```

   - If sending fails, write the body to `/home/Arjun/rathworkspace/AGENT_ORCHESTRATION_COMPLETION_EMAIL.txt` and mention the failure in final output.

---

## Long-running harness requirements

Create/update these persistent artifacts early in the run:

1. `/home/Arjun/rathworkspace/AGENT_ORCHESTRATION_PROGRESS.md`
   - Current state
   - Decisions made
   - Files changed
   - Commands run + results
   - Blockers
   - Next task

2. `/home/Arjun/rathworkspace/agent-orchestration-features.json`
   - Use JSON, not markdown, for feature checklist.
   - Each item:

```json
{
  "id": "agent-runs-schema",
  "category": "backend",
  "description": "Agent runs are persisted with status, timestamps, trigger, and summary",
  "acceptance": ["migration exists", "rows can be inserted", "API can read them"],
  "passes": false
}
```

   - Only change `passes` from false to true when verified.
   - Do not delete or weaken acceptance criteria to make the run look complete.

3. Optional scratch under `/home/Arjun/rathworkspace/.agent-orchestration/`
   - planning notes
   - screenshots
   - test payloads

If the session gets long, update progress and commit working increments so another Claude Code agent can continue.

---

## Implementation guidance

### Suggested DB migration

Add a new migration, likely `db/migrations/0006_agent_orchestration.sql`, with tables similar to:

```sql
CREATE TABLE IF NOT EXISTS agent_registry (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  schedule_label TEXT,
  current_status TEXT NOT NULL DEFAULT 'idle',
  last_run_id TEXT,
  last_run_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_type TEXT,
  trigger_source TEXT,
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  detail TEXT,
  FOREIGN KEY(agent_slug) REFERENCES agent_registry(slug)
);

CREATE TABLE IF NOT EXISTS agent_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kind TEXT NOT NULL DEFAULT 'event',
  status TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  summary TEXT NOT NULL,
  detail TEXT,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id),
  FOREIGN KEY(agent_slug) REFERENCES agent_registry(slug)
);

CREATE TABLE IF NOT EXISTS agent_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  agent_slug TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  uri TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(run_id) REFERENCES agent_runs(id),
  FOREIGN KEY(agent_slug) REFERENCES agent_registry(slug)
);
```

Seed the initial named agents in the migration or a small server-side seed helper. Preserve existing tables.

### Suggested local event behavior

The event script should:

1. Create the agent in `agent_registry` if missing.
2. Create or update `agent_runs` for the given run id.
3. Insert an `agent_run_events` row.
4. Update registry current status / last run fields.
5. Optionally insert into existing `agent_activity` and `events` ticker.
6. Exit nonzero on invalid input.

Useful commands to test:

```bash
npm run migrate
npx tsx scripts/agent-event.ts --agent portable-charging-lead-scout --run pc-test-$(date +%s) --kind started --status running --summary "Test run started"
npx tsx scripts/agent-event.ts --agent portable-charging-lead-scout --run pc-test-$(date +%s) --kind waiting_for_review --status waiting_for_review --summary "Draft packet ready for Arjun"
```

Adapt if package manager differs. The repo currently has npm scripts.

### Suggested UI

Either:

- Extend `components/panels/AgentsPanel.tsx`, or
- Add a focused component such as `components/panels/AgentRunsPanel.tsx` and use it on `/agents`.

Do not remove the existing Hermes/Telegram/Claude rows.

Show timeline with compact rows:

```text
09:00 started — Daily orchestrator started
09:02 progress — Pulled spreadsheets
09:07 progress — Found 8 candidate leads
09:11 waiting_for_review — Review packet sent to Gmail
```

---

## Safety constraints

- Do not expose secrets, tokens, OAuth refresh tokens, or Cloudflare credentials.
- Do not weaken auth on `rathworkspace.cloud`.
- Do not make `/terminal`, `/files`, `/ws`, or agent APIs public.
- Do not send outreach emails to venue leads.
- Do not mutate Hermes cron config unless Arjun explicitly says to in the live session.
- Do not overwrite existing DB data. Add migrations only.
- Keep DB files mode-safe; existing DB layer handles chmod.
- Prefer additive changes.

---

## Verification checklist

Before final completion, verify as much as possible:

1. `git status --short` reviewed.
2. `npm run migrate` succeeds.
3. Event CLI inserts a test run/event/artifact or equivalent.
4. API endpoint returns named agents/runs when authenticated or through server-local test route if auth blocks curl.
5. `npm run build` succeeds. If it fails due to existing unrelated project issue, document exact failure and whether your changes caused it.
6. The UI compiles and preserves existing nav/routes.
7. Existing scheduler still starts.
8. Test event appears in DB queries.
9. Final email sent to `operator@example.com` or fallback file created.
10. `AGENT_ORCHESTRATION_PROGRESS.md` and `agent-orchestration-features.json` are current.

---

## Required Hermes advisory checkpoints

### Checkpoint 1 — after exploration + plan, before coding

Write your plan to `/home/Arjun/rathworkspace/.agent-orchestration/PLAN.md`, then run:

```bash
hermes chat -q "Review /home/Arjun/rathworkspace/.agent-orchestration/PLAN.md for the rathworkspace agent orchestration mission. Focus on safety, missing dashboard integration steps, migration risks, and verification gaps. Reply with concise actionable feedback only. Do not edit files."
```

Incorporate useful feedback into the plan/progress file.

### Checkpoint 2 — before final email

Run:

```bash
hermes chat -q "Review the completed rathworkspace agent orchestration changes in /home/Arjun/rathworkspace. Check AGENT_ORCHESTRATION_PROGRESS.md, agent-orchestration-features.json, git diff, and verification outputs. Reply with any blockers or final polish items. Do not edit files."
```

Address blockers if reasonable; otherwise document them.

---

## Final output requirements

When done:

1. Send the completion email to Arjun as described above.
2. Print a concise final summary in the terminal:
   - Agents set up
   - Files changed
   - Verification commands/results
   - Email message id/thread id if sent
   - Remaining work
3. Leave the repo in a clean, understandable state with progress artifacts updated.

Do not claim success without real command output.
