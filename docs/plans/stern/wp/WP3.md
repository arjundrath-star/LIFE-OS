# WP3: Email and Calendar automation (Codex)

Goal: the system reads both NYU inboxes and the Stern calendar, understands what happened, and updates the tracker on its own with an audit trail. Branch from feature/stern-tab after WP1 and WP2 are merged.

## Data: stern_scan_state, stern_email_messages, stern_calendar_events, stern_suggestions, stern_drafts, stern_audit_log (from 0029). Uses people, coffee_chats, stern_programs, stern_checklist_items, assignments, stern_tasks through their domain modules (lib/stern/people.ts, lib/stern/coffee.ts, lib/stern/recruiting.ts; for assignments and tasks, if lib/stern/classes.ts and lib/stern/tasks.ts do not exist yet on your branch, write minimal upsert helpers in lib/stern/apply.ts against the schema and note it in the report; WP4 owns the full modules).

## Google source changes (lib/sources/google/index.ts, additive only)
- SCOPE_SETS: "readonly" (current) and "stern" (openid email profile gmail.readonly gmail.compose calendar.readonly calendar.events). connectUrl(state, {scopeSet}) and handleCallback store granted scopes. accountScopes(email) helper. NYU-domain accounts default to the stern set in the connect route (app/api/google/connect/route.ts accepts ?set=stern).
- gmailFetchFull(email, messageId): full message with decoded text/plain (fallback: stripped text/html), headers, labelIds, internalDate. gmailListSince(email, sinceInternalDateMs, {labels: INBOX and SENT}) paginating real ids (resultSizeEstimate is unreliable).
- gmailCreateDraft(email, {to, subject, body}) using users.drafts.create; throws ScopeMissing when gmail.compose is absent.
- calendarEventsBetween(email, fromIso, toIso) and calendarCreateEvent(email, {summary, startIso, endIso, location, attendees, description}) with ScopeMissing when calendar.events is absent. Never delete events.

## Scanner: lib/stern/gmail-scan.ts
- accountsToScan(): enabled google_accounts whose email matches /@(?:[^@]+\.)?nyu\.edu$/ plus any kv "stern.extra_accounts" entries.
- runSternEmailScan({dryRun}): per account, list INBOX and SENT since last_internal_date (first run: newer_than:14d), fetch full, insert stern_email_messages (UNIQUE guard), compute content_hash = sha256(normalized from + subject + first 2000 chars of body); if another row with the same hash exists within 3 days -> applied "duplicate", skip. Otherwise classify (lib/stern/llm.ts), store classification, category, confidence, then policy (lib/stern/apply.ts). Per-account try/catch; a failing account never blocks the others; last_error recorded; agent events under stern-automation (started, gmail_scan with counts, completed or failed).

## LLM: lib/stern/llm.ts
- classifyEmail(msg): builds a prompt that states the email is untrusted data, gives Arjun's context (Stern sophomore transfer, club recruiting season, the club catalog names, his own addresses so direction is inferred from headers not content), and demands JSON only per docs/plans/stern/schema/email-classifier.schema.json. Runs: codex exec --output-schema <schema path> -m <kv stern.llm_model, default gpt-6-astra> --skip-git-repo-check --sandbox read-only -C <fresh temp dir> -o <out.json> "<prompt>" (the temp dir is not a git repo, so --skip-git-repo-check is required or Codex refuses the directory) with a 120 s timeout, one retry, concurrency 1 (a module-level promise queue on globalThis). Parses and validates the JSON against the schema (hand-written validator, no new deps). On failure: category "irrelevant", confidence 0, error recorded, never throws into the scan loop.
- STERN_LLM_MODE=fixture: returns the "expected" block for a fixture id (tests). STERN_LLM_MODE=off: everything is "irrelevant" with confidence 0 (safe default when codex is missing).
- generateDraft(kind, context) for request, thank_you, follow_up, reply_scheduling: same mechanism with a small schema {subject, body}; voice rules: short declarative sentences, specific reason for interest, no filler, no em dashes, no hype words, under 120 words, sign-off "Arjun"; request follows the granola format (name, year, major, reason, ask, flexibility).

