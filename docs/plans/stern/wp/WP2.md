# WP2: Network (Codex)

Goal: the people database. Runs in parallel with WP1; do not edit lib/stern/recruiting.ts or lib/stern/coffee.ts; read clubs through SQL only.

## Data: people, people_affiliations, people_touchpoints (from 0029). Read stern_clubs for pickers. Do not write coffee_chats or stern_drafts.

## Domain: lib/stern/people.ts (server)
- normalizeEmail, dedupeKeyFor(input): lower(email) when present, else "name:<normalized full name>:<normalized org>". createPerson(input, {source, batchId}) upserts by dedupe_key (fills blanks on the existing row, never overwrites non-empty fields unless {overwrite:true}); returns {person, created}. updatePerson with an EDITABLE allowlist; setStatus with transitions (met -> need_to_reach_out -> reached_out -> replied -> chatted -> follow_up_owed -> dormant, any -> need_to_reach_out, any -> dormant); setRelationship(type, strength) and upgradeToFriend; mergePeople(keepId, dropId) moving affiliations and touchpoints; archivePerson.
- Affiliations: addAffiliation(personId, {clubId|org, role, isEboard, relevantForRecruiting}), updateAffiliation, removeAffiliation. Touchpoints: addTouchpoint(personId, kind, {occurredAt, source, summary, detail, gmail refs}) with the UNIQUE guard; last_contact_at maintained from touchpoints.
- Every write logs through lib/stern/audit.ts with source manual unless given. Vault: on create and on notes change, call lib/stern/vault-write.ts upsertNote("People/<slug>.md", frontmatter {name, org, relationship, strength, status}, body notes). 
- Query: listPeople(filters: q, relationshipType[], strengthMin, status[], clubId, sphere, followUpOwed, archived, sort, page) using SQL (LIKE on display_name, org, email, instagram); getPerson(id) with affiliations, touchpoints live tail (ORDER BY id DESC LIMIT 50 reversed), coffee chats (read-only rows for this person). exportPeople(format json|csv). importPeople(jsonArray) for WP8 seeds (idempotent by dedupe_key).
- networkSnapshot(): counts (total, by relationship type, follow-ups owed, need_to_reach_out), recent people, for the Overview and the rail badge.

## API: app/api/stern/network/route.ts
GET: snapshot; GET ?person=<id>; GET ?export=csv|json (Content-Disposition attachment); GET ?q=...&filters for the table. POST actions: person.create, person.update, person.set_status, person.set_relationship, person.upgrade_friend, person.merge, person.archive, affiliation.add, affiliation.update, affiliation.remove, touchpoint.add, people.import. Every mutation broadcasts "stern".

## UI
- app/stern/network/page.tsx -> components/stern/network/NetworkTable.tsx: PageHeader "Network" with count; filter row (relationship chips, strength selector, club select from stern_clubs, status select, "Follow-up owed" toggle, search); dense table (name, affiliation with E-board badge, relationship chip, StrengthDots, status chip, last contact mono relative, next action, contact icons dimmed when missing); row click opens PersonDrawer; keyboard: Escape closes; URL ?person=<id> deep-links; export buttons; empty state copy "No people yet. Text the Stern bot or use Quick add."
- components/stern/network/PersonDrawer.tsx (440px right drawer): header (name, year, major, how met + date, relationship chip with "Upgrade to Friend", editable StrengthDots), sections Contact (copy icons), Affiliations (club chips with role, E-board badge, "Relevant for recruiting" toggle, add affiliation with club picker), Coffee chat (read-only summary of this person's coffee_chats rows with CoffeeChatChip; a DraftPanel that lists stern_drafts rows for this person if any, else "No drafts yet"), Notes (autosave), TouchpointTimeline with SourceBadge, footer with status select ("Need to reach out" included), "Archive".
- components/stern/network/QuickAddSheet.tsx: opens on the window event "stern:quick-add" (dispatched by the shell) and on ?add=1; mobile bottom sheet under 640px, dialog on desktop; segmented Person | Task | Note (Task and Note segments post to /api/stern/tasks and touchpoint.add when available; if the tasks route returns 404, show "Tasks arrive with the next package" inline); Person form fields exactly per the design brief with met_at prefilled to now; "Need to reach out for coffee chat" toggle sets status need_to_reach_out.
- data-testids: stern-network-table, stern-network-row, stern-network-filters, stern-person-drawer, stern-quick-add, stern-person-status, stern-person-strength.

## Tests: tests/stern-network.test.ts
Dedupe by email and by name+org; fill-blanks semantics; status transitions; merge moves children; listPeople filters and search; export csv escaping; import idempotent; vault note written to a temp vault; audit rows for every write.

## Acceptance checklist
- [ ] People CRUD, affiliations, touchpoints, merge, archive, import, export work through the API with audit rows.
- [ ] Table with all filters, PersonDrawer with every section, QuickAddSheet on mobile and desktop, deep links.
- [ ] No writes to coffee_chats or stern_drafts; reads of them render read-only.
- [ ] Vault notes under Stern/People/ on create and notes change (no-op when vault missing).
- [ ] Tests pass; gate PASS; report; committed.
