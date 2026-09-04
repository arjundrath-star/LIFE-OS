# Stern tab build: progress tracker

Single source of truth for resumption. The orchestrator updates this file after every step and commits it on feature/stern-tab. If the session restarts, read this first, then the newest report in docs/plans/stern/reports/.

| WP | Scope | Builder | Status | Branch | Gate | Merged | Email sent |
|---|---|---|---|---|---|---|---|
| 0 | Foundation: schema, shell, routes, CLI writer, docs | Fable | in progress | feature/stern-tab | | | build-started sent |
| 1 | Club Recruiting | Codex | not started | stern/wp1 | | | |
| 2 | Network | Codex | not started | stern/wp2 | | | |
| 3 | Email and Calendar automation | Codex | not started | stern/wp3 | | | |
| 4 | Tasks, Classes, Career | Codex | not started | stern/wp4 | | | |
| 5 | Reminders, Hermes profile, memo, capture | Fable + Codex | not started | stern/wp5 | | | |
| 6 | Overview, Automation page, design conversion, polish | Codex | not started | stern/wp6 | | | |
| 7 | Security and code review, e2e, backups, deploy | Fable | not started | feature/stern-tab | | | |
| 8 | Data load and dry run with Arjun | Arjun + Fable | not started | | | | |

Status values: not started, in progress, gate failed (n), gate passed, merged, blocked (reason).

## Log
- 2026-09-04 23:10 EDT: prep complete (Claude Code planning session). Worktree, DB copy, scripts, schema, specs, fixtures, and seeds in place. Baseline on main: typecheck clean, 184 tests pass, production build passes in the worktree.
- 2026-09-04 23:25 EDT: Claude Design bundle received (Drive link from Arjun), unzipped into docs/plans/stern/design/handoff/ (7 files). WP6 must align to it.
- 2026-09-04 19:25 EDT: orchestrator session started (run id stern-build-20260904T232545Z registered on /agents from the prod checkout's agent-event CLI, an additive orchestration-table write, not a build/migrate/edit). "Build started" email sent. Integration DB created at /home/Arjun/stern-build/db/integration.db from stern-dev.db. Note: the box clock is UTC; the two entries above were stamped in UTC (23:10Z = 19:10 EDT). Entries from here on are real EDT.
- 2026-09-04 19:28 EDT: WP0 started. Plan docs, scripts, fixtures, seeds committed (2827e7b). 0029 migration copied unchanged to db/migrations and applied twice to integration.db (20 tables). Contracts written: lib/stern-types.ts (enums, labels, tones, SternSnapshot), lib/stern-workspace.ts, lib/stern/errors.ts. Shell/pages/nav and audit/vault/snapshot/API/CLI halves being built in parallel.
- Decisions (WP0): /school keeps a 3-line redirect stub to /stern instead of a bare deletion so the URL redirects rather than 404s (the countdown feature, lib/school.ts, and /api/school are deleted). Career glance card and legacy /career page point at /stern/career. The inbox zip /home/Arjun/stern-build/inbox/stern-tab-design-v1.zip is byte-identical to the unpacked handoff (sha256 verified), so no re-import. Codex notes files with the bundle path are ready at /home/Arjun/stern-build/prompts/notes-wp{1,2,4,6}.md; review requirement files at /home/Arjun/stern-build/reports/review-req-wp{1,2}.md.
- Inbox scan 19:32 EDT: no "Stern:"-prefixed emails. Three inputs from Arjun (Sept 4) are available for WP8 data load: "Stern 101 granola notes" (17:07), "Contex.md file (from claude.ai stern project)" (17:12), "Stern tab: Claude Design prompt + instructions (v1)" (15:24).
