# WP3 report: Email and Calendar automation

Current status: the fix round below supersedes the original delivery details where noted. Commit `8af68cf` passes the full gate: **285 tests passed, 0 failed**, including **34 automation tests**.

## Summary

Implemented the Stern email/calendar pipeline on `stern/wp3`, reusing WP0 audit/snapshot infrastructure and WP1/WP2 domain modules. The scanner discovers enabled NYU accounts and configured extras, ingests INBOX/SENT, deduplicates messages, classifies untrusted email, and applies or suggests audited effects. Draft generation, Google draft creation, calendar synchronization, batch undo, connection rows, authenticated API actions, scheduler jobs, and CLI scripts are wired.

Resume began with implementation commit `d69ef2c` and unfinished test/OAuth/isolation changes. Those changes were reviewed and completed in `9b9eb2f`; calendar recovery, attendance, reply reconciliation, adapter/API tests, and connection links were completed in `180912a`. Final attendee/CC handling and its regression test are in `dac6a9f`.

The supplied 20 email fixtures and additional adversarial scenarios run with local stubs. The mechanical gate passed with **238 tests, 238 passed, 0 failed**, migrations twice, typecheck, and production build. No server was started, deployed, restarted, or pushed. No external provider or live classifier was called.

## Files changed

Paths are relative to the worktree. Line references below identify the final implementation entry points.

| Path | Purpose |
| --- | --- |
| `lib/sources/google/index.ts:16` | Additive readonly/Stern scope sets, granted-scope storage, scope checks, access-token invalidation after re-consent, MIME decoding, full Gmail reads, real-ID pagination, draft creation, Calendar list/create adapters and dry-run modes. |
| `app/api/google/connect/route.ts:15` | Authenticated explicit `set=stern` and NYU defaults, with explicit readonly override and Stern hosted-domain target. |
| `app/api/google/callback/route.ts:20` | Recognize Stern OAuth target; enable the matching Stern connection after consent without removing Career behavior. |
| `components/panels/ConnectionsPanel.tsx:263` | Working Stern/NYU connect links request the extended scope set; new controls have test IDs. |
| `lib/connections/registry.ts:35` | Register three Stern connections alongside existing Career rows. |
| `lib/connections/index.ts:79` | Unconfigured Stern integrations report off instead of broken. |
| `lib/stern/connections.ts:13` | Cached 60-second Codex availability probe, domain-derived account rows, partial-scope and scanner-error details, honest disabled/unconfigured/healthy/broken summaries. |
| `lib/stern/automation-source.ts:6` | Account discovery, fixture adapters, dry-run enforcement, and shared in-process automation queue. |
| `lib/stern/gmail-scan.ts:18` | Per-account scanner, watermark handling, UNIQUE/hash dedupe, full-page ingestion before classification, policy calls, rules pass, agent lifecycle/count events. |
| `lib/stern/llm.ts:37` | Serialized argv-only Codex invocation, fresh temporary workspace and isolated Codex configuration, schema validation, timeout/retry, fixture/off modes, classification fallback and draft voice rules. |
| `lib/stern/apply.ts:199` | Confidence policy, replayable effect lists, suggestions, shared audit batches, calendar intents and audited minimal task/assignment upserts. |
| `lib/stern/calendar-sync.ts:12` | Fourteen-day calendar window, typed event matching, chat scheduling/completion, attendance confirmation, stable historical links, audit and lifecycle events. |
| `lib/stern/rules-pass.ts:7` | Request/thank-you/reply/follow-up drafts, silence transitions, later outbound reply reconciliation. |
| `lib/stern/drafts.ts:8` | Idempotent generation, regenerate/copy/create-Gmail-draft actions and audit state changes. |
| `lib/stern/coffee.ts:86` | Audited observed chat facts, monotonic lifecycle handling and SQL-derived follow-up counts. |
| `lib/stern/people.ts:327` | Audited observed relationship advancement through the existing people write/vault boundary. |
| `lib/stern/recruiting.ts:266` | Observed program milestones, club result reconciliation, submission and thank-you checklist updates. |
| `lib/stern/audit.ts:30` | Email-message audit entity and undo suppression: retain ingestion identity and mark undone messages ignored. |
| `lib/stern/automation-snapshot.ts:4` | Scan state, bounded message/suggestion/draft/audit live tails and connection summary. |
| `lib/stern/snapshot.ts:57` | Extend the shared Stern automation payload. |
| `lib/stern-types.ts` | Client-safe classifier/message contracts, audit entity and automation snapshot additions. |
| `app/api/stern/automation/route.ts:16` | Authenticated GET and all eight POST actions; validated error responses and Stern broadcasts. |
| `server/scheduler.ts:281` | Guarded email/calendar boot bursts, ten-/five-minute intervals, shared timer handles and subsequent Stern broadcasts. |
| `scripts/stern-automation.ts:4` | Email/calendar CLI entry points with explicit dry-run support. |
| `package.json` | `test:stern-automation`, `stern:email-scan`, `stern:calendar-sync` scripts. |
| `tests/stern-automation.test.ts:61` | Twenty-one tests covering fixtures, transitions, dedupe, undo, suggestions, drafts, calendar, connections, no-network Google transport and real API dispatch. |
| `docs/plans/stern/reports/WP3-report.md` | Acceptance evidence, policy inventory and integration handoff. |

