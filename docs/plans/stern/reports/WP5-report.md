# WP5 report

## Summary

Implemented and completed the review fix round for the Codex portion of WP5 on `stern/wp5`: audited, idempotent reminders; safe notification transports; a deterministic morning memo; minute scheduler ticks; and authenticated Automation API actions. Hermes profile/capture, Photon setup, operator messaging, and the one real phone test belong to the orchestrator under the run's explicit scope restriction.

No production checkout, deployment, real notification, or external write was used. Commands inherited the isolated WP5 DB; domain tests created disposable fixture databases. No schema migration was added.

Acceptance evidence:

| Codex requirement | Implementation | Verification |
| --- | --- | --- |
| All reminder rules; stable dedupe after snoozing | `lib/stern/reminders.ts:23`, `lib/stern/reminder-store.ts:18` | Deadline offsets for both applications/interviews, 30-minute/four-hour reply cadence, 20/22-hour thank-you escalation, three-day follow-up, tasks, suggestions |
| Quiet hours, urgency, failed/sent outcomes | `lib/stern/reminders.ts:83`, `lib/stern/notify.ts:21` | Midnight boundaries, spring/fall DST, urgent bypass, cancellation, claims, partial failures |
| Dry-run default and argv-only delivery | `lib/stern/notify.ts:10`, `lib/stern/email-send.ts:5` | Forbidden-runner assertions; injected argv/MIME/gws transport; timeout/fallback checks |
| Memo from local Stern/business/career snapshots | `lib/stern/memo.ts:17` | Fixture schedule, all sections, grouped yesterday counts, deterministic output, eight-line iMessage cap |
| Daily memo dedupe and scheduler | `lib/stern/memo.ts:69`, `server/scheduler.ts:292` | Simultaneous memo sends, dry-run followed by real-path stub, local-hour eligibility |
| Authenticated API, live tail and broadcasts | `app/api/stern/automation/route.ts:20`, `lib/stern/automation-snapshot.ts:6` | Unauthorized GET/POST, four new actions, invalid settings/IDs, one broadcast per mutation |
| Audited reminder/settings writes and undo | `lib/stern/audit.ts`, `lib/stern/notification-settings.ts:18` | Snooze restoration, absent-setting restoration, delivery state undo, refusal to erase later/in-flight delivery history |

## Files changed

- `lib/stern-types.ts`: client-safe reminder envelope/row/memo/settings types and audit entity names.
- `lib/stern/time.ts`: New York wall-time and clock helpers with DST correction.
- `lib/stern/reminder-store.ts`: IMMEDIATE audited queue/patch helpers, stable dedupe, chronological live tail.
- `lib/stern/notification-settings.ts`: allowlisted, validated notification settings and audited kv writes.
- `lib/stern/email-send.ts`: Python MIME and gws transport matching the existing build-email mechanism; bounded `execFile` argv calls.
- `lib/stern/notify.ts`: live environment safety switch, atomic send claim, Hermes fallback, per-channel outcomes, safe diagnostics.
- `lib/stern/reminders.ts`: evaluator, dispatcher, relevance checks, quiet hours, snooze action.
- `lib/stern/memo.ts`: local snapshot composition, plain text/iMessage templates, per-channel daily delivery claims and memo date marker.
- `lib/stern/audit.ts`: reminder entities plus allowlisted kv undo; protects delivery claims and newer reminder history.
- `lib/stern/automation-snapshot.ts`: reminder tail and notification settings in HTTP/live automation data.
- `app/api/stern/automation/route.ts`: `reminder.snooze`, `reminder.send_test`, `memo.send_now`, `settings.update`, behind `requireUser()`.
- `server/scheduler.ts`: guarded reminder/memo ticks, existing writer queue and timer ownership, broadcast after mutations.
- `scripts/stern-memo.ts`: `--dry-run` preview prints both formats without sending or consuming today's memo.
- `package.json`: `test:stern-reminders` and `stern:memo` commands.
- `tests/stern-reminders.test.ts`: domain, dry-run/transport, race, API/auth, audit and memo tests.
- `tests/fixtures/stern/reminders.json`: placeholder-only memo/reminder fixture.
- `docs/plans/stern/reports/WP5-report.md`: this report.

## How verified

