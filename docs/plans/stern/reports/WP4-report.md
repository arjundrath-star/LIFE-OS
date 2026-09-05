# WP4 report — Tasks, Classes, Career

## Summary

Latest status: the review fix round is complete; see **Fix round** below for findings, current verification, and the one deferred optional picker-scaling improvement.

WP4 implements the unified audited task list, Classes schedule and course detail with a grade book, and the existing Career workspace inside Stern's light theme. Work is confined to `stern/wp4`, `/home/Arjun/stern-build/wt/wp4`, and the assigned `/home/Arjun/stern-build/db/wp4.db` (unit tests use disposable databases). No deployment or external integration ran.

Resume started from implementation commit `04653a0`. No prior report existed. The pre-existing foundation-test change was reviewed and retained: legacy migration adds real baseline tasks, so the overdue assertion must measure the inserted task's delta.

Acceptance evidence:

| Acceptance item | Implementation and verification |
| --- | --- |
| Tasks view/API and legacy migration | `lib/stern/tasks.ts:22` create/dedupe, `:33` editable updates and transitions, `:40` SQL label joins, `:42` filters, `:58` grouping, `:64` snapshot. `app/api/stern/tasks/route.ts:11` gated GET and `:18` dispatch/broadcast. `components/stern/tasks/TasksView.tsx:10` domain chips, due groups, linked rows, collapsed Done today; `:31` composer. `db/migrations/0031_stern_todos_migrate.sql:2` idempotent audited import. `tests/stern-tasks.test.ts:1` covers dedupe, EDT/DST buckets, statuses, audit, and migration replay/undo. |
| Classes, grade book, seed and email helper | `lib/stern/classes.ts:9` courses, `:33` meetings, `:48` categories/weight validation, `:77` assignments, `:91` exported email upsert, `:104` standing, `:130` NY schedule. `app/api/stern/classes/route.ts:10` gated reads and `:14` writes/broadcast. `components/stern/classes/ClassesIndex.tsx:7` weekly grid/cards; `CourseDetail.tsx:14` detail/tabs, `:37` grade book, `:41` assignment and category dialogs. `scripts/seed-stern-courses.ts:9` idempotent four-course seed. `tests/stern-classes.test.ts:1` covers standing, weights, dedupe, schedule boundaries, seed, nullable-grade and CRUD undo. |
| Reuse Career with readable light portal | `app/stern/career/page.tsx:3` directly composes `CareerWorkspace` and the dormant chip. `components/stern/SternShell.tsx:82` mounts/removes `body.stern-theme`; `app/globals.css:292` shares theme tokens/remaps while takeover positioning stays on `.stern-mode`. `scripts/stern-wp4-e2e.ts` opens an existing-component Career row and checks portaled content colors, then confirms theme cleanup on leaving Stern. No Career component/domain/API/scheduler fork or modification. |
| Gate, report, commit | Required gate passed; real output below. This report and all source changes are committed on `stern/wp4`. |

## Files changed

