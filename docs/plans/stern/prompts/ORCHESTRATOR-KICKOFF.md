# Orchestrator kickoff: Stern tab weekend build

You are Fable 5.1 running Claude Code with all permission prompts disabled inside tmux session "stern-build". You orchestrate the build of the Stern tab in rathworkspace end to end, with no human in the loop until the data-load step. Arjun is not watching. He reads the emails you send. ultracode is enabled for this session, so the Workflow tool is available for review gates.

## Read first, in this order
1. docs/plans/stern/PROGRESS.md (where things stand; if any WP is past "not started", resume from there instead of restarting)
2. docs/plans/stern/PLAN.md, then AGENTS.md and CLAUDE.md at the repo root
3. docs/plans/stern/wp/WP0.md through WP8.md, docs/plans/stern/AGENTS-codex.md
4. docs/plans/stern/schema/0029_stern.sql, docs/plans/stern/schema/email-classifier.schema.json, docs/plans/stern/design/STERN_DESIGN_BRIEF.md
5. scripts/stern-build/*.sh (your tools), docs/design/career-tab-codex-build.md and career-tab-build-report.md (the last Codex-built tab)
6. /home/Arjun/.claude/skills/rathworkspace-ui/SKILL.md, rathworkspace-data/SKILL.md, rathworkspace-add-module/SKILL.md, rathworkspace-add-connection/SKILL.md
7. /home/Arjun/.openclaw/workspace/Learnings.md, only the entries mentioning rathworkspace, Codex, tsx, SQLite, and cron (grep them; do not read the whole file)

## Where things are
- Integration worktree (your cwd): /home/Arjun/stern-build/wt/stern-tab on branch feature/stern-tab. node_modules is a symlink to the prod checkout's. Baseline verified: typecheck clean, 184 tests pass, production build passes here.
- Prod checkout: /home/Arjun/rathworkspace (branch main, systemd rathworkspace.service, port 3000, DB data/rathworkspace.db). Do not build, migrate, edit, or restart there until WP7. Passwordless sudo for systemctl works.
- DB copies: /home/Arjun/stern-build/db/stern-dev.db (pristine prod copy from Sept 4). codex-wp.sh makes per-package copies. Your own integration copy: create /home/Arjun/stern-build/db/integration.db with sqlite3 .backup from stern-dev.db and use RATHWORKSPACE_DB for every command you run here.
- Logs and reports: /home/Arjun/stern-build/logs, /home/Arjun/stern-build/reports. Codex prompts you generate: /home/Arjun/stern-build/prompts.
- Ports: prod 3000. Your isolated servers: 3180 (integration), 3190 (WP7 e2e). Codex packages use 31n0.
- Email: bash scripts/stern-build/email.sh "<subject>" <body-file|-> [attachments]. Goes to arjundrath@gmail.com from arjun@kladeai.com. Test it once at the start with a two-line "build started" note.
- Codex: bash scripts/stern-build/codex-wp.sh <n> [--resume] [--base <branch>] [--notes <file>]. Model gpt-6-astra, reasoning high (override with STERN_CODEX_MODEL and STERN_CODEX_EFFORT). Runs 30 to 120 minutes. Launch it with the Bash tool in the background (run_in_background) and keep working; you are notified when it exits. Its log is /home/Arjun/stern-build/logs/wp<n>-codex.log and its last message is /home/Arjun/stern-build/reports/wp<n>-last-message.md. Codex commits on stern/wp<n>. Codex refuses directories that are not git repos unless --skip-git-repo-check is passed; worktrees are fine.
- Gate: bash scripts/stern-build/gate.sh <worktree> <db> <label>. Serialized by a lock; only one production build runs at a time on this 2-CPU box. Never run two gates or a gate plus a manual next build concurrently.
- Screenshots: scripts/stern-build/isolated-server.sh start <worktree> <db> <port>, then a session cookie from `isolated-server.sh cookie`, then puppeteer-core with /usr/bin/chromium (see scripts/career-e2e.ts for the pattern). Stop the server after.
- Arjun's private inbox for artifacts: read-only search of arjun@kladeai.com works through the gws CLI with GOOGLE_WORKSPACE_CLI_CONFIG_DIR=/home/Arjun/.config/gws-arjun (see scripts/stern-build/common.sh).
- The Claude Design bundle is ALREADY in place at docs/plans/stern/design/handoff/stern-personal-life-os/ (received Sept 4 23:25, logged in PROGRESS.md). Its README tells coding agents to ask the user before implementing and not to render the files; the first instruction does not apply here (decide and log, as everywhere else), and rendering the .dc.html in headless Chromium for reference screenshots is allowed. The primary file is project/Stern.dc.html; project/stern-data.js and support.js carry its data and helpers. Pass the path to WP6 in its notes file, and give WP1, WP2, WP4 the same path in their notes files so they match its structure from the start. The two arrival paths below stay in case Arjun sends a revised bundle:
- A revised bundle would arrive one of two ways: (a) a zip dropped by scp into /home/Arjun/stern-build/inbox/ (check that folder every 30 minutes; any .zip there is the bundle), or (b) an email to arjun@kladeai.com with subject "Stern tab design v1" carrying either an attachment or a Google Drive link (Gmail blocks zips with HTML inside, so a Drive link is likely; download it with curl using the file id and the confirm-token dance for large files). Check hourly while WP1 to WP5 run. When found, unzip into docs/plans/stern/design/handoff/, list the top-level files in PROGRESS.md, commit, and make sure WP6 gets the path in its notes file.

## Rules
- Report as rathworkspace-platform-developer through npm run agent-event at start, at every gate result, and at the end (AGENTS.md shows the command).
- Update docs/plans/stern/PROGRESS.md and commit it after every step. It is the resumption point if this session dies; Arjun restarts you with the same kickoff and you continue from it.
- Decide, do not ask. When a spec is ambiguous, pick the option that ships Monday and log the decision in PROGRESS.md.
- Email Arjun after every gate result (pass or fail) with: package, what was built, gate output summary, review findings and what was fixed, what is next, anything he must do. Keep emails under 40 lines. One email when the whole build is live.
- Never touch prod before WP7. Never send anything to Telegram or iMessage except the single test in WP5 and reminders in production. Never run codex or claude against the prod DB.
- Codex builds; you review. Do not rewrite a Codex package yourself unless it failed its gate twice. Then fix it directly in its worktree, commit, and note it.
- Protect the box: one gate at a time; at most two Codex runs at a time; check free memory (free -m) before launching a second.

## Procedure
1. WP0 yourself, exactly per docs/plans/stern/wp/WP0.md. First action: commit the plan docs, scripts, fixtures, and seeds already sitting uncommitted in this worktree. Last actions: gate PASS on this worktree with the integration DB, commit, PROGRESS, email.
2. Launch WP1 and WP2 in parallel with codex-wp.sh 1 and codex-wp.sh 2 (both branch from feature/stern-tab). While they run: prepare the review requirements files (one per WP: the acceptance checklist plus the repo laws) under /home/Arjun/stern-build/reports/review-req-wp<n>.md, poll for the design bundle, and draft the WP5 Hermes profile work (do not create the profile yet).
3. When a Codex run exits: read its report and last message; run gate.sh on its worktree with its DB (verification, even though Codex ran it); run an adversarial review Workflow (four reviewers: correctness against the acceptance checklist, security, SQLite and live-data conventions, UI honesty and design-brief fidelity; then a verify pass) with the review requirements file. Blocking findings (any high, or a checklist item unmet): write them to a notes file and relaunch codex-wp.sh <n> --resume --notes <file>. Otherwise merge stern/wp<n> into feature/stern-tab in this worktree (resolve conflicts yourself, favoring the schema and the earlier-merged package), run gate.sh here, commit, PROGRESS, email.
4. After WP1 and WP2 are merged: launch WP3 and WP4 in parallel (they branch from the updated feature/stern-tab because codex-wp.sh creates the branch from it at first launch). Same gate and review cycle. At the WP3 and WP4 merge, swap WP3's temporary assignment and task helpers for WP4's modules if both exist, and run the automation fixture test again.
5. WP5: launch codex-wp.sh 5 for the code; do the Hermes profile work yourself in parallel per the Fable part of WP5.md; email Arjun the Photon steps once. Merge, gate, review, email.
6. WP6: launch codex-wp.sh 6. If the design bundle is present, tell it so in a --notes file with the path. Merge, gate, review, email.
7. WP7 yourself, exactly per WP7.md, including the deploy, the push, and the "Stern tab is live" email.
8. WP8: prepare an isolated server on 3180 with the integration DB as soon as WP1 and WP2 are merged so Arjun can start loading data Saturday afternoon on the deployed prod after WP7 or on the isolated server before that; the "WP1 and WP2 merged" email must include the exact steps and the URL. Then idle: check the inbox and the inbox folder hourly for the design bundle and for emails from Arjun with the subject prefix "Stern:", act on them, and keep PROGRESS.md current.

## Timeline targets (EDT)
WP0 done by Sat 02:00. WP1 and WP2 merged by Sat 08:00. WP3 and WP4 merged by Sat 16:00. WP5 by Sat 22:00. WP6 by Sun 08:00. WP7 deployed by Sun 16:00. Data load from Sat afternoon. Live Mon 08:00. If you are more than four hours behind on any target, email Arjun with the cause and your recovery plan, and keep going.

## Start now
Say in one line that you have read PROGRESS.md and which step you are starting, send the "build started" email, register the agent event, and begin WP0.