No new migration or dependency was needed. The supplied migration and classifier schema were preserved.

## How verified

All application commands inherited `RATHWORKSPACE_DB=/home/Arjun/stern-build/db/wp3.db`. Unit tests follow the repository convention of setting their own disposable DB before importing the database module; WP3's disposable DB is inside this worktree and is removed afterward. Vault writes are disabled in automation tests. Google reads/writes use injected in-memory adapters or a stub `fetch`, and the test teardown asserts zero unexpected fetch attempts. Fixture and off modes never invoke Codex.

The first regression run demonstrated the repaired failures before implementation:

```text
# tests 15
# pass 12
# fail 3
calendar write failures preserve replayable intent ... Cannot read properties of undefined (reading 'kind')
real calendar creation can replace a dry-run intent ... 0 !== 1
calendar sync ... owner declined ... actual 'done', expected 'requested'
```

A notification-sender invite regression initially created two people instead of retaining one; attendee-based linking fixed it. The later outbound reply regression also failed before the rules fix (`1 !== 0` for `reply_needs_me`) and passed afterward.

The final standalone automation run:

```text
$ npm run test:stern-automation
1..21
# tests 21
# pass 21
# fail 0
# skipped 0
# duration_ms 6625.535362
```

The complete gate invocation:

```bash
STERN_LLM_MODE=fixture STERN_VAULT_WRITE=0 bash scripts/stern-build/gate.sh \
  /home/Arjun/stern-build/wt/wp3 /home/Arjun/stern-build/db/wp3.db wp3
```

Real first gate output excerpts, log `/home/Arjun/stern-build/logs/gate-wp3-20260905T025153Z.log`:

```text
--- typecheck rc=0
# tests 237
# pass 237
# fail 0
--- tests rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp3.db
--- migrate-1 rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp3.db
--- migrate-2 rc=0
✓ Compiled successfully in 33.4s
--- build rc=0
GATE wp3 result=PASS log=/home/Arjun/stern-build/logs/gate-wp3-20260905T025153Z.log
```

A second full gate also passed on the connection-link commit: `/home/Arjun/stern-build/logs/gate-wp3-20260905T025405Z.log`. Final gate on `dac6a9f` after the attendee/CC regression fix:

```text
--- typecheck rc=0
# tests 238
# pass 238
# fail 0
--- tests rc=0
--- migrate-1 rc=0
--- migrate-2 rc=0
✓ Compiled successfully in 14.5s
--- build rc=0
GATE wp3 result=PASS log=/home/Arjun/stern-build/logs/gate-wp3-20260905T025803Z.log
```

`git diff --check` passed. All implementation changes were committed before the final gate; the only subsequent change is this report. Final `git status --short` is required to be empty after the report commit.

Local event CLI smoke, using the isolated database:

```text
{"eventId":6020,"run":"platform-dev-wp3-resume-20260905","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6021,"run":"platform-dev-wp3-resume-20260905","agent":"rathworkspace-platform-developer","status":"completed","artifactId":75}
```

Acceptance checklist and executable evidence:

| Requirement | Implementation and tests |
| --- | --- |
| Scan/classify/apply/suggest/undo/draft/calendar pipeline | `gmail-scan.ts:18`, `apply.ts:199`, `calendar-sync.ts:12`; fixture tests at `tests/stern-automation.test.ts:61`, `:90`, `:115`, `:130`, `:152`, `:171`. |
| Safe classifier and no test network | `llm.ts:37` uses `execFile` argv, 120-second timeout, one retry, global concurrency one, isolated temporary configuration, disabled shell/web tooling and explicit untrusted-data prompt; validator tests at `:257`, off-mode at `:152`/`:183`, stub transport at `:375`. |
| Additive Google scopes/helpers | `lib/sources/google/index.ts:16`, `:80`, `:646`; scope/MIME tests at `:227`, paginated full-message/calendar/draft tests at `:375`. |
| Connections and complete authenticated API | `connections.ts:22`, API route `:16`; three-state tests at `:239`, all eight actions and unauthorized/no-broadcast checks at `:319`. |
| Scheduler, dedupe, rules and lifecycle | Scheduler `:281`/`:325`/`:364`; account isolation at `:183`, duplicate fixture at `:90`, later outbound reply at `:412`, account discovery and audited calendar kinds at `:454`. |
| Gate/report/commit | Gate evidence above; this report; implementation commits listed in Summary. |

## Decisions made

**Thresholds:** reuse `STERN_THRESHOLDS`: auto-apply at confidence **>= 0.85**, suggest at **0.60 <= confidence < 0.85**, ignore below **0.60**. Irrelevant content has no business effects. Unknown/ambiguous clubs, courses, programs, invalid observed transitions, and outbound-only classifications inconsistent with headers fall back to review. `other_nyu` and `club_other` never auto-apply. Newsletter deadline changes always require review.

**Complete policy inventory:** the following rules use the same effect executor for automatic application and accepted suggestions (`source=suggestion_accept`). Each source message's classification/status/effects share one batch ID. Calendar sync and its derived rules share a calendar batch.

| Classification | Effect at the auto threshold, except stated review rules |
| --- | --- |
| `coffee_chat_request_sent` | Derive To/CC recipients from outbound headers; upsert people and club affiliations/eboard evidence, email-sent touchpoint, requested chat, reached-out person. No recruiting checklist tick. |
| `coffee_chat_reply_positive` | Email-received touchpoint, replied person, reply-received chat and reply-needed flag for proposed times/required reply unless a later outbound message exists. Confirmed time schedules the chat. |
| `scheduling_proposal` | Append proposed times to prep notes; set/clear reply-needed from header direction. Inbound proposal records reply-received. |
| `scheduling_confirmed` | Record scheduled time/location; create a Stern calendar intent, then event. Stable ID supports retry; dry-run stores `dry-run:<hash>` with `created_by_us=1`. Missing write scope produces one daily connect suggestion containing replayable intents. |
| `calendar_invite` | Upsert a local invite event, link by counterpart email and schedule the chat. Google notification senders are not treated as people: extracted attendee addresses identify the participants. Actual calendar sync later reconciles provider events. |
| `coffee_chat_reply_negative` | Record received touchpoint and declined chat; do not advance the person's status. |
| `follow_up_sent` | Record follow-up touchpoint and timestamp; derive count from SQL touchpoints associated with this chat. |
| `thank_you_sent` | Mark thank-you sent and person chatted; record touchpoint; complete club thank-you checklist only when no done chat still owes one. Mark matching drafts sent-detected. |
| `club_application_confirmation` | Match club and track; mark program submitted and submission checklist complete. |
| `club_interview_invite` | Mark interview invited; store interview time/location and explicit dress-code evidence; add prep task for the prior New York calendar day and reply task when required. |
| `club_result_accepted` | Mark program accepted; update club result only after all its programs are decided. |
| `club_result_rejected` | Mark program rejected; reconcile club only after all programs are decided (any acceptance wins). |
| `icc_newsletter` | Upsert deadline tasks keyed by normalized label/date; propose differing program opening/deadline/decision dates. Never silently overwrite program windows. |
| `club_general_meeting` | Create one club/date attendance task; email alone does not tick attendance. A later ended calendar event with the owner's accepted RSVP, or a manual tick, confirms attendance. |
| `brightspace_assignment` | Upsert assignment by normalized course code/title; unknown or ambiguous course becomes a suggestion. |
| `brightspace_grade` | Update the same assignment to graded with earned/possible points only from explicit numeric grade/score evidence. |
| `course_announcement` | Upsert an assignment when supplied, otherwise deduplicated academic deadline tasks. |
| `exam_reminder` | Use assignment/task content through the academic path; fixture confidence 0.78 requires acceptance. |
| `other_nyu` | Deadline task suggestions only, including at high confidence. Accepting creates the tasks. |
| `club_other` | Review-only evidence, no automatic recruiting change. |
| `irrelevant` | Ignore business effects; retain classification/error and ingestion evidence. |