- `lib/stern/tasks.ts`: validated task writes, audit, SQL links/counts and NY due buckets.
- `lib/stern/classes.ts`: course/meeting/category/assignment domain, standing, email upsert and schedule.
- `lib/stern/records.ts`: shared typed validation and audited IMMEDIATE transactions.
- `lib/stern/audit.ts`: register meetings/categories and correctly match NULL when undoing a cleared nullable grade; existing stale-update and cascade protections retained.
- `lib/stern-types.ts`: client-safe task/class snapshot and audit-entity types.
- `lib/stern/snapshot.ts`: compose task and class sections into the shared Stern channel.
- `db/migrations/0031_stern_todos_migrate.sql`: preserve and import legacy todos once with seed audit batches.
- `app/api/stern/tasks/route.ts`, `app/api/stern/classes/route.ts`: authenticated snapshots/action dispatch and `broadcastStern()` after writes.
- `app/stern/tasks/page.tsx`, `app/stern/classes/page.tsx`, `app/stern/classes/[courseId]/page.tsx`, `app/stern/career/page.tsx`: route adapters; detail keyed by course ID to avoid showing the previous course during navigation.
- `components/stern/tasks/TasksView.tsx`: task list, filters, composer, editing and completed/dropped history.
- `components/stern/classes/ClassesIndex.tsx`: schedule and four course cards; time-grid margin keeps the final meeting inside its day column.
- `components/stern/classes/CourseDetail.tsx`: assignments/exams/grades/notes, grade book, assignment/category/course/meeting editors.
- `components/stern/classes/format.ts`: New York date display and standing formatting.
- `components/stern/useSternArea.ts`: API first paint, live updates and mutation snapshots without polling.
- `components/stern/SternShell.tsx`, `app/globals.css`: portal theme inheritance, scoped light colors, WP4 layouts and compact empty task groups.
- `scripts/seed-stern-courses.ts`, `docs/plans/stern/seeds/courses-fall-2026.json`: public course seed preserving manual corrections on rerun.
- `tests/stern-tasks.test.ts`, `tests/stern-classes.test.ts`, `tests/fixtures/stern/wp4-tasks.json`: domain/migration regression tests.
- `tests/stern-foundation.test.ts`: overdue assertion relative to migrated baseline.
- `scripts/stern-wp4-e2e.ts`, `tests/fixtures/stern/wp4-career.json`: repeatable local authenticated browser/API/WebSocket journey with placeholder Career data.
- `package.json`: `test:stern-tasks`, `test:stern-classes`, `seed:stern-courses`, `e2e:stern-wp4` scripts.
- `.gitignore`: disposable WP4 test artifacts.
- `docs/plans/stern/reports/WP4-report.md`: this handoff.

## How verified

Required mechanical gate:

```text
$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp4 /home/Arjun/stern-build/db/wp4.db wp4
--- typecheck rc=0
--- tests rc=0
--- migrate-1 rc=0
--- migrate-2 rc=0
--- build rc=0
GATE wp4 result=PASS log=/home/Arjun/stern-build/logs/gate-wp4-20260905T024924Z.log

# tests 232
# pass 232
# fail 0
[db] migrations up to date at /home/Arjun/stern-build/db/wp4.db
[db] migrations up to date at /home/Arjun/stern-build/db/wp4.db
✓ Compiled successfully in 24.1s
```

The gate was rerun after the final layout changes and passed again. The browser journey then passed against that build, including schedule-block containment, followed by `npm run typecheck` (exit 0).

The full suite includes the foundation/workspace tests and CLI capture/dedupe coverage. Production builds run only through the gate's serialized lock.

Course seed run twice:

```text
$ npm run seed:stern-courses
{"courses":4,"batchId":"courses-seed:99696a40-cd5a-4120-942f-8d893cce1165"}
$ npm run seed:stern-courses
{"courses":4,"batchId":"courses-seed:dc73895c-13cc-44eb-98c4-04a6536582f3"}
```

Browser/API/WebSocket journey on `127.0.0.1:3140`, real built Next routes and placeholder allowlisted session. The server never imports the scheduler. Both server fetch and browser requests block external origins. Career's read response alone uses a placeholder fixture so copied personal records never appear in screenshots. Career receives no writes.

```text
$ npm run e2e:stern-wp4
{"auth":"401 APIs / 307 pages / 200 placeholder session","courses":4,"meetings":5,"tasks":"create/edit/complete/reopen/drop","gradeStanding":"80% -> 90%","dialogs":"assignments/categories/meetings","liveMessages":17,"phoneFits":true,"careerPortal":{"background":"rgb(255, 255, 255)","color":"rgb(20, 20, 31)","bodyClass":true,"portaled":true},"browserErrors":0}
{"cleanup":"test mutations undone; public courses retained"}
```

Screenshots are local ignored artifacts under `shots/stern-wp4-{tasks,tasks-phone,classes,course,course-phone,career-drawer}.png`. Desktop and 390px phone layouts were inspected. The final drawer screenshot waits for its opening animation to finish.

Local agent-event writer:

