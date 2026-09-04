# WP6: Overview, Automation page, design conversion, polish (Codex)

Goal: the tab reads as one finished product. Branch from feature/stern-tab after WP5 is merged.

## Overview: app/stern/page.tsx -> components/stern/overview/Overview.tsx per design brief screen 1
StatTiles (coffee chats owed, deadlines in 14 days, tasks due today, follow-ups owed) from the snapshot; DeadlineStrip (WP1 component); "Today's schedule" merging course_meetings for today and stern_calendar_events (coffee chats, interviews, club meetings) sorted by time with a Prep link into the club; "Needs you" list (reply owed, thank-you due, drafts ready, suggestions pending) each with a one-click action; "Auto-applied today" AuditLogRows with Undo; "Morning memo sent 08:00" line from stern_reminders. Phone layout (screen 12): 2x2 tiles, then Needs you, then schedule. All from useApi first paint and useLiveData("stern") after.

## Automation: app/stern/automation/page.tsx -> components/stern/automation/AutomationView.tsx per screen 10
ConnectionCards for stern-google-stern, stern-google-nyu, career-google-personal (label "Personal Gmail"), stern-llm-codex, and Hermes (from the existing telegram/hermes health source) with status dot, account, scopes, last scan, Reconnect (links to /api/google/connect?set=stern with login_hint), "Scan now" and "Sync calendar now" buttons; a one-click connect banner when the signed-in user is a stern.nyu.edu address without a google_accounts row. Suggestions inbox (SuggestionCards with evidence excerpt, Accept, Dismiss). Audit log table with SourceBadge, evidence link that opens the message snippet in a dialog, Undo per batch. Reminders live tail with Snooze and "Send test". Settings drawer for kv: memo email, iMessage target, Hermes alias, quiet hours, thresholds (read from lib/stern-types defaults).

## Design conversion
If docs/plans/stern/design/handoff/ exists (Arjun's Claude Design export), align tokens, spacing, component structure, and copy to it without changing behavior; document deltas in the report. Otherwise follow docs/plans/stern/design/STERN_DESIGN_BRIEF.md screen by screen and produce the Component sheet as a Storybook-free page at /stern/automation?components=1 (dev-only, behind requireUser) so the orchestrator can screenshot every state.

## Polish
- components/home/Home.tsx: GlanceCard for /stern (coffee chats owed, next deadline, tasks due). components/shell/NavRail.tsx: badge on Stern = pending suggestions + reply owed (warn tone). Command palette entries for the seven Stern routes.
- Skeletons on every panel, honest empty states everywhere, focus rings, Escape closes drawers and dialogs, contrast 4.5:1 on muted text (check the tokens; adjust text-faint if it fails).
- The header search box searches people, clubs, and tasks through GET /api/stern?q= and shows a dropdown with deep links.
- Remove the legacy Todos panel from the Jarvis home if present (todos migrated in WP4).

## Tests
tests/stern-overview.test.ts (schedule merge across sources in EDT, needs-you derivation), tests/stern-search.test.ts.

## Acceptance checklist
- [ ] Overview desktop and phone, Automation page with all sections, search, glance tile, rail badge, palette entries.
- [ ] Every screen in the brief exists and matches the token file; component sheet page renders every status label.
- [ ] Gate PASS; report with screenshots list; committed.