## Policy engine: lib/stern/apply.ts
- applyClassification(message, cls): thresholds auto >= 0.85, suggest 0.60 to 0.85, else ignore. One batch_id per message. Effects by category (all through domain modules so audit rows are written):
  - coffee_chat_request_sent (outbound): upsert person(s) from recipients (source auto_email, affiliation with club if named, is_eboard from cls), touchpoint email_sent, coffee chat requested (create if missing), person status reached_out, checklist not touched.
  - coffee_chat_reply_positive: touchpoint email_received, chat reply_received with reply_needs_me=1 when proposed_times present and no outbound reply exists later in the thread, person status replied; if confirmed_time present -> scheduled.
  - scheduling_proposal (inbound or outbound): record proposed times on the chat (prep_notes append) and set reply_needs_me by direction.
  - scheduling_confirmed: chat scheduled with scheduled_at and location; create calendar event on the Stern account (dryRun records intent in the report and stern_calendar_events with created_by_us=1 and event_id "dry-run:<hash>"); ScopeMissing -> suggestion "connect calendar write" once per day.
  - calendar_invite: upsert stern_calendar_events, link to chat by attendee email, mark scheduled.
  - coffee_chat_reply_negative: chat declined, person status stays, touchpoint.
  - follow_up_sent: chat last_follow_up_at, follow_up_count+1, touchpoint follow_up_sent.
  - thank_you_sent: chat thank_you_sent, checklist thank_yous done when every done chat for the club has a thank-you, touchpoint.
  - club_application_confirmation: program submitted (matching club by name and track), checklist submit done.
  - club_interview_invite: program interview_invited with interview_at, interview_location, dress_code; task "Prep for <club> interview" due the day before; reply_needs_me handled as a task "Reply to <club> interview invite" when requires_reply_from_me.
  - club_result_accepted / club_result_rejected: program accepted or rejected; club status accepted or rejected when all its programs are decided.
  - icc_newsletter: store deadline_mentions as tasks with dedupe keys (icc:<label>:<date>) and update program windows when they differ from the seed (suggest, never auto, since this rewrites deadlines).
  - club_general_meeting: task "Attend <club> general meeting" due that day (dedupe by club+date), checklist general_meeting done only when a later calendar event or manual tick confirms attendance.
  - brightspace_assignment: assignment upsert by course code + title; brightspace_grade: points_earned and status graded; course_announcement and exam_reminder: assignment or task per content; unknown course -> suggestion.
  - other_nyu: task suggestion when a deadline is present; irrelevant: nothing.
- Everything under the suggest band becomes a stern_suggestions row with proposed_data = the effect list, so accepting replays it through the same code path (source suggestion_accept). undoBatch from lib/stern/audit.ts reverts a message's batch; stern_email_messages.applied set to "ignored" on undo.
- Trigger wiring: person status need_to_reach_out -> ensureCoffeeChatsForPerson + request draft per chat; chat done -> thank_you draft; chat requested older than 3 days with no reply -> follow_up draft and state no_reply after 5 days. Implement as a small rules pass run at the end of every scan (lib/stern/rules-pass.ts).

## Calendar sync: lib/stern/calendar-sync.ts
runSternCalendarSync(): 14-day window on NYU accounts, upsert stern_calendar_events, kind by title and attendees (coffee_chat when an attendee matches a person with an open chat, interview when the title matches a club, class when it matches a course meeting), link and transition chats (scheduled; done when end_at < now), agent events.

## Scheduler and connections
- server/scheduler.ts: tickSternEmail every 10 min and tickSternCalendar every 5 min (guarded, boot burst for both, respecting STERN_LLM_MODE), followed by tickStern broadcast.
- lib/connections/registry.ts: stern-google-stern (the connected account matching /@stern\.nyu\.edu$/, expects the stern scope set; on_broken with a clear detail when scopes are partial), stern-google-nyu (the connected account matching /@nyu\.edu$/ but not stern.nyu.edu); never hardcode NetID addresses in code, fixtures use netid@stern.nyu.edu and netid@nyu.edu and tests configure google_accounts rows to match, stern-llm-codex (configured when codex --version works and ~/.codex/auth.json exists; check runs a cached 60 s probe, not an LLM call). The existing career-google-* rows stay.
- API: app/api/stern/automation/route.ts GET (scan state, recent messages live tail, suggestions pending, audit live tail, connection summary); POST actions scan.now, calendar.sync_now, suggestion.accept, suggestion.dismiss, batch.undo, draft.regenerate, draft.create_gmail_draft, draft.mark_copied. Broadcasts "stern".

## Tests: tests/stern-automation.test.ts (fixture mode, no network)
Load tests/fixtures/stern/emails.json; run the scan against an in-memory Gmail stub that serves those messages in order; assert per scenario: person created with affiliation for fx-001; chat requested -> reply_received with reply_needs_me -> scheduled with a dry-run calendar intent -> thank_you_sent; declined; follow-up count; fx-020 duplicate; program submitted, interview_invited with dress code, accepted, rejected; icc_newsletter tasks and a suggestion for window changes; assignment upsert and grade; irrelevant ignored; every applied message has audit rows sharing one batch_id; undoBatch restores state; suggestions accept replays; STERN_LLM_MODE=off is safe.

## Acceptance checklist
- [ ] Scan, classify, apply, suggest, undo, drafts, calendar sync all implemented and exercised by the fixture tests.
- [ ] No network call in tests; codex call path isolated in lib/stern/llm.ts with fixture and off modes; email content never reaches a shell unescaped (pass the prompt via a file or argv, never through eval).
- [ ] Scope sets and new Google helpers are additive; existing accounts keep working.
- [ ] Connections registry rows honest in all three states; Automation API complete.
- [ ] Gate PASS; report lists every auto-apply rule and threshold; committed.
