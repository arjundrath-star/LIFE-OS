# WP1: Club Recruiting (Codex)

Goal: the tracker Arjun uses every day from Monday Sept 7: which clubs he is targeting, each club's programs and deadlines, the per-club checklist, coffee chats with E-board people, and the timeline. Reads people written by WP2 through the schema only (no shared code with WP2).

## Data (tables from 0029): stern_processes, stern_clubs, stern_programs, stern_checklist_items, coffee_chats. You may add one additive migration db/migrations/0030_stern_interview_prep.sql with stern_interview_prep(id, program_id, question, answer, sort, updated_at) if you implement the Interview prep tab with structured rows (recommended).

## Domain: lib/stern/recruiting.ts (server) and lib/stern/coffee.ts (server)
- seedClubCatalog(): idempotent. Reads docs/plans/stern/seeds/clubs-catalog.json; creates process slug stern-clubs-fall-2026 ("Stern Clubs, Fall 2026", kind club_recruiting, season "Fall 2026"); upserts 32 clubs with interested=0, slug = normalized name, category, website, instagram. Never overwrites fields Arjun edited (only fills blanks).
- setInterested(clubId, true): marks interested=1, status considering, creates two stern_programs rows (Exploratory program and Teams program) with the window dates from program_windows when missing, and the checklist template: general_meeting, coffee_chat_1, coffee_chat_2, draft, submit, thank_yous, interview_prep (club-level, program_id 0). setInterested(false) keeps rows but hides the club from the board.
- updateClub, setClubStatus (valid transitions only; archived requires archived process or explicit archive), archiveClub, archiveProcess (sets all clubs archived, keeps data).
- upsertProgram, setProgramStatus with the allowed transition graph (not_open -> open -> drafting -> submitted -> interview_invited -> interview_done -> accepted | rejected; declined and withdrawn from any post-open state; missed set automatically when app_deadline_at passes while status is open or drafting).
- toggleChecklist(itemId, done).
- Coffee chats (lib/stern/coffee.ts): createCoffeeChat(personId, clubId, programId?) idempotent per (person, club) while not in a terminal state; transition(chatId, next, meta) enforcing to_request -> requested -> reply_received -> scheduled -> done -> thank_you_sent, with no_reply and declined reachable from requested or reply_received, and requested reachable again from no_reply (a new attempt increments follow_up_count). Every transition writes people_touchpoints (kind by transition) and stern_audit_log through lib/stern/audit.ts, and updates coffee_chats timestamps (requested_at, reply_at, scheduled_at, occurred_at, thank_you_sent_at). ensureCoffeeChatsForPerson(personId) creates to_request chats for each affiliation with relevant_for_recruiting=1 (WP3 wires the trigger).
- Snapshot section recruitingSnapshot(): process, clubs (interested only, with programs, checklist progress, chats done vs target_chats, next deadline, linked E-board people with their chat state), timeline windows, counts for the Overview (coffee chats owed, deadlines within 14 days, archived count). Also catalog list for the "Add clubs" dialog.
- Deadline math in America/New_York; a deadline is "due in N days" relative to local midnight.

## API: app/api/stern/recruiting/route.ts
GET snapshot. POST actions: seed_catalog, club.set_interested, club.update, club.set_status, club.archive, process.archive, program.upsert, program.set_status, checklist.toggle, chat.create, chat.transition, chat.update (prep_notes, takeaways, location), prep.upsert (interview prep rows). Every mutation broadcasts "stern".

## UI
- app/stern/recruiting/page.tsx -> components/stern/recruiting/RecruitingBoard.tsx: PageHeader "Club Recruiting, Fall 2026"; timeline bar with both application windows, interview windows, decision dates, and a today marker; filter chips All, Applying, Interviewing, Archived; ClubCards grid (name, category chip, priority stars editable, status chip, next deadline in mono, "n of m chats done", "n of k checklist", avatars or initials of linked E-board people, archived cards dimmed); "Add clubs" dialog listing the catalog with an interested toggle and a search box; empty state when no clubs are interested.
- app/stern/recruiting/[clubId]/page.tsx -> components/stern/recruiting/ClubDetail.tsx with tabs Overview, People, Application, Interview prep, Timeline exactly as the design brief describes. People tab: E-board people from people_affiliations for this club with CoffeeChatChip and a "Draft email" button (calls POST /api/stern/network with action drafts.request if that route exists, otherwise disabled with a tooltip "drafts arrive with automation"). Application tab: per program: deadlines, application_url, requirements, dress code, status control, notes. Interview prep tab: question and answer rows, dress code, quotes pulled from coffee_chats.takeaways of this club's people. Timeline tab: merged list of audit rows for this club and its programs plus touchpoints of its people, newest first, with SourceBadge.
- components/stern/DeadlineStrip.tsx (shared): horizontal cards for the next deadlines, warn color at 3 days, error at 1 day, mono day counts. Used here and later on Overview.
- data-testids: stern-recruiting-board, stern-club-card, stern-club-add, stern-club-detail-tabs, stern-program-card, stern-checklist-item, stern-chat-chip, stern-deadline-strip.

## Tests: tests/stern-recruiting.test.ts
Seed idempotent (run twice, 32 clubs, one process); setInterested creates programs and checklist once; invalid transitions throw SternError 400; missed auto-status; coffee chat transitions write touchpoints and audit rows; ensureCoffeeChatsForPerson idempotent; recruitingSnapshot counts; deadline math around midnight EDT.

## Acceptance checklist
- [ ] Catalog seeded idempotently from the public seed; no personal data anywhere.
- [ ] Board, Add-clubs dialog, ClubDetail with all five tabs, DeadlineStrip, archive flows all render with real data and honest empty states.
- [ ] Program and chat state machines enforced server-side; every transition audited; snapshot broadcasts.
- [ ] Interview prep rows persist.
- [ ] Tests cover every listed transition; gate PASS; report written; branch committed.
