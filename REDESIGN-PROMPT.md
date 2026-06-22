# RATHWORKSPACE v2 — Redesign Build Prompt (ultracode)

Restructure the existing, live rathworkspace.cloud dashboard from a single cluttered page into a routed app with a persistent nav rail, a decluttered Home, and dedicated full pages per section. This is a **presentation + information-architecture restructure**, NOT a backend rebuild. Preserve every working data connection, the cyan theme, the Google gate, SQLite + Obsidian, and the honest-UI rule. Build for a 4K wall monitor. Max effort, verify as you go.

## Read first
- The app is at `/home/Arjun/rathworkspace` (Next.js, runs as systemd `rathworkspace` on :3000, served at https://rathworkspace.cloud through the cloudflared tunnel). It is LIVE and behind the Google gate. Code repo: github.com/arjundrath-star/LIFE-OS.
- Skills to use, do not reinvent: `rathworkspace-ui` (cyan design system, stack, motion modes), `rathworkspace-add-module`, `rathworkspace-add-connection`, `rathworkspace-data`, and the `frontend-design` skill for layout/typography craft.
- Current structure: `components/Dashboard.tsx` renders ~16 panels in one flat grid; "expand" opens a modal Dialog. Panels live in `components/panels/`. There are only 2 routes: `/` and `/signin`.

## Why we're changing it (the problem)
Everything is one scroll of equal-sized boxes with no hierarchy, the hero is overloaded so the living centerpiece is tiny, and detail-heavy sections (Vending, Ad Agency, School) are trapped in 200px boxes because the modal drill-down gives them no real space. Arjun loves the content; it needs room and navigation.

## What to build

### 1. Routed app shell + persistent nav rail (replaces single-page + modals)
- Convert to real Next.js routes. Each section gets its own page under `app/(dash)/<section>/page.tsx` sharing a layout. **Delete the modal-Dialog drill-down** — navigation replaces it.
- A persistent **collapsible left nav rail**: collapsed = icon strip (~56px), expanded = labeled (~220px), state persisted (localStorage). **Flat, all items top-level** (Arjun's explicit choice), in this order: Home, Agents, Email, Calendar, Vending, Ad Agency, School, Health, Connections, Projects, Terminal, Files, Accounts.
- **The rail is itself a live instrument:** each item carries a small live status indicator driven by the existing WebSocket — Agents shows a pulsing green/amber/red dot, Email shows the unread count, School shows the days-until-Sep-2 countdown, Connections shows an amber dot if any connection is broken. Even collapsed to icons, the rail reads as an ambient health strip.
- Add a **command palette (⌘K / Ctrl-K)**: fuzzy-jump to any section/project and key actions (toggle ambient, sign out, reconnect a connection). Power-user accelerator.

### 2. Home page (decluttered — the daily-flow / lunch screen)
Home is the curated glance, NOT a launcher and NOT everything. Per Arjun, it shows:
- The **living centerpiece, now large** (it finally has room) — keep the existing data-driven centerpiece tied to live agent state.
- **Live agents running** — which agents are active right now and their status (Hermes + its subagents, Telegram activity, Claude Code self-reports).
- **Today's calendar** — today's events only, across connected Google accounts.
- **Today's to-dos** — today's items.
- **Recent emails** — a better display than the current cramped list: sender + subject + account + time, scannable, the most recent/important first across the connected inboxes.
- **Whoop** — recovery, sleep, strain snapshot.
- **Projects glance + click-in** — a strip/section showing each project with one live status chip (Vending revenue, Ad Agency pipeline count, School countdown, etc.), each clicking through to its page.
- **Ambient mode** stays and gets MORE cinematic: when idle (3 min) or toggled, the rail hides and Home goes full-bleed to the breathing centerpiece + a few calm metrics. True screensaver, not just the grid hidden.

### 3. Dedicated section pages (full pages with live metrics)
Each existing panel becomes a full page. Reuse the existing data/API/WS wiring; give it room. Use one shared **ProjectPage template**: a header band (title + the section's hero metric(s) + live status) over stacked content sections. Specifically:

- **Vending Ops** `/vending` (the big one): hero = revenue today / this week / MTD (Mercury when connected — honest "connect Mercury" stub until then). Sections: Machines (each a card — location, stock level, last refill, needs-refill flag), Deal pipeline as stages (lead → bar said yes → machine being placed → live), Outreach-this-week counter (from the identified inbox) with reply signal, and a small map/placement view of machines.
- **Klade Ad Agency** `/ad-agency`: hero = the portfolio (the videos — thumbnail, play, the live website link). Sections: Higgsfield credit balance (live via the `higgsfield account status` CLI) + a "generate a video" launch link + recent generations (`higgsfield generate list`), and the outreach pipeline (leads → sent → replies).
- **School** `/school`: hero = the big countdown to **2026-09-02** (it owns the page). Now (pre-term): a "set up before term" checklist + the calendar feed placeholder. Once classes start: today's classes, assignments due, the week — from the NYU calendar (student@example.edu).
- **Agents / Connections / Email / Calendar / Health / Terminal / Files / Accounts**: each gets its own full page with the existing content, given proper space (e.g. Terminal and Files render full-height, not a tiny 46x14 box). **Projects** `/projects` is the hub listing all vault-derived projects (Portable Charging, Influencer, Klade, etc.), each linking to a project view.

## Design direction (frontend-design lens)
- **Hierarchy:** one dominant element per screen. On Home that's the centerpiece; on each section page it's the hero metric band. Stop the wall-of-equal-tiles effect.
- Keep the locked cyan system (near-black #0A0A0B, single cyan #06B6D4, JetBrains Mono numerics, glow on live elements only). Don't introduce a second accent.
- Motion: lively on working pages, cinematic on ambient Home. Pulse only on change. No strobing on a 24/7 wall.
- Honest-UI everywhere: explicit "connect me / no data" states for anything unwired (Whoop, Mercury). Never fake a metric.

## Hard constraints
- **No backend rebuild, no regressions.** Every data source that works today (agents/Hermes, Telegram, connections health, Google email/calendar, files, terminal, projects-from-vault, todos) must keep working. Reuse the server, scheduler, WebSocket, SQLite, and API routes.
- Secrets stay server-side in `~/.config/rathworkspace/secrets.env`; ttyd/filebrowser stay bound to localhost behind the gate; the Google allowlist gate stays enforced on every route (including the new ones — protect the whole `(dash)` group).
- Mobile/responsive floor: the rail collapses to a drawer on small screens; keyboard focus visible; reduced-motion respected.
- Commit as you go.

## When you finish or get blocked (REQUIRED)
When you reach the definition of done, OR you hit a blocker you cannot resolve, email Arjun a status summary before you stop:
```
gws gmail +send --to operator@example.com --subject "RATHWORKSPACE v2 — done" --body "<summary>"
```
The default `gws` account (ops@example.com) is already authed. Summary covers: what got restructured and verified, anything that regressed or is still stubbed (Whoop, Mercury), any blockers, and the live URL https://rathworkspace.cloud. Plain founder voice, no em dashes, no hype words. This is mandatory — Arjun detaches from the session and will not be watching; the email is how he knows it finished.

## Definition of done
rathworkspace.cloud serves the new routed app behind the Google gate. A collapsible flat nav rail with live per-item status is always present. Home is the decluttered daily-flow screen (big centerpiece + live agents + today's calendar + today's todos + recent-emails display + Whoop + clickable project glance) with a true cinematic ambient mode. Vending, Ad Agency, and School each have their own full page with live metrics per the sketches. ⌘K jumps anywhere. Terminal and Files render full-size. Nothing that worked in v1 regressed. It looks deliberate and high-end on a wall, with clear hierarchy, not a field of equal boxes.
