# BUILD PROMPT — "Career" tab: professional endeavors tracker + discovery agent

You are Codex, running a long autonomous build session on Arjun's VPS in `/home/Arjun/rathworkspace`, the live rathworkspace.cloud life-OS dashboard (Cloudflare tunnel, Google-allowlist auth). Arjun is non-technical; nobody will answer questions mid-run. Decisions below were already made with him on 2026-08-05. Where something is genuinely undecidable, make the engineering call, note it in the final summary, and keep moving. Where a process is unknown (an API shape, an OAuth quirk), research it yourself with the tools you have; do not guess silently.

Read these before writing any code:
1. `AGENTS.md` (repo root) — the operating manual. You MUST follow its build-session rule (report lifecycle events as `rathworkspace-platform-developer` via `npm run agent-event`), its verification gates, and its hard safety rules.
2. `CLAUDE.md` (repo root) and `docs/` — stack conventions.
3. `/home/Arjun/.claude/skills/rathworkspace-ui/SKILL.md`, `rathworkspace-data/SKILL.md`, `rathworkspace-add-module/SKILL.md`, `rathworkspace-add-connection/SKILL.md` — treat these four files as design docs for how modules, data, UI, and connections are done here. They are written for another agent; the procedures apply to you identically.
4. One existing tab end-to-end as a reference implementation, e.g. `app/(dash)/vending/` plus its API routes, source, scheduler tick, and SQLite tables.

## What Arjun asked for

A clean, Notion-style tab that tracks his professional endeavors and finds new ones. Three categories, and only these three:

1. **Work** — internships, jobs, real positions at companies (e.g. his summer 2026 9-5 internship, future fall/spring internships).
2. **Klade** — the startup's endeavors while it lives: accelerator/incubator applications, fellowships applied to as founder, investor conversations.
3. **NYU / community (non-academic)** — clubs, fraternity rush, campus programs, networking (e.g. "meeting with Sean Hu about NYC Startup Week", NYU Entrepreneurship Club, IFC rush). Day-to-day academics are OUT of scope; the School tab owns those. No coursework, no grades, no class schedule.

## Decisions already made (do not relitigate)

- **New tab named "Career"** at `app/(dash)/career`, added to the nav alongside the existing tabs. The existing Projects tab is left completely untouched.
- **Notion UX patterns inside the existing house theme.** Research Notion's database UX first (see Research step), then implement its interaction patterns — table view, kanban board grouped by status, timeline/deadline view, inline cell editing, properties panel, quick-add row, filters by category/status — but style everything with the repo's existing design system and components (see the ui skill file). Do not introduce a light/document aesthetic that clashes with the rest of the dashboard.
- **Discovery agent: yes, both halves** (email status sync + new-opportunity hunting), gated behind a suggestions inbox. Details below.
- **Email read scope approved by Arjun:** `arjun@kladeai.com`, `arjundrath@gmail.com`, and his NYU email. Read-only Gmail scopes only.

## Research step (do this before designing the schema)

Spend a bounded slice (~15 min) researching how Notion structures tracker databases (properties, views, statuses, relations) and how well-regarded job-application trackers model their pipeline (applied → interview → offer → closed, plus deadline handling). Write your conclusions into `docs/design/career-tab-notes.md` (10-20 lines), then build to those conclusions. This file is also where you record any mid-build judgment calls.

## Data model (SQLite, follow the data skill's migration + counter + history conventions)

Design the final schema yourself after the research step, but it must cover:

- **endeavors** — the core table. Two kinds distinguished by a `kind` column: `engagement` (ongoing: a job, a club membership, Klade itself, a recurring relationship) and `application` (pipeline item: has a deadline and a status funnel). Category enum: `work | klade | community`. Notion-style properties: title, org, category, kind, status, deadline, url(s), contact name/email, location, notes (markdown), source (`manual | seed | discovery`), plus created/updated timestamps.
- **endeavor_events** — append-only history per endeavor (status changes, meetings held, emails received, notes). The tab renders these as a timeline on the detail view.
- **career_suggestions** — the discovery inbox: proposed new opportunities or proposed status changes, with evidence (source URL or Gmail message id + subject), state `pending | accepted | dismissed`. Accepting creates/updates an endeavor; dismissing suppresses it AND persists a dedupe key so the same suggestion is never re-proposed.
- Statuses for applications: `researching | drafting | submitted | interviewing | offer | accepted | rejected | withdrawn | missed_deadline`. Engagements: `active | paused | ended`.

SQLite gotchas that have already bitten this repo (verified incidents, respect them): writers from a second OS process must use IMMEDIATE transactions; never rely on UNIQUE keys containing NULLable columns for dedupe (store `''`); "live tail" queries are `ORDER BY id DESC LIMIT N` then reverse in JS; never cache a frozen merge of `process.env` at module load (multiple bundle instances — read env live).

## Seed data (do this as a migration-time or one-shot import script, idempotent)

Seed from the Fall 2026 application sprint, which lives in `/home/Arjun/.openclaw/workspace/applications/fall-2026/` (read-only for you — do not modify that directory):