Focused suite:

```text
$ npm run test:stern-reminders
1..19
# tests 19
# pass 19
# fail 0
```

Read-only CLI preview against the WP5 DB:

```text
$ STERN_NOTIFY_DRY_RUN=1 STERN_LLM_MODE=off STERN_VAULT_WRITE=0 npm run stern:memo -- --dry-run
# exit 0; both versions printed
CLI dry-run: both versions printed
iMessage lines: 2
Ends with required footer: True
Section present: Today's schedule True
Section present: Deadlines within 7 days True
Section present: Reply owed True
Section present: Thank-yous due True
Section present: Tasks due today True
Section present: Automation True
Section present: Business True
Section present: Career True
```

The preview's actual contents stay in an ignored local log, not this public report. The fixture test separately verifies the maximum eight-line message with an overflowing urgent-item list.

Final mechanical gate after all implementation changes:

```text
$ STERN_NOTIFY_DRY_RUN=1 STERN_LLM_MODE=off STERN_VAULT_WRITE=0 bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp5 /home/Arjun/stern-build/db/wp5.db wp5
=== typecheck (20260905T032428Z) ===
--- typecheck rc=0
=== tests (20260905T032444Z) ===
# tests 281
# pass 281
# fail 0
# skipped 0
--- tests rc=0
=== migrate-1 (20260905T032532Z) ===
[db] migrations up to date at /home/Arjun/stern-build/db/wp5.db
--- migrate-1 rc=0
=== migrate-2 (20260905T032533Z) ===
[db] migrations up to date at /home/Arjun/stern-build/db/wp5.db
--- migrate-2 rc=0
=== build (20260905T032533Z) ===
 ✓ Compiled successfully in 13.8s
--- build rc=0
GATE wp5 result=PASS log=/home/Arjun/stern-build/logs/gate-wp5-20260905T032303Z.log
```

The first gate also passed before the final interview/audit regression fixes (279 tests; log `gate-wp5-20260905T031910Z.log`). `git diff --check` passed. Implementation commits: `f3517f2`, `f042ddc`, `5595882`; report committed separately on the same branch.

Agent lifecycle uses `rathworkspace-platform-developer`, run `stern-wp5-20260905`, in the isolated DB. Started event output:

```json
{"eventId":6019,"run":"stern-wp5-20260905","agent":"rathworkspace-platform-developer","status":"running"}
```

Completion event output:

```json
{"eventId":6021,"run":"stern-wp5-20260905","agent":"rathworkspace-platform-developer","status":"completed","artifactId":75}
```

## Decisions made

