# rathworkspace.cloud

Personal life-OS command center. Cyan control-room dashboard behind a Google
sign-in gate, built for a 4K wall monitor. Visibility and organization, not a
place to build.

## Stack
Next.js (App Router) + TypeScript + Tailwind + a custom Node server that owns one
gated WebSocket and the source scheduler. better-sqlite3 for data. NextAuth Google
gate restricted to an email allowlist. ttyd + filebrowser embedded behind the gate.

## Layout (v2)
A routed app, not one scrolling page. A persistent collapsible left nav rail (flat,
all top-level, state in localStorage) is itself a live instrument: each item carries
a status indicator off the WebSocket (Agents dot, Email unread count, School
countdown, Connections amber-if-broken). Routes live under the `app/(dash)/` group
behind a shared server-auth layout (`components/shell/DashShell`):
- **Home** (`/`) — the decluttered daily glance: a large living centerpiece, live
  agents, today's calendar, today's to-dos, a scannable recent-email feed, Whoop,
  and a clickable project glance.
- One full page per section (`/vending`, `/ad-agency`, `/school`, `/agents`,
  `/email`, `/calendar`, `/health`, `/connections`, `/projects`, `/terminal`,
  `/files`, `/accounts`) built on a shared `ProjectPage` template (hero metric band
  over stacked sections). `/terminal` and `/files` render the embeds full-height.
- **Command palette** (⌘K / Ctrl-K) — fuzzy jump to any section/project plus actions
  (toggle ambient, recheck connections, connect Google, generate, sign out).
- **Ambient mode** — after 3 min idle or via the toggle, a cinematic full-bleed
  screensaver (breathing centerpiece + calm metrics); the rail hides.
The embedded ttyd/filebrowser stay at `/terminal/` and `/files/` (the custom server
proxies only those trailing-slash subpaths; the bare paths are the Next pages).

## How it runs (production, on the VPS)
Three systemd services:

| Service | What | Port (localhost only) |
|---|---|---|
| `rathworkspace.service` | the dashboard (Next + WS + scheduler) | 3000 |
| `rathworkspace-ttyd.service` | embedded terminal (ttyd) | 7681 |
| `rathworkspace-filebrowser.service` | embedded file browser | 8088 |

```bash
sudo systemctl status  rathworkspace            # dashboard
sudo systemctl restart rathworkspace            # after a code change + `npm run build`
sudo journalctl -u rathworkspace -f             # logs
```

The Cloudflare tunnel (`cloudflared-rathworkspace.service`) is the only public
ingress: `rathworkspace.cloud` -> `http://localhost:3000`. No ports are open; the
origin IP is hidden. ttyd and filebrowser bind to 127.0.0.1 and are reachable ONLY
through the gated `/terminal` and `/files` proxies inside the dashboard.

## The gate
App-level Google sign-in (NextAuth). Only emails in `GOOGLE_ALLOWED_EMAILS`
(in `~/.config/rathworkspace/secrets.env`) get in. Enforced in three layers:
the NextAuth `signIn` callback, `middleware.ts` on every route, and the custom
server's cookie check on the WebSocket and the `/terminal` `/files` proxies.

## Secrets
All in `~/.config/rathworkspace/secrets.env` (chmod 600, NOT in git). Loaded
server-side only via `lib/secrets.ts`. Google refresh tokens are encrypted at rest
(AES-256-GCM) in SQLite. Nothing sensitive reaches the client.

## Data
SQLite at `data/rathworkspace.db` (history, counters, connection states, agent
activity). Reads the Obsidian `~/command-center` vault for the Projects module.
Migrations in `db/migrations/`, applied on boot.

## What is live vs stubbed
- **Live now:** Agents (Hermes gateway + Telegram listener + Claude self-reports),
  Connections control plane (real health checks: Hermes, Tailscale, Cloudflare tunnel,
  Higgsfield, Telegram), Email + Calendar (per-account Google readers, with a
  scannable recent-email feed), Ad Agency (live Higgsfield credit balance + the
  generated-video portfolio via the `higgsfield` CLI, cached), Projects (vault),
  Terminal, Files, Accounts hub, the centerpiece + ticker.
- **Honest "connect me" until set up:** Whoop (Health), Mercury (Vending revenue —
  the pipeline, machines, and outreach are live from SQLite; only the $ figures wait
  on Mercury), the Ad-Agency outreach pipeline (runs in `~/ad-engine`, not yet wired).

## Arjun-only setup steps (each unlocks a module)
1. **Email + Calendar reader** — DONE 2026-06-22 (operator@example.com connected, 201
   unread + calendar live). The OAuth client lives in Arjun's PERSONAL Google project
   (project number GCP_PROJECT_NUMBER), NOT gcp-project. To add more accounts later, in that
   project's Google Cloud console OAuth client, ensure the redirect URI is present:
   `https://rathworkspace.cloud/api/google/callback` (and
   `http://localhost:3000/api/google/callback` for local). Then click "+ Add Google
   account" in the Email panel and approve. While the app is in Testing mode each
   account must be a test user (cap 100). Each account stores its own read-only token.
2. **Whoop** — create the app at developer.whoop.com (v2, include the `offline`
   scope), paste client id/secret into `secrets.env`, then authorize from Connections.
3. **Mercury** — when vending revenue starts, paste a read API token via the
   Connections panel (Mercury -> add key). Revenue fills in automatically.
4. **School** — the NYU calendar layers into Calendar automatically once classes
   start (2026-08-29).

## Known honest state
The Telegram listener currently shows `on_broken` because two pollers are running
(the bash `telegram-listener.sh` daemon and the Claude telegram bun plugin both call
`getUpdates`, which 409s). That is a real pre-existing conflict the dashboard is
surfacing correctly, not a dashboard bug.