```text
{"eventId":6020,"run":"platform-dev-wp4-resume","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6021,"run":"platform-dev-wp4-resume","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6022,"run":"platform-dev-wp4-resume","agent":"rathworkspace-platform-developer","status":"completed","artifactId":75}
```

## Decisions made

- Read Claude Design screens 06–09 as markup; did not render the `.dc.html`. Reused its layout, density and status vocabulary, with real empty states. Explicit WP4 course facts override the design's illustrative professors/times/rooms/grades. No illustrative personal data was copied.
- The public seed includes the explicitly requested marketing professor. Unknown professors, schedules and the Friday recitation end remain blank. Repeated seeds preserve existing courses and manual corrections.
- This week means tomorrow through Sunday in New York; Today and Overdue are separate, disjoint buckets. Monday starts the next week. Whole date deadlines use the foundation helpers and remain due throughout that NY day.
- Legacy done todos have unknown completion times, so their `completed_at` remains blank instead of fabricating a Done today entry. Each legacy ID has one persistent audit batch; rerunning migration cannot resurrect an undone import.
- Course deletion archives to preserve assignments/history. Removing an assignment, category or meeting is audited and reversible; category removal clears assignment links within that same batch.
- Standing normalizes only over categories with positive weight and graded possible points. It falls back to total graded earned/possible when no weighted graded category exists. No grades means no percentage; zero earned is a real grade.
- Preserve the mandated global assignment dedupe key, `lower(code):normalized title`. Reject ambiguous active course codes and cross-term collisions with 409 instead of updating another term's assignment. Email updates preserve manually selected status and earned grades; WP3 can pass its existing `AuditMeta` as the third argument to share one source-message batch.
- The Career dormant chip is informational. Its established interactions and scheduler remain intact as required; the design's illustrative claim that automation stops is not added.
- Portal colors inherit through `body.stern-theme`, but takeover positioning never applies to body. This fixes shared Radix dialogs without forking Career or affecting other pages after Stern unmounts.
- Browser test uses the assigned DB and reverses only its new audit batches. Public seed stays available for integration review; no service restart, deployment, network integration, or git push occurs.

## Known gaps

No outstanding WP4 acceptance gaps. Unknown course facts remain visibly missing. External email ingestion is verified only through the exported helper's fixture/domain tests; WP3 owns actual scan integration. Career rendering is verified with placeholder read data, not production records. Dormancy intentionally does not disable the pre-existing Career scheduler.

## Follow-ups for the orchestrator

1. Merge `stern/wp4`; keep both packages' additions when resolving `lib/stern-types.ts`, `lib/stern/snapshot.ts`, `lib/stern/audit.ts`, `package.json`, and CSS.
2. Point WP3 at `upsertAssignmentFromEmail(courseCode, { title, kind, dueAt, points, gmailMessageId }, auditMeta)` from `@/lib/stern/classes`; pass the source message's shared batch metadata. WP4 does not edit `apply.ts`, `gmail-scan.ts`, or Google sources.
3. Run migration and `npm run seed:stern-courses` against the integration/deployment database at the authorized stage. Unknown details and syllabus weights can be entered through course/meeting/category editors.
4. Re-run the integrated gate after merge. `e2e:stern-wp4` is intentionally pinned to this worktree, database and port; adapt those explicit safety assertions for any later integration harness.


## Fix round

Resumed from `60038cb` and first ran `git merge feature/stern-tab`, which fast-forwarded cleanly to `e09c0c2`. The following supersedes the earlier merge instructions. The integrated WP3 helper calls remain intact; this round does not modify `lib/stern/apply.ts`, `lib/stern/gmail-scan.ts`, `lib/sources/google`, the Career domain/API/component, or scheduler.

### Summary and files changed

