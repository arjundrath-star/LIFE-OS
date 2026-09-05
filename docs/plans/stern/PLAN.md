# Stern tab: build plan

The Stern tab is a standalone full-screen section of rathworkspace.cloud (route /stern) that runs Arjun's NYU Stern academic and professional life: Stern club recruiting (urgent: coffee chats start Monday Sept 7, exploratory applications open Sept 14), a personal network database, a unified task list, classes with a grade book, the dormant career pipeline, and an automation panel. It mirrors the Business tab pattern (own shell, own light theme, own routes) and plugs into the same SQLite, WebSocket, scheduler, connections, and agent systems.

Companion docs in this folder: schema/0029_stern.sql (data contract), schema/email-classifier.schema.json (LLM output contract), design/STERN_DESIGN_BRIEF.md and design/stern-design-tokens.css (UI contract), AGENTS-codex.md (builder rules), wp/WP0..WP8.md (work packages with acceptance checklists), prompts/ORCHESTRATOR-KICKOFF.md (the orchestrator's mission), PROGRESS.md (state), reports/ (per-package build reports), seeds/ (public seed data).

## Decisions already made (do not reopen)
- Route /stern, label "Stern". Light theme, single accent NYU violet #57068C, Inter text, JetBrains Mono for numbers and dates. CSS scope .stern-mode, built like .business-mode.
- Sub-tabs: Overview, Club Recruiting, Network, Tasks, Classes, Career, Automation. Club Recruiting is a "process" that archives after this season. Career absorbs the existing /career endeavors read-mostly and stays dormant. The /school countdown tab is deleted; /school and /career redirect into /stern.
- Two NYU Google accounts are both scanned: the @stern.nyu.edu account (primary, sends and receives club mail) and the @nyu.edu account (forwards to Stern, not always). Forwarded duplicates are collapsed by content hash. Personal Gmail stays with the rest of the dashboard.
- Autonomy first. Confident detections auto-apply with a full audit log and batch Undo; uncertain ones become suggestions. Thresholds: confidence >= 0.85 auto-apply, 0.60 to 0.85 suggest, below 0.60 ignore (log only).
- LLM calls go through Codex on the ChatGPT subscription: codex exec with --output-schema for strict JSON, model gpt-6-astra (GPT-6 Astra, verified on the subscription Sept 4), sandbox read-only, no tools, tmp cwd with --skip-git-repo-check. Email bodies are untrusted input. No API keys. Fixture mode for tests never calls out.
- Drafts: person status "Need to reach out" creates a to_request coffee chat per relevant club and a request draft; chat done creates a thank-you draft; requested + 3 days silent creates a follow-up draft. Drafts show in the UI to copy; they become Gmail drafts in the Stern account when the gmail.compose scope is granted. Never auto-send.
- Calendar (Stern account) is the source of truth for schedule and reminders. Positive reply that Arjun has not answered: immediate iMessage nudge. Confirmed time: create the calendar event (calendar.events scope). NYU accounts use an extended scope set (gmail.readonly, gmail.compose, calendar.readonly, calendar.events); other accounts keep read-only. Dashboard login stays identity-only; signing in with a stern.nyu.edu account that has no data connection shows a one-click connect.
- Reminders and memo: Hermes profile "stern" on the photon iMessage platform (same bridge as the personal-trainer profile) plus email from arjun@kladeai.com to arjundrath@gmail.com. Memo at 08:00 America/New_York: full memo by email, key lines by iMessage ending "full memo in email". Quiet hours 23:00 to 07:00 for non-urgent pings.
- Capture: iMessage to the stern profile ("new contact, james, club application person, for club X") creates the person, affiliation, met date and time, and event, then confirms. Plus a phone quick-add sheet in the tab.
- Network is a first-class database on SQLite (WAL, indexed, audited, nightly backup, JSON and CSV export) with Obsidian notes under command-center/Stern/ via a write helper. Postgres only if it ever outgrows.
- Tasks: everything NYU and NYC-professional lives here. New stern_tasks table; old todos retired; Hermes kanban untouched.
- Classes: four courses entered by hand; Brightspace and professor notification emails parsed automatically into assignments.
- Repo stays public. Personal data (people, grades, phone numbers, seeds with real names) never enters git; it lives in SQLite, the vault, and ~/.openclaw/workspace/stern/. Public seeds (club catalog, course codes) are fine in docs/plans/stern/seeds/.
- Google auth is not needed to build. All email and calendar code runs against fixtures until Arjun connects the accounts.

## Who does what
- Fable (Claude Code, permissions off, tmux "stern-build", integration worktree /home/Arjun/stern-build/wt/stern-tab) orchestrates: WP0 foundation, prompts, launching Codex, gates, reviews, merges, WP5 Hermes work, WP7 hardening and deploy, progress emails.
- Codex (gpt-6-astra, codex exec, own worktree per package under /home/Arjun/stern-build/wt/wp<n>, own DB copy, own port 31n0) builds WP1 to WP6 from AGENTS-codex.md plus the WP spec.
- Gates: scripts/stern-build/gate.sh (typecheck, tests, migrate twice, production build; serialized by a lock) plus an ultracode adversarial review against the WP acceptance checklist. Pass merges into feature/stern-tab.
- Prod (/home/Arjun/rathworkspace, systemd rathworkspace.service on port 3000, DB data/rathworkspace.db) is untouched until WP7.

## Schedule (EDT)
Fri night: WP0. Sat 02:00 to 08:00: WP1 + WP2 in parallel. Sat 08:00 to 16:00: WP3 + WP4 in parallel. Sat 16:00 to 22:00: WP5. Sun 00:00 to 08:00: WP6. Sun 08:00 to 16:00: WP7 (deploy). Sat afternoon onward, as soon as WP1 and WP2 are merged and deployed to an isolated server or prod: WP8 data load with Arjun. Mon 08:00: live, memo #1.

## Arjun-dependent items (the orchestrator emails for these and continues without them)
1. Claude Design bundle: arrives by email to arjun@kladeai.com with subject "Stern tab design v1"; the orchestrator fetches it (read-only Gmail via gws-arjun) into docs/plans/stern/design/handoff/ and WP6 aligns to it.
2. Google connections (Stern first, then NYU, then personal) from the Automation page once deployed.
3. A Photon project for the "stern" Hermes profile (iMessage). Until then, delivery falls back to the personal-trainer alias target.
4. Data for WP8: clubs of interest and priorities, people already met, course details and syllabus dates.
