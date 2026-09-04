# Stern tab design brief

Purpose: a new full-screen tab inside a personal life-OS dashboard (Next.js, Tailwind, Radix primitives). It runs the academic and professional life of a sophomore transfer at NYU Stern: Stern club recruiting (the urgent part), a personal network database, a unified task list, classes with a grade book, a dormant career pipeline, and an automation panel. Desktop-first at 1440x900, plus two phone screens at 390 wide.

The build converts this design into code within hours, so the design must be conservative in its primitives and exact in its naming. Use only the tokens in stern-design-tokens.css. Use only these primitives: rail, header, page header, stat tile, card, table, right-side drawer, dialog, tabs, chips, badges, status dots, buttons (primary, secondary, ghost), inputs, selects, toggles, skeleton loaders, empty states, toasts. Icons: lucide. No illustrations, no gradients, no decorative charts, no second accent hue.

## Shell (every desktop screen)
- Left rail 240px, collapsible to 64px, background --stern-rail. Items top to bottom: Overview, Club Recruiting, Network, Tasks, Classes, Career, Automation. A small "Back to dashboard" link at the bottom. Active item gets a 3px violet left indicator.
- Top header 56px: page title on the left, a global search input in the middle ("Search people, clubs, tasks"), and on the right: a "Quick add" primary button (violet), a sync status dot with "Last scan 4 min ago", and the account avatar.
- Content area: max width 1280, 24px padding, cards on --stern-bg.

## Named components (use these exact names in layer names and annotations)
SternShell, PageHeader, StatTile, DeadlineStrip, ClubCard, ProgramCard, ChecklistItem, PersonRow, PersonDrawer, CoffeeChatChip, TouchpointTimeline, TaskRow, TaskGroup, CourseCard, CourseHeader, AssignmentRow, GradeBookTable, PipelineRow, SuggestionCard, AuditLogRow, ConnectionCard, EmptyState, QuickAddSheet, DraftPanel.

## Status vocabulary (chips and dots must use these exact labels)
- Club: Considering, Applying, Interviewing, Accepted, Rejected, Declined, Archived.
- Program: Not open, Open, Drafting, Submitted, Interview invited, Interview done, Accepted, Rejected, Declined, Withdrawn, Missed.
- Coffee chat: To request, Requested, Reply received, Scheduled, Done, Thank-you sent, No reply, Declined.
- Person relationship: Friend, General connect, Club connect, Mentor, Professional, Professor. Strength 1 to 5 shown as five small dots.
- Person status: Met, Need to reach out, Reached out, Replied, Chatted, Follow-up owed, Dormant.
- Task: Open, Done, Dropped. Domain: Academic, Professional, Campus.
- Assignment: Upcoming, In progress, Submitted, Graded.
- Change source badge: Manual, Auto (email), Auto (calendar), Auto (iMessage), Suggested.

## Screens (one artboard each, in this order)

1. Overview (desktop). PageHeader "Today, Friday Sept 4". Row of four StatTiles: Coffee chats owed (3), Deadlines in 14 days (5), Tasks due today (4), Follow-ups owed (2). Below, a two-column layout. Left column: DeadlineStrip (horizontal cards for the next deadlines with day counts in mono, warn color at 3 days, error at 1 day), then "Today's schedule" (class meetings and coffee chats with times, rooms, and a "Prep" link). Right column: "Needs you" list (a reply waiting on you 2h, a thank-you due by 4pm, a draft ready to send), then "Auto-applied today" (three AuditLogRows with an Undo link each). Include a small "Morning memo sent 8:00" line with a link.

2. Club Recruiting board (desktop). PageHeader "Club Recruiting, Fall 2026" with a filter chip row (All, Applying, Interviewing, Archived) and a "Process timeline" toggle. A compact timeline bar at the top showing the two application windows: Exploratory Sept 14 to 19, Teams Sept 20 to 26, interviews, decisions Sept 27 and Oct 4, with a "today" marker. Below, a grid of ClubCards (3 per row): club name, category chip, priority stars, status chip, next deadline in mono, coffee chats progress "2 of 2 chats done", checklist progress "4 of 6", and avatars of linked E-board people. Show 6 cards: Strategic Venture Society, Entrepreneurial Exchange Group, Blockchain and Fintech Club, Business Analytics Club, Finance Society, Stern Jewish Business Association. One card in Archived state, dimmed.

3. Club detail (desktop). CourseHeader-style header: club name, category, website and Instagram links, status chip, priority, "Archive" ghost button. Tabs: Overview, People, Application, Interview prep, Timeline. Show the Overview tab: left, two ProgramCards side by side (Exploratory program and Teams program), each with its own deadlines (opens, closes, interviews, decision), status chip, application link, dress code, and a "Requirements" list. Under them, the Checklist (ChecklistItems: Attend a general meeting, Coffee chat 1, Coffee chat 2, Draft application, Submit, Thank-you emails sent, Interview prep) with done states and dates. Right column: "E-board people" (PersonRows with CoffeeChatChips and a "Draft email" button on the To request ones), then "Recent activity" TouchpointTimeline with source badges (Auto (email), Manual).

