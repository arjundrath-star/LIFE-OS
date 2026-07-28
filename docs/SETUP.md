# Setup

Operator notes for standing this up. Everything here is configuration, not code.

## Configuration

All configuration lives in an env file outside the repo, loaded server-side only through
`lib/secrets.ts`. Nothing sensitive is read on the client, and the file is never in git.

Required to boot:

| Key | What it is |
|---|---|
| `NEXTAUTH_URL` | Public origin the app is served from |
| `NEXTAUTH_SECRET` | NextAuth signing secret |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth client for sign-in and for per-account mail/calendar reads |
| `GOOGLE_ALLOWED_EMAILS` | Comma-separated allowlist. Anything not on it cannot sign in |
| `TOKEN_ENCRYPTION_KEY` | AES-256-GCM key for refresh tokens stored in SQLite |

Optional, per integration. Each one is inert and reports "not configured" until set:

| Key | Unlocks |
|---|---|
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | Health panel. Authorize from Connections after setting |
| `MERCURY_API_TOKEN` | Placeholder for banking revenue. The read model exists; ingestion does not |
| `DISCORD_BOT_TOKEN` / `DISCORD_WATCH_CHANNEL_IDS` | Deal watcher |
| `HERMES_URL` | Agent runtime status endpoint |
| `AGENTMEMORY_URL` / `AGENTMEMORY_TOKEN` | Memory BFF upstream |
| `POKEMON_ALERT_CHAT_ID` | Destination for the operational alert digest |
| `POKEMON_LOCAL_SPOTS_PATH` | Operator-local sourcing route file. Falls back to `data/`, then to the committed example |
| `CRM_SHEETS_ROOT` | Directory holding the read-only lead CSV exports |
| `OUTREACH_INBOX` | Mailbox the outreach read model counts from |

## OAuth client

The sign-in client and the per-account mail/calendar reader share one OAuth client. Register
both redirect URIs on it:

```
https://<your-domain>/api/google/callback
http://localhost:3000/api/google/callback
```

While the OAuth consent screen is in testing mode, every account you connect must be listed as
a test user. If refresh tokens keep expiring on a weekly clock, that is the consent screen's
publishing status, not a bug in the client: an app in testing mode is forced to short
refresh-token lifetimes.

Each connected account stores its own read-only token, encrypted at rest.

## First run

```bash
npm install
npm run migrate
npm run build
npm start
```

Migrations are additive and apply on boot, so `npm run migrate` is only needed when you want
them applied without starting the server.

## Deployment

Deployment is in place on the host, not on a platform. systemd runs the server with
`NODE_ENV=production`, and the custom server serves a prebuilt Next output. Shipping a change
is therefore build, then restart, in that order, since the build rewrites output under the
running server:

```bash
npm run build && sudo systemctl restart <app-service>
```

WebSocket clients reconnect with backoff, so the restart window is not user-visible beyond a
brief reconnect.

Three companion units run alongside the app: the terminal service, the file browser, and the
tunnel. The first two bind loopback and are only reachable through the app's authenticated
proxies. The tunnel is the only public ingress.

A note for anything invoked from cron or from a systemd unit: set `PATH` explicitly. Neither
inherits a login shell's PATH, and user-installed binaries silently fail to resolve otherwise.