- `programs.json` — 38 researched programs with tracks, deadlines, URLs, verified flags. Klade-track entries → category `klade`; individual-track → `work` (fellowships count as work pipeline); nyu-track → `community`.
- `progress.md` + `drafts/*.md` — which applications have drafted answers; set those to status `drafting` and link each to its Google Doc in the Drive folder "Fall 2026 Applications" (folder ID `1SRkmAeZMfcspzlf2O-zr9Jc0rTRpAT6z`; subfolders Klade `1egz5NOTpgLwb1-hypHnZMjVYxnMdMrY4`, Individual `1XZeXe7NOAQ-E5XhdYZP22fZ_wfcFgHgI`, NYU `1hbRM2IuVmn0T502fWftOzNh4vko8QOo0`). Doc links can be captured by listing those folders via the existing Google source auth if reachable; otherwise store the folder link and move on.
- Already-submitted Klade applications (status `submitted`): Y Combinator, Endless Frontier Labs, South Park Commons.
- Engagements to seed: Klade (active, category klade), his internship (ended ~late Aug 2026, category work; exact employer unknown — seed as "Summer 2026 internship" with a note to rename), NYU Stern sophomore starting Sept 2026 (context row, category community).

## The tab (follow the add-module skill end-to-end: tile, page, API, WS channel, scheduler registration, connection rows)

- `/career` page: view switcher (Table / Board / Timeline), category filter chips, search, quick-add. Inline editing on table cells and board cards. Detail drawer per endeavor: properties, links, contact, event timeline, freeform notes.
- A deadline strip: anything with a deadline in the next 14 days, sorted soonest-first, visually loud when ≤3 days.
- Suggestions inbox surface: badge with pending count, list with evidence links, one-click accept/dismiss.
- Dashboard tile for the home grid: counts by status, next deadline, pending-suggestions count.
- All live updates ride the existing WS scheduler pattern — the scheduler is the ONLY poller; the page never polls on its own.

## Discovery agent (two jobs, one new specialist agent)

Create `agents/career-scout/AGENTS.md` following the existing manifest pattern, and register its runs through `scripts/agent-event.ts` like every other specialist.

**Job A — email status sync (runs on the scheduler, e.g. every 30 min):** for each connected account, search recent mail for messages matching tracked endeavors (match on org domain, program name in subject/from). When a message plausibly indicates a status change (interview invite, rejection, offer, confirmation-of-submission), write a `career_suggestions` row proposing the change with the Gmail message id + subject as evidence. Do NOT silently flip statuses from email; everything goes through the inbox. Reuse the existing multi-Google OAuth reader (`lib/sources/google`, encrypted refresh tokens) — the vending tab's sent-mail scan is the reference. Gmail `resultSizeEstimate` is known-unreliable in this codebase; paginate and count real ids.
- Accounts: `arjun@kladeai.com` and `arjundrath@gmail.com` connect through the existing Google connect flow — register both as connection rows in the connections control plane (add-connection skill) with health states. The NYU account: NYU email is Google-Workspace-backed for students, so the same connect flow should work; build the connection row and connect button, and if NYU's tenant blocks the OAuth app, leave the row in a clean "connect blocked — needs NYU tenant approval" state and note it in the summary. Do not build a Microsoft adapter on spec.

**Job B — opportunity hunter (scheduled, e.g. daily):** a bounded research pass that looks for NEW opportunities matching Arjun's profile (NYU Stern sophomore in NYC, fintech founder, fall/winter/spring availability): student fellowships, accelerator batch openings, NYC startup events, campus program deadlines. Sources: web search/fetch of a configurable watchlist (seed it: Pear, Neo, Contrary, Z Fellows, Dorm Room Fund, 8VC, KP Fellows, Bessemer Fellows, NYU Entrepreneurship/eLab events page, NYC Startup Week, Gary's Guide NYC). Each find → `career_suggestions` row with source URL, dedupe-keyed so repeat scans stay quiet. If the runtime this repo gives you has no web-fetch capability from scheduled jobs, implement the hunter as a script the Hermes orchestrator can invoke (follow how other agents are triggered) and note that in the summary rather than faking it. Never fabricate an opportunity; every suggestion carries a real, fetched source.

## Hard safety rules (repeat of AGENTS.md, non-negotiable)

- Do not weaken the auth gate. No new public routes. `/api/career/*` sits behind the same middleware as every other API route; verify the allowlist matcher matches on segment boundaries.
- Gmail scopes read-only. Tokens encrypted at rest like the existing sources. No email sending anywhere in this feature.
- No secrets in git. `git status` before committing; check nothing under `data/` or `secrets` is staged.

## Verification gates (from AGENTS.md, all required before you call it done)

1. `npm run migrate` clean and idempotent (run twice).
2. Seed import idempotent (run twice, row counts identical).
3. `npm run build` passes.
4. Deploy: build then `sudo systemctl restart rathworkspace.service`; confirm the service is active and the WS reconnects.
5. Screenshot-level verification: hit `/career` through the real auth path (the repo has an established mint-session-JWT headless verification pattern — `docs/` and Learnings describe it) and confirm table/board/timeline render with the seeded 38+ rows, quick-add works, a suggestion accept round-trips.
6. Agent events: `started` at session start, `completed` (or `failed`, honestly) at the end, under `rathworkspace-platform-developer`.
7. Commit in scoped conventional commits as you go; this repo has a remote — push when green.

## Final output

End with a summary in Arjun's required format: (1) what you built, (2) what is verified (with the real command outputs), (3) what is blocked (NYU tenant? hunter runtime limits?), (4) what he must do (connect the three Gmail accounts in Connections, review the suggestions inbox). Write it to `docs/design/career-tab-build-report.md` as well as printing it.