1. Kept migration 0029 unchanged. `stern_reminders.message` stores a JSON envelope (`key`, `subject`, `body`, `urgent`, `scheduledAt`, optional `fingerprint`/`validUntil`). The immutable key survives `fire_at` changes from snoozing; the schema's UNIQUE tuple remains the final collision guard. Legacy plain-text rows still have a reader fallback.
2. Dry-run notification attempts are `skipped`, with `error="dry-run"` and empty `sent_at`; they never look delivered. Only `STERN_NOTIFY_DRY_RUN=0` enables delivery outside production. API `dryRun:false` cannot override `STERN_NOTIFY_DRY_RUN=1`. No environment merge is frozen at module import.
3. Hermes fallback is only for an absent wrapper (`ENOENT`). Timeouts/errors might mean a message already reached the phone, so they fail visibly without a second transport attempt. Each subprocess has a 20-second timeout. Diagnostics omit argv, message contents, and command stderr.
4. A delivery is claimed with an IMMEDIATE transaction using the existing `failed` status and `error="delivery-in-progress"`. A crash leaves an explicit ambiguous outcome for review; neither scheduler nor repeated memo calls automatically resend failed/ambiguous messages. Successful channels of a partial `both` delivery are recorded in the error detail and `sent_at`.
5. Rule evaluation catches up within each applicable local day, avoiding a backlog of obsolete deadline alerts on startup. Reply reminders use the newest due four-hour slot. Thank-you reminders have a normal 20-hour phase and urgent 22-hour phase; an unsent normal phase becomes obsolete after escalation. Submission/completion, changed dates, replies, and sent follow-ups suppress stale reminders before sending. A booked interview remains eligible while its program is not-open/open/drafting/submitted/interview-invited; application submission does not suppress a scheduled interview.
6. The daily memo uses two durable channel rows, so overlapping scheduler/API/CLI calls cannot duplicate email or iMessage. `stern.memo_last_date` is set only after both channels succeed. A dry-run does not consume the live memo. The automatic memo catches up during the 08:00 hour only; an explicit `memo.send_now` still respects daily idempotency. Explicit manual send/test actions send immediately; scheduled reminder delivery observes quiet hours.
7. Used the deterministic memo template without optional LLM polish. It works with `STERN_LLM_MODE=off` and never spawns Codex. Course meetings and cached calendar data are combined; linked chats/interviews and matching class events avoid schedule duplicates. Auto-applied yesterday is SQL `COUNT(DISTINCT batch_id)` of non-undone source batches.
8. Settings API uses an object keyed by full kv names. The user-editable keys are `stern.hermes_alias`, `stern.imessage_target`, `stern.memo_email`, `stern.quiet_hours_start`, `stern.quiet_hours_end`, `stern.threshold_auto`, and `stern.threshold_suggest`. Threshold values are decimal strings in [0,1], with suggest <= auto validated against the stored pair under an IMMEDIATE transaction; defaults remain 0.85/0.60. `stern.memo_last_date` is managed internally. Empty iMessage target means delivery is not configured; no real phone target was added to code or fixtures.
9. Database undo restores state. It refuses any reminder with sent status or a nonempty sent_at, including partial delivery, and refuses removing a memo date marker with delivered channel rows. This preserves delivery dedupe. Undo refuses a delivery claim during its two-minute bounded transport window; after that, an interrupted claim is explicitly undoable through the audit API after reviewing provider delivery. Undo refuses to delete a reminder with newer changes until those newer batches are undone first. One scheduler tick uses one audit batch across both evaluation and dispatch.
10. The provided gate necessarily writes its own shared build log/lock; all source edits remain inside this worktree. No server was booted and no service was restarted.

## Known gaps

- No Codex implementation blocker identified. UI controls are WP6 scope.
- Real provider acceptance is deliberately unverified. All delivery tests use injected runners; build/CLI commands force dry-run.
- Hermes profile/capture setup, private target configuration, Photon project provisioning/steps email, and a real reminder test are explicitly reserved for the orchestrator. This report does not claim the Fable acceptance item is complete.
- Ambiguous process failures require operator reconciliation before retry/undo. External delivery cannot offer exactly-once guarantees after a process dies between provider acceptance and local acknowledgement.

## Follow-ups for the orchestrator

1. Merge this committed branch after the mechanical gate and orchestrator review.
2. Complete the Fable/Hermes work from WP5: profile/capture skill, independent Photon configuration, private fallback alias/target kv values, operator setup email, and one reasonable-hour real phone test. These steps were not executed here.
3. Keep notification dry-run enabled during isolated integration runs. Before enabling real production notifications, configure the private target and verify the Hermes wrapper and gws account.
4. WP6 can read `automation.reminders`/`automation.notificationSettings` from the Stern live snapshot or the equivalent fields of GET `/api/stern/automation`. Parse the reminder envelope and display its `body`, `urgent`, and delivery status. POST shapes:

```json
{"action":"reminder.snooze","id":1,"until":"2026-09-08T12:00:00Z"}
{"action":"reminder.send_test","channel":"both","dryRun":true}
{"action":"memo.send_now","dryRun":true}
{"action":"settings.update","settings":{"stern.quiet_hours_start":"23:00","stern.quiet_hours_end":"07:00"}}
```


## Fix round

Merged `feature/stern-tab` first on `stern/wp5` (fast-forward from `ecd2070` to `dc0668b`). Implementation and regression tests are committed as `dfb6de2` (`fix(stern): harden reminder delivery and configurable thresholds`). All source edits stayed in this worktree; commands used the isolated WP5 DB or disposable fixture DBs. No schema change, network delivery, Hermes profile change, deployment, push, or production checkout access was performed.

### Summary and acceptance evidence

Duplicate review findings are grouped below. Every confirmed code finding (0 through 12) is addressed.