4. Network (desktop). PageHeader "Network" with count "128 people". Filter row: relationship type chips, strength selector, club selector, status selector, "Follow-up owed" toggle, search. A dense table of PersonRows: name, affiliation (club or org, role, E-board badge), relationship chip, strength dots, status chip, last contact (mono, relative), next action, contact icons (email, phone, Instagram, LinkedIn, dimmed when missing). Row hover shows quick actions. Selected row opens the drawer in screen 5. Include an EmptyState variant below the table (as a small inset example) with the copy "No people yet. Text the Stern bot or use Quick add."

5. Person drawer (desktop, drawn over screen 4). 440px right drawer. Header: name, year and major, "How we met" line with date, relationship chip with an "Upgrade to Friend" action, strength dots editable. Sections: Contact (email, phone, Instagram, LinkedIn with copy icons), Affiliations (club chips with role and an "E-board" badge and a "Relevant for recruiting" toggle), Coffee chat (CoffeeChatChip state, requested date, scheduled date and calendar link, thank-you state, a DraftPanel with a generated thank-you email and "Copy" and "Open Gmail draft" buttons), Notes, and a TouchpointTimeline with source badges. Footer: "Set status" select, "Add task", "Archive".

6. Tasks (desktop). PageHeader "Tasks" with a domain chip row (All, Academic, Professional, Campus), "Due" grouping toggle (Today, This week, Later, No date). TaskGroups with TaskRows: checkbox, title, linked entity chip (STAT-UB 103, Strategic Venture Society, or a person), due date in mono, priority dot, source badge. A "Done today" collapsed group at the bottom. Right side: a slim "Add task" inline composer.

7. Classes (desktop). PageHeader "Classes, Fall 2026, 16 credits". Weekly schedule strip at the top (Mon to Fri columns with class blocks, room codes in mono). Below, four CourseCards: STAT-UB 103 Statistics and Regression, TECH-UB 1 Info Tech in Business and Society, MKTG-UB 1 Intro to Marketing, CAMS-UA 110 Science of Happiness. Each card: code, title, professor, meeting pattern, room, next due item, current standing in mono, "Open" button.

8. Course detail (desktop). CourseHeader: code, title, professor, section, room, credits, syllabus and Brightspace links. Tabs: Assignments, Exams, Grades, Notes. Show Assignments tab: AssignmentRows grouped by Upcoming, In progress, Submitted, Graded, with type chip, due date in mono, points, and source badge (Manual, Auto (email)). Right column: GradeBookTable with category weights (Homework 20%, Midterm 30%, Final 35%, Participation 15%), earned so far, computed standing, and a note "Curved section: top 35% earn A or A-".

9. Career (desktop). A deliberately quiet page. PageHeader "Career" with a "Dormant until club season ends" note chip. A simple PipelineRow table: organization, role, stage chip, deadline, last touch, next action. Show six rows (Henry.ai, Tessera Labs, Pear VC Fellows, OpenAI Student Collective, Engine Ventures, Klade). No hero tiles.

10. Automation (desktop). PageHeader "Automation". Top: three ConnectionCards (Stern Gmail and Calendar, NYU Gmail, Personal Gmail) each with a status dot, account email, scopes list, last scan time, and a "Reconnect" button, one of them in the "Needs re-auth" warn state. Middle: "Suggestions" (SuggestionCards for changes the system was not confident enough to auto-apply: proposed change, evidence excerpt from the email, Accept and Dismiss buttons). Bottom: "Audit log" table of AuditLogRows: time, entity, change (before to after), source badge, evidence link, Undo.

11. Phone quick add (390 wide). QuickAddSheet as a bottom sheet: segmented control (Person, Task, Note), then for Person: name, met at (event picker with today's date and time prefilled), club or org, role, E-board toggle, relationship type, contact fields, "Need to reach out for coffee chat" toggle, Save. Show the keyboard-safe layout.

12. Phone overview (390 wide). Condensed version of screen 1: StatTiles in a 2x2 grid, then "Needs you", then today's schedule.

13. Component sheet. All named components in their states side by side: chips for every status label above, status dots, buttons, inputs, StatTile, PersonRow, CoffeeChatChip states, AssignmentRow states, EmptyState, skeleton loader, toast "Auto-applied: Jane Park marked Replied. Undo".

## Content rules
- Placeholder people only, no real names. Clubs and courses above are real and fine to use.
- Every number, date, and time in JetBrains Mono. Everything else Inter.
- Show honest empty and error states. A panel with no data says so; it never shows fake data.
- Density: comfortable, not cramped. 14px base text, 8px between related items, 24px between sections.