| Finding | Fix and evidence |
| --- | --- |
| 1 / 3: malformed legacy deadline crashes shared snapshots | `db/migrations/0031_stern_todos_migrate.sql:2` checks date shape, SQLite parseability, and calendar date validity before copying deadlines; rejected original text is preserved in notes and creation audit JSON. `lib/stern/tasks.ts:55` guards sorting as well as `:61` grouping with `validDate`, treating invalid stored deadlines as undated. `tests/stern-tasks.test.ts` covers prose, impossible dates, malformed suffixes, valid date/instant imports, replay, and both task and integrated Stern snapshots with already-corrupt rows. |
| 2: reminder emails erase due/points or reject graded rows | `lib/stern/classes.ts:99` only patches a nonblank string deadline and finite numeric possible points. Null, omitted, whitespace and empty deadlines preserve stored facts. `tests/stern-classes.test.ts` covers reminders before/after grading, retained status/earned/possible points, and finite numeric updates. Existing helper names, arguments and return types remain compatible with WP3; `dueAt` additionally accepts classifier nulls. |
| 4: iMessage tasks lack dedupe enforcement | `lib/stern/tasks.ts:26` requires a key for every non-manual source, including seed. Tests exercise rejection and repeat-call dedupe for auto, agent, iMessage and seed. |
| 5: awkward empty-state text | `components/stern/tasks/TasksView.tsx:10` defines explicit per-group copy; `lib/stern/tasks.ts:60` labels undated tasks “No date.” Browser coverage checks grouped and ungrouped empty views. |
| 6: failed initial load shimmers forever | `components/stern/useSternArea.ts:11` exposes refetch; `TasksView.tsx:24` and `components/stern/classes/ClassesIndex.tsx:17` render a failure state with Retry. Browser coverage injects a failed initial GET for each page, checks skeleton removal, and verifies Retry recovers. |
| Manual duplicate assignment silently discards input | `lib/stern/classes.ts:82` returns 409 for manual normalized-title collisions. Domain test verifies no write/audit change; browser/API tests verify conflict response and visible dialog error. Automated create dedupe remains idempotent. |
| Manual API accepts automation identity fields | `app/api/stern/tasks/route.ts:22` strips caller dedupe keys; `app/api/stern/classes/route.ts:25` strips caller Gmail message IDs. Both retain source=manual. Task domain manual key collisions also return 409. Browser journey verifies returned records and auth gates. Update allowlists already reject these fields. |
| Broadcast includes unbounded task history | `lib/stern/tasks.ts:66` selects the latest 100 non-open tasks by descending ID and reverses the tail, retaining all open tasks and a separate complete Done today list. `TasksView.tsx:27` labels the history limit. Regression test verifies the cap, order, SQL counts, and older completed-today tasks. Linked-entity catalog optimization is deferred below. |
| Exams composer defaults to homework | `components/stern/classes/CourseDetail.tsx:21` carries the selected tab's kind into the form and labels the action “Add exam.” Browser journey creates an exam and verifies it remains on Exams. |
| Mixed button appearance | `TasksView.tsx` and `CourseDetail.tsx` apply Stern button classes to remaining shared buttons, including secondary/removal actions. |
| Career accent leaks | `app/globals.css:357` adds Stern-scoped hover accent, timeline pseudo-element and base-border remaps. Existing Career component is reused. `tests/fixtures/stern/wp4-career.json` adds placeholder activity; browser checks actual hover and timeline computed colors plus the existing light portal checks. |
| Missing current weekday marker | `ClassesIndex.tsx:9` derives today's NY date and shows its date/aria-current marker with a scoped accent underline. Browser fixes its clock to Friday and checks “Fri · Sep 4.” |

`scripts/stern-wp4-e2e.ts` extends the existing isolated harness; it still uses port 3140, blocks external HTTP, never starts the scheduler, and undoes its own audited mutations. Domain tests use disposable DBs beneath this worktree as required by the test convention. Every non-test app/CLI command uses the assigned WP4 database.

### Decisions made

