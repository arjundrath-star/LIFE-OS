# WP5 report

## Summary

Implemented the Codex portion of WP5 on `stern/wp5`: audited, idempotent reminders; safe notification transports; a deterministic morning memo; minute scheduler ticks; and authenticated Automation API actions. Hermes profile/capture, Photon setup, operator messaging, and the one real phone test belong to the orchestrator under the run's explicit scope restriction.

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
8. Settings API uses an object keyed by full kv names. The user-editable keys are `stern.hermes_alias`, `stern.imessage_target`, `stern.memo_email`, `stern.quiet_hours_start`, and `stern.quiet_hours_end`. `stern.memo_last_date` is managed internally. Empty iMessage target means delivery is not configured; no real phone target was added to code or fixtures.
9. Database undo restores state, not messages already delivered outside SQLite. Undo refuses a delivery claim during its two-minute bounded transport window; after that, an interrupted claim is explicitly undoable through the audit API after reviewing provider delivery. Undo refuses to delete a reminder with newer changes until those newer batches are undone first. One scheduler tick uses one audit batch across both evaluation and dispatch.
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