| Finding | Files changed and behavior | Regression evidence |
| --- | --- | --- |
| 0: house punctuation | `lib/stern/memo.ts:17`, `lib/stern/reminders.ts:23`, `lib/stern/reminder-store.ts:7`, `lib/stern/notify.ts:24`: replace template separators and normalize source-supplied em/en dashes at queue and transport boundaries | `tests/stern-reminders.test.ts:44`: after every test, assert all reminder subject/body text has no banned dashes; memo fixture and source punctuation tests at lines 183 and 348 |
| 1, 10, 12: thresholds | `lib/stern-types.ts:373`, `lib/stern/notification-settings.ts:28`, `lib/stern/notification-settings.ts:61`, `lib/stern/apply.ts:218`: expose both keys, validate finite decimal values and merged pair atomically, and read settings for classification | `tests/stern-reminders.test.ts:315`: bounds, invalid numbers, atomic rollback, defaults, snapshot fields, and live ignored/suggested/auto-applied transitions; API checks at line 255 |
| 2, 9: date-only interviews | `lib/stern/time.ts:58`, `lib/stern/memo.ts:35`, `lib/stern/reminders.ts:40`: one local-date helper for dates and instants | `tests/stern-reminders.test.ts:348`: absent on previous day, present as All day on actual date in email/iMessage; reminder agreement |
| 3, 6: de-listed clubs | `lib/stern/reminders.ts:16`: interested filter shared by evaluation, relevance checks, and memo interview selection | `tests/stern-reminders.test.ts:362`: setInterested(true), queue deadline/interview rows, setInterested(false), skip all queued rows without delivery or new inserts |
| 4, 5, 11: Hermes grammar | `lib/stern-types.ts:370`, `lib/stern/notification-settings.ts:33`, `lib/stern/notify.ts:43`: shared strict alias/Photon grammars at settings and transport boundaries; empty target remains unconfigured | `tests/stern-reminders.test.ts:374`: flags, spaces, invalid shapes, malformed stored target/alias, and 400 API responses; valid target used in argv transport test |
| 7: delivered undo | `lib/stern/audit.ts:200`: preflight entire batch before reversing fields; reject sent/partially sent rows and delivered memo date markers with 409 | `tests/stern-reminders.test.ts:395`, `:411`: no row loss or requeue; whole tick batch and partial memo remain deduped; standalone date marker also protected |
| 8: manual snooze expiry | `lib/stern/reminders.ts:134`: clear only the envelope expiry under the same transaction; retain fingerprint and entity relevance checks | `tests/stern-reminders.test.ts:437`: next-day snooze delivers open deadline/task/suggestion items in dry-run and skips a completed task |

### Additional low findings addressed

- `lib/stern/reminders.ts:140`: snooze collisions return a descriptive 409 before a SQLite UNIQUE violation; regression at `tests/stern-reminders.test.ts:450`.
- `lib/stern/memo.ts:72`: terminal memo channel rows return already-attempted before rebuilding; only actual claims make skipped false, and returned delivery rows are refreshed. Partial-failure regression at `tests/stern-reminders.test.ts:411`.
- `lib/stern/notify.ts:45`: aliases execute only from `/home/Arjun/.local/bin`, including fallback, rather than arbitrary PATH commands. Transport tests assert absolute wrapper paths and literal argv.
- `lib/stern/email-send.ts:10`: each call constructs a fresh environment with PATH, HOME, and LANG; only gws adds GOOGLE_WORKSPACE_CLI_CONFIG_DIR. The injected-runner test asserts the complete environment key set.
- `.gitignore:59`: ignore the complete reminder scratch directory, including SQLite sidecars left by an interrupted test.
- `lib/stern/notify.ts:35`: dashboard channel becomes skipped with dashboard-channel-not-implemented and empty sent_at, never sent; regression at `tests/stern-reminders.test.ts:450`.
- `server/scheduler.ts:292`: reminder and memo ticks broadcast only after relevant changes or an attempted memo.
- `lib/stern/audit.ts:328`: threshold undo also validates the resulting pair and rolls back with 409 if newer settings would leave suggest > auto; regression at `tests/stern-reminders.test.ts:462`.

### How verified

Focused verification after all behavioral changes:

```text
$ npm run typecheck
> tsc --noEmit
# exit 0

$ npm run test:stern-reminders
1..28
# tests 28
# pass 28
# fail 0
# skipped 0

$ STERN_NOTIFY_DRY_RUN=1 STERN_LLM_MODE=off STERN_VAULT_WRITE=0 npm run stern:memo -- --dry-run
# exit 0; full output retained only in ignored .stern-memo-fix-preview.log
Memo dry-run: both versions printed; <=8 iMessage lines; required footer; no em/en dashes.

$ git diff --check
# exit 0
```

Final mechanical gate on the committed code:

```text
$ STERN_NOTIFY_DRY_RUN=1 STERN_LLM_MODE=off STERN_VAULT_WRITE=0 bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp5 /home/Arjun/stern-build/db/wp5.db wp5
=== typecheck (20260905T035535Z) ===
--- typecheck rc=0
=== tests (20260905T035540Z) ===
# tests 313
# pass 313
# fail 0
# skipped 0
--- tests rc=0
=== migrate-1 (20260905T035624Z) ===
[db] migrations up to date at /home/Arjun/stern-build/db/wp5.db
--- migrate-1 rc=0
=== migrate-2 (20260905T035624Z) ===
[db] migrations up to date at /home/Arjun/stern-build/db/wp5.db
--- migrate-2 rc=0
=== build (20260905T035625Z) ===
 ✓ Compiled successfully in 18.8s
--- build rc=0
GATE wp5 result=PASS log=/home/Arjun/stern-build/logs/gate-wp5-20260905T035535Z.log
```

The first standalone typecheck found Next's required NODE_ENV type augmentation incompatible with a deliberately minimal child environment. The runner now types its environment as a string map and adapts it at the Node boundary; no extra environment variable was added. Subsequent typecheck and the gate both passed.

SQLite-only lifecycle events in the isolated WP5 DB:

```json
{"eventId":6022,"run":"stern-wp5-fix-20260905","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6023,"run":"stern-wp5-fix-20260905","agent":"rathworkspace-platform-developer","status":"completed"}
```

### Decisions made

1. Use the documented Photon project/thread/phone grammar, with a synthetic reserved example number only in tests. Empty target means unconfigured; no real recipient or fallback target was written to kv. Alias validation permits lowercase letters, digits, and hyphens, capped at 64 characters, and resolution is confined to the local wrapper directory.
2. De-listing suppresses both program deadline and interview reminders. This matches the explicit final review instruction and the canonical interested-club scope. Cached calendar events remain schedule sources.
3. Refuse undo of externally delivered notifications with 409 instead of deleting them or pretending delivery can be reversed. Unsent/dry-run reminders remain undoable. Protect partial deliveries through nonempty sent_at.
4. Manual snooze means explicit delivery at the chosen later time, even beyond the original daily expiry. Preserve status and fingerprint checks so completed, rescheduled, or de-listed items still cancel.
5. Keep confidence thresholds in WP5 as explicitly directed. Validation occurs inside the writer lock; classification reads current values on each call. Undo cannot create an invalid pair.
6. Leave full reminder envelopes in the existing API/live tail for WP6 compatibility. The optional body-truncation suggestion needs a coordinated per-reminder detail contract; adding that contract is deferred. Idle broadcasts are removed now.

### Known gaps

- Fable's Hermes profile/capture skill, private fallback configuration, Photon steps email, and real phone test remain outside Codex's authorized tree and no-network build scope. This run does not claim that acceptance checkbox is complete.
- The optional 280-character live-tail body projection remains deferred; the 100-row tail still contains full memo envelopes on actual broadcasts.
- Real provider acceptance is unverified. All tests exercising the enabled transport use injected runners; the CLI and gate use notification dry-run.

### Follow-ups for the orchestrator

1. Merge the fix commit and this report from `stern/wp5` after review. No push or deployment was performed.
2. WP6 can read and edit `stern.threshold_auto` and `stern.threshold_suggest` through the existing Automation settings payload; submit decimal strings. Show 409 conflicts for delivered reminder/memo undo and conflicting snoozes.
3. Complete the previously assigned Fable work and validate the production wrapper under its minimal environment before enabling notifications.
4. Coordinate a truncated reminder summary plus an authenticated detail reader with WP6 if payload size warrants it.