Additional decisions:

- Missing `classes.ts`/`tasks.ts`: use the spec-authorized minimal audited helpers in `apply.ts:47` and `:52`. WP4 owns the full modules; no parallel schema was introduced.
- The frozen classifier schema has neither `points_earned` nor `dress_code`. Use explicit evidence from the stored message body for those values; a grade without explicit earned/possible evidence becomes a suggestion.
- Calendar sync covers seven days back and seven ahead, allowing missed scans to complete chats. Confirmed coffee chats default to 30 minutes because the classifier contract carries one confirmed start and no end.
- Preserve historical calendar-to-chat links after thank-you completion. Cancelled events and invitations declined by the owning account do not prove attendance.
- Calendar write retries replay only the stored calendar intents. Failed retries leave the suggestion pending. Stable event IDs and `sendUpdates=none` prevent duplicate events/invitation emails; no delete API exists.
- Dry-run means external writes are simulated; audited local tracker changes still occur. Tests assert the dry-run calendar intent and stored event identity. Fixture/off modes force write dry-runs even if a caller passes false. Gmail draft dry-runs do not claim that a Gmail draft was created.
- Undo is local: ingestion identity is retained and the message becomes ignored to prevent rescan reapplication. Provider events/drafts are never deleted by undo. Scan cursors and account diagnostics are operational records rather than reversible domain facts.
- Shared automation queue serializes manual API jobs with scheduler jobs in the server process; all domain writes use immediate SQLite transactions. Provider calls happen outside SQLite transactions.
- Request drafting names Arjun as the sophomore transfer; recipient context cannot supply Arjun's major/year. Unknown major is omitted. Request, thank-you, follow-up, and reply-scheduling drafts can be regenerated or copied; there is no email-send path.
- The 3-/5-day silence rules generate one follow-up draft and transition to no-reply after five days; later outbound header evidence clears stale reply-needed flags even when the short reply body is classified irrelevant.
- Connection readiness uses granted scopes, account errors, scanner failures, and cached local Codex availability. This build's fixture checks establish local behavior, not live Google tenant consent or model quality.

## Known gaps

- Live Google OAuth, Gmail/Calendar access and subscription-backed Codex classification were intentionally not exercised under the no-network build rule. Their adapters are tested with local transport stubs; deployment validation remains with the orchestrator.
- WP6 owns the full Automation panel. This package supplies its authenticated API, typed shared live payload and working connection actions.
- Undo does not retract provider events or Gmail drafts; the specification prohibits deleting calendar events. Local audit history records the action and can restore local tracker state.

## Follow-ups for the orchestrator

1. Merge `stern/wp3` after review. No production checkout, production data, service, or remote branch was modified.
2. WP4: consolidate `upsertAutomationTask` and the assignment helper with the full tasks/classes domains while preserving dedupe and audit semantics.
3. WP6: consume `GET /api/stern/automation`, the shared `stern` live payload, and all eight actions. Expose pending calendar retry effects after reconnect and batch undo with its local-only semantics.
4. At deployment, connect the two NYU accounts via the Stern/NYU connection links, verify granted scopes and run an explicitly reviewed live classifier/provider smoke. Keep `STERN_LLM_MODE=off` until live automation should run; use fixture mode only with isolated data.
5. WP5 retains reminders/memo/iMessage ownership; this work package introduces no messaging delivery or outreach sender.

## Fix round

### Summary

Resumed from `ad35e02`, then ran `git merge feature/stern-tab` as instructed. The merge fast-forwarded to `a602073`, including the orchestrator's WP4 helper integration. Fix implementation and regressions are committed in `8af68cf`. This section supersedes the original delivery's temporary-helper, OAuth-default, bookkeeping-audit, connection-default, and argv descriptions above.

All confirmed findings are addressed. Repeated findings 1/6/7 share the retry fix; 2/10/11 share the explicit scope fix; 3/14 were already integrated by the orchestrator and were retained and regression-tested. No changes were made to the people, recruiting, coffee, tasks, or classes domain modules in this fix round. No migration was added.

### Files changed