- Findings 1 and 3 are one defect, covered by migration and runtime defenses. Updated migration 0031 in place as explicitly requested for this pre-deployment build; no follow-up schema migration or destructive repair was introduced. Previously imported malformed values remain stored and safely displayed as undated; new rejected imports retain their raw deadline in notes.
- Blank/null email facts mean “not supplied.” Positive evidence can still update due dates and possible points. Manual editors remain able to clear values subject to graded-row validation.
- Seed automation also requires a stable key; the legacy seed already uses its todo ID. No exemption is needed.
- Manual duplicates return a conflict so submitted edits cannot silently disappear. HTTP callers cannot supply automation identity fields; domain automation callers retain their existing identity support.
- Bound only closed task history. Keep all open tasks and all completions today. The visible history label makes the limit explicit; the existing filtered list API can retrieve older rows.
- Keep the current linked-entity catalog complete. Capping it would silently hide valid courses, clubs or people. Moving it to a searchable on-demand endpoint needs a separate picker/API change and is left to the orchestrator rather than added to this correctness fix round.

### How verified

```text
$ npm run test:stern-tasks
# tests 8
# pass 8
# fail 0
$ npm run test:stern-classes
# tests 10
# pass 10
# fail 0
$ npm run typecheck
> tsc --noEmit
# exit 0

$ bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp4 /home/Arjun/stern-build/db/wp4.db wp4
--- typecheck rc=0
--- tests rc=0
--- migrate-1 rc=0
--- migrate-2 rc=0
--- build rc=0
GATE wp4 result=PASS log=/home/Arjun/stern-build/logs/gate-wp4-20260905T032258Z.log
# tests 265
# pass 265
# fail 0
[db] migrations up to date at /home/Arjun/stern-build/db/wp4.db
[db] migrations up to date at /home/Arjun/stern-build/db/wp4.db
✓ Compiled successfully in 20.0s

$ npm run e2e:stern-wp4
{"auth":"401 APIs / 307 pages / 200 placeholder session","courses":4,"meetings":5,"tasks":"create/edit/complete/reopen/drop","gradeStanding":"80% -> 90%","dialogs":"assignments/categories/meetings","liveMessages":22,"phoneFits":true,"careerPortal":{"background":"rgb(255, 255, 255)","color":"rgb(20, 20, 31)","bodyClass":true,"portaled":true},"browserErrors":0,"reviewFixes":"load retry / empty copy / Friday marker / exam default / duplicate conflict / manual identity / Career hover and timeline"}
{"cleanup":"test mutations undone; public courses retained"}
```

Inspected the regenerated Classes desktop and Tasks phone screenshots. The weekday underline, date typography, empty states and phone layout are readable. Screenshots remain ignored local artifacts. No app/source changes followed the passing build and browser run.

```text
$ git diff --check
# exit 0
$ git diff --name-only e09c0c2 -- lib/stern/apply.ts lib/stern/gmail-scan.ts lib/sources/google lib/career.ts app/api/career/route.ts server/scheduler.ts
# empty

# Local SQLite agent-event lifecycle output:
{"eventId":6023,"run":"platform-dev-wp4-fix-round","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6024,"run":"platform-dev-wp4-fix-round","agent":"rathworkspace-platform-developer","status":"completed","artifactId":76}
```

Implementation commits: `35822b3` (data/API/regressions), `ab5fffd` (UI/browser regressions), followed by this report commit. All changes are on `stern/wp4`; final `git status --short` is clean.

### Known gaps

All confirmed review findings are fixed. The optional linked-entity catalog scaling improvement remains: every task snapshot still includes all active course/club/person picker labels. Task history is now bounded, but the picker needs search/pagination before its catalog can safely be bounded. No external integration or deployment was run.

### Follow-ups for the orchestrator

1. Merge these fix commits from `stern/wp4` into the current integration branch and rerun the integrated gate. The requested integration merge already brought WP3's canonical helper calls onto this branch; do not repeat the old helper swap.
2. Migration 0031 now sanitizes new imports. Already-applied databases do not rerun it automatically; runtime guards cover any prior malformed rows. If desired, review those rows through the audited manual editor rather than rewriting migration history.
3. Consider searchable, on-demand linked-entity lookup as the network catalog grows. This is the sole deferred optional review finding.
