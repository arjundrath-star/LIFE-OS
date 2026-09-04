# Operating rules for Codex work packages (Stern tab)

You are building one work package (WP) of the Stern tab inside rathworkspace, a Next.js 15 App Router app with a custom tsx server, one WebSocket hub, one scheduler, and better-sqlite3. Read these before writing code, in this order:

1. AGENTS.md and CLAUDE.md at the worktree root (repo law: verification gates, safety rules).
2. docs/plans/stern/PLAN.md (what the tab is, decisions already made; do not relitigate them).
3. docs/plans/stern/schema/0029_stern.sql (the data contract; it is the migration, do not redesign it; additive follow-up migrations are allowed only if your spec says so).
4. /home/Arjun/.claude/skills/rathworkspace-ui/SKILL.md, /home/Arjun/.claude/skills/rathworkspace-data/SKILL.md, /home/Arjun/.claude/skills/rathworkspace-add-module/SKILL.md (house conventions; the Stern tab uses its own light theme, so the cyan tokens do not apply, but everything else does).
5. docs/design/career-tab-codex-build.md and docs/design/career-tab-build-report.md (the last Codex-built tab: the shape of a good build and a good report).
6. The existing code you must mirror: components/business/BusinessShell.tsx and app/business/layout.tsx (takeover shell), lib/business-workspace.ts (routes const), components/career/CareerWorkspace.tsx and lib/career.ts and app/api/career/route.ts (domain, API, and live-data pattern), server/scheduler.ts (ticks), server/live.ts (broadcast), hooks/useLiveData.tsx and hooks/useApi.ts, lib/connections/registry.ts, scripts/agent-event.ts, db/index.ts.
7. Your WP spec (appended below this file in the prompt). Its acceptance checklist is what the AI gate reviews against.

## Hard rules
- Edit only your worktree. Never touch /home/Arjun/rathworkspace (the production checkout) or any file under a data/ directory of any checkout. Use only the RATHWORKSPACE_DB path you were given.
- No network side effects: no email, Telegram, iMessage, Hermes, calendar writes, Gmail writes, or web fetches from code you run during the build. Code that will do those things in production must be written behind explicit functions with a dry-run mode, and tests must never call the real thing.
- No deploys, no systemctl, no git push, no force operations, no touching other branches. Commit on your branch with conventional messages (feat(stern): ..., test(stern): ..., docs(stern): ...). Commit early and often.
- Never weaken auth: every new API route calls requireUser() from lib/guard.ts; pages sit under the gated layout. Never add a public route.
- No personal data in code, seeds, fixtures, or docs: placeholder people only. Real club names, course codes, and NYU domains are fine.
- Do not ask questions. Make the decision, record it in your report under "Decisions made".

## Code conventions (match the repo)
- TypeScript strict. Server-only modules import from @/db and better-sqlite3; client components never do. Split enums and types into lib/stern-types.ts (client-safe) and logic into lib/stern/*.ts (server), exactly as lib/career-types.ts and lib/career.ts do.
- SQLite laws: every text column NOT NULL DEFAULT '' (never NULL in a dedupe or lookup key); writes from a second process use db.transaction(fn).immediate(); live tails query ORDER BY id DESC LIMIT n then reverse in JS; never cache a frozen process.env merge at module load; counters are computed with SQL, never hand-incremented.
- Every state change made by automation writes stern_audit_log rows (one batch_id per source message or scan) and is undoable through the audit API. Manual edits also log, with source 'manual'.
- API routes: GET returns the snapshot; POST is action-dispatch { action, ...payload }; on mutation call getHub().broadcast("stern", snapshot) so every client updates. Errors use an Error subclass carrying an HTTP status, like CareerError.
- Live data: panels do useApi("/api/stern/...") for first paint and useLiveData("stern") for updates; never poll. The scheduler is the only poller; add ticks through guarded() and the g.__rw_timers pattern.
- UI: the Stern tab uses the .stern-mode scope in app/globals.css (light, NYU violet accent, Inter, JetBrains Mono for numbers and dates). Use the primitives in components/ui.tsx and the Stern shell primitives from WP0 (components/stern/Page.tsx). Use lucide-react icons. Every list has a real empty state that says what is missing; loading is a skeleton. Add data-testid attributes on every interactive element and every list, following the career-* naming style (stern-<area>-<thing>).
- Tests: tsx --test in tests/stern-<area>.test.ts. Test the domain functions against a temp DB (copy the pattern in tests/career.test.ts), including migration idempotency where your WP adds schema, dedupe behavior, and every state transition your spec lists. Fixture data lives in tests/fixtures/stern/.
- Register scripts in package.json following the existing naming (test:stern-<area>, seed:stern, stern:<job>).

## Definition of done
1. Every item in the acceptance checklist is met and you can point to the file and line that meets it.
2. bash scripts/stern-build/gate.sh <your worktree> <your db> wp<n> prints PASS (typecheck, tests, migrate twice, production build).
3. docs/plans/stern/reports/WP<n>-report.md exists with sections: Summary, Files changed (path: purpose), How verified (paste real command output excerpts), Decisions made, Known gaps, Follow-ups for the orchestrator.
4. Everything committed on your branch; git status is clean.