| Path | Fix and acceptance evidence |
| --- | --- |
| `lib/stern/gmail-scan.ts:38` | Union pending/error message IDs with Gmail results independently of the cursor. Per-message fetch/date failures create retryable error records; one malformed email cannot halt the account. Classification errors skip policy, retain `applied='error'`, and carry attempt counts. |
| `lib/stern/gmail-scan.ts:68` | IMMEDIATE per-message claims prevent a competing scanner from applying the same pending message. Ten-minute stale claims recover after process failure. |
| `lib/stern/gmail-scan.ts:80` | Classification bookkeeping uses direct SQL instead of domain audit entries. Scan diagnostics report outstanding errors; message-level degradation completes with error counts, while account failures report failed. |
| `lib/stern/gmail-scan.ts:12` | Forwarded envelopes use the original From address for dedupe only; actual headers still determine direction. Already-duplicate rows cannot suppress the surviving original. |
| `lib/stern/automation-source.ts:6`, `lib/stern/calendar-sync.ts:16` | Enabled connection rows gate account discovery, including the Stern write account. Empty discovery exits before reads, rules, or agent work. Configured extra accounts use the NYU connection switch. |
| `lib/stern/apply.ts:100` | New requests/follow-ups exclude terminal chats; other categories retain historical matching. Meetings use the New York date. WP4 task validation/upserts and canonical assignment dedupe/grade exports remain intact. |
| `lib/stern/apply.ts:188` | Daily calendar-write suggestions use `nyDateKey()`. A new intent reopens an accepted/dismissed suggestion through the audit writer; pending suggestions append distinct intents. |
| `lib/stern/apply.ts:232`, `lib/stern/audit.ts:197`, `lib/stern/snapshot.ts:70` | Direct message status bookkeeping; legacy bookkeeping is excluded from undo and domain tails. Undo preserves classification/category/confidence and still marks the source message ignored. |
| `lib/stern/automation-snapshot.ts:7`, `lib/stern-types.ts:360` | API exposes grouped outstanding message-error counts; recent message error text includes attempt count. Message type includes the processed timestamp. |
| `lib/sources/google/index.ts:639` | Numeric HTML entities validate integer/range before `String.fromCodePoint`; malformed values produce an empty replacement. Existing Google helpers/scopes remain additive. |
| `app/api/google/connect/route.ts:21` | Only `set=stern` requests Stern permissions. Career NYU, generic and implicit Stern targets retain readonly. Flow scope is preserved in an HTTP-only cookie for callback routing. |
| `app/api/google/callback/route.ts:22` | Stern-specific OAuth diagnostic keys, tenant-approval detail for either NYU target, state validation before recording denial, and clear-on-success. Career reconnect does not enable Stern automation. |
| `lib/stern/connections.ts:22`, `lib/connections/index.ts:79` | All three Stern rows default disabled; remove the shared engine's special off override. Enabled missing accounts remain broken across refreshes. Stern summaries show saved consent errors. Codex is enabled manually. |
| `lib/stern/llm.ts:57` | Prompt on stdin; reduced email headers; minimal child environment (`NODE_ENV`, `PATH`, `HOME`, `LANG`, `TMPDIR`, isolated `CODEX_HOME`). Fixture/off paths stay local; a disabled live classifier never launches Codex. Draft sign-off permits `Arjun.`. |
| `lib/stern/drafts.ts:13`, `lib/stern/rules-pass.ts:9` | Six-hour failed-generation cooldown in operational KV, with no fabricated draft. Live rules honor the classifier switch. |
| `tests/stern-automation.test.ts:502` | Thirteen additional regressions, covering all fixes above, plus updated connection setup and course-error assertion. Total: 34 automation tests. |

### How verified

Standalone verification:

```text
$ npm run test:stern-automation
1..34
# tests 34
# pass 34
# fail 0
# duration_ms 9556.602987

$ npm run typecheck
> tsc --noEmit
(exit 0)

$ git diff --check
(exit 0)
```

The classifier execution regression runs a **local executable stub**, not the installed Codex or any LLM service. It verifies a stdin prompt over 128 KiB, no email in argv, omission of raw headers, absence of a synthetic secret in the child environment, isolated configuration cleanup, and the optional sign-off period. Other fixtures use in-memory Gmail/Calendar and OAuth stubs; test teardown asserts zero unexpected fetch attempts. Claim contention is exercised with two independent scanner entry points bypassing the process queue against the same SQLite database.

Read-only inspection of the assigned DB copy returned:

```json
{"assignments":0,"automationAssignments":0}
```

There are no WP3-era assignment keys to backfill in this copy. The merged WP4 `assignmentKey()` is tested against punctuated and unpunctuated titles. No production/shared data was inspected or edited.

Full gate on implementation commit `8af68cf`:

```text
$ STERN_LLM_MODE=fixture STERN_VAULT_WRITE=0 bash scripts/stern-build/gate.sh /home/Arjun/stern-build/wt/wp3 /home/Arjun/stern-build/db/wp3.db wp3
--- typecheck rc=0
# tests 285
# pass 285
# fail 0
--- tests rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp3.db
--- migrate-1 rc=0
[db] migrations up to date at /home/Arjun/stern-build/db/wp3.db
--- migrate-2 rc=0
✓ Compiled successfully in 19.5s
--- build rc=0
GATE wp3 result=PASS log=/home/Arjun/stern-build/logs/gate-wp3-20260905T033850Z.log
```

SQLite-only lifecycle CLI smoke against the assigned copy:

```text
{"eventId":6022,"run":"platform-dev-wp3-fix-20260905","agent":"rathworkspace-platform-developer","status":"running"}
{"eventId":6023,"run":"platform-dev-wp3-fix-20260905","agent":"rathworkspace-platform-developer","status":"completed","artifactId":76}
```

The only post-gate tracked change is this report. Final handoff requires an empty `git status --short` after the report commit.

### Decisions made

- Policy thresholds remain **auto >= 0.85**, **suggest >= 0.60 and < 0.85**, otherwise ignore. The complete category/effect inventory under the original Decisions made section remains the rule inventory, with bookkeeping now excluded from audit and task/assignment writes using WP4.
- Retry errors remain recoverable indefinitely. Attempts 1–3 can run on consecutive scans; after that each failed retry waits six hours. Never convert a classifier failure into an intentional ignore. The timestamp/error-prefix fields provide cooldown and diagnostics without a schema change.
- A live classifier switch defaults off. Gmail can retain retryable messages while it is off; the explicit `STERN_LLM_MODE=off` no-source scheduler path stays a complete scan no-op. Fixture mode is the test-only bypass of the live classifier switch.
- Calendar suggestion reopening replaces the reviewed effect list with the new intent. Prior accepted/dismissed intent history remains in audit. Pending rows continue to accumulate distinct intents for the same New York day.
- Preserve historical `email_message` audit records, but exclude them from undo and domain tails. New bookkeeping creates no audit rows. Domain effects still share a message batch and remain undoable.
- Explicit `set=stern` is the only consent escalation. A Stern consent attempt is user intent to connect, so an OAuth denial enables its row as broken with a durable error; success clears the error. Ordinary Career consent never enables Stern readers/writers.
- The claim test exercises the database claim path with independent entry points; it does not claim a real two-OS-process integration run. Claims expire after ten minutes, exceeding the classifier's two 120-second execution attempts.
- Runtime logs emitted by the mandatory gate use its prescribed shared build-log directory. Application writes use the assigned DB copy; disposable test files stay inside this worktree. No deployment, service restart, push, email, messaging, calendar provider write, or live classification ran.

### Known gaps

- Installed Codex support for `web_search="disabled"` and `features.shell_tool=false`, actual subscription auth, and Google tenant consent still require the orchestrator's authorized live smoke. The executable-stub test proves invocation/environment behavior, not the installed CLI's configuration semantics. Failures now remain visible and retryable.
- Existing production/shared WP3 assignment keys, if any, were outside this run's authorized data scope. The assigned copy contains none. Existing messages intentionally marked ignored are not automatically reclassified; the new retry handling applies to pending/error messages and future failures.
- The optional first-live-success `classifier_smoke` event was not added; scan lifecycle events, per-message errors, account error counts and connection health provide the failure diagnostics.

### Follow-ups for the orchestrator

1. Merge `stern/wp3` after review. The WP4 helper reconciliation is complete; do not replace it with the old temporary implementations.
2. Connect the two Google accounts with explicit Stern links and enable the Codex connection when live automation is intended. Confirm tenant consent, granted scopes, the installed CLI's config keys, and a live classification under the existing deployment plan.
3. If the deployment database contains old ignored messages with classifier error text, selectively requeue only those failed classifications before the next scan; do not reset intentional ignores or undone messages. Check old assignment keys before deployment if that database ever ran the temporary WP3 helpers.
