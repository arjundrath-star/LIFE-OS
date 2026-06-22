// Custom Next server: owns the app, the single WebSocket, and the scheduler.
// Run via tsx (dev: tsx watch, prod: tsx server.ts after `next build`).
import { applySecretsToEnv } from "@/lib/secrets";
applySecretsToEnv(); // hydrate process.env BEFORE Next/middleware load

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import { getToken } from "next-auth/jwt";
import httpProxy from "http-proxy";
import { getDb } from "@/db";
import { getHub } from "@/server/live";
import { startScheduler } from "@/server/scheduler";

// Embedded localhost services, proxied same-origin behind the gate (never public).
const TTYD_PORT = process.env.TTYD_PORT || "7681";
const FILEBROWSER_PORT = process.env.FILEBROWSER_PORT || "8088";
const ttydProxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${TTYD_PORT}`, ws: true });
const filesProxy = httpProxy.createProxyServer({ target: `http://127.0.0.1:${FILEBROWSER_PORT}`, ws: true });
function onProxyError(name: string) {
  return (_err: Error, _req: any, resOrSocket: any) => {
    try {
      if (resOrSocket && typeof resOrSocket.writeHead === "function") {
        resOrSocket.writeHead(502, { "content-type": "text/html" });
        resOrSocket.end(
          `<body style="background:#0A0A0B;color:#9CA3AF;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">${name} service not reachable on this box yet</body>`
        );
      } else if (resOrSocket && typeof resOrSocket.destroy === "function") {
        resOrSocket.destroy();
      }
    } catch {}
  };
}
ttydProxy.on("error", onProxyError("terminal (ttyd)"));
filesProxy.on("error", onProxyError("files (filebrowser)"));

function proxyFor(pathname: string | null) {
  if (!pathname) return null;
  if (pathname === "/terminal" || pathname.startsWith("/terminal/")) return ttydProxy;
  if (pathname === "/files" || pathname.startsWith("/files/")) return filesProxy;
  return null;
}

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOST || "0.0.0.0";

const ALLOWED = (process.env.GOOGLE_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const SECURE_COOKIE = (process.env.NEXTAUTH_URL || "").startsWith("https://");

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function authorizeUpgrade(cookieHeader: string | undefined): Promise<boolean> {
  if (!cookieHeader) return false;
  try {
    const cookies = parseCookies(cookieHeader);
    const token = await getToken({
      // this next-auth version reads req.cookies (a map), so pass both
      req: { headers: { cookie: cookieHeader }, cookies } as any,
      secret: process.env.NEXTAUTH_SECRET,
      secureCookie: SECURE_COOKIE,
    });
    const email = (token?.email as string | undefined)?.toLowerCase();
    return !!email && ALLOWED.includes(email);
  } catch {
    return false;
  }
}

async function main() {
  getDb(); // run migrations on boot

  const app = next({ dev });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer(async (req, res) => {
    const parsed = parse(req.url || "/", true);
    const proxy = proxyFor(parsed.pathname);
    if (proxy) {
      // Gate the embedded services with the same allowlist check as everything else.
      const ok = await authorizeUpgrade(req.headers.cookie);
      if (!ok) {
        res.writeHead(302, { location: "/signin" });
        res.end();
        return;
      }
      proxy.web(req, res);
      return;
    }
    handle(req, res, parsed);
  });

  // Gated WebSocket on /ws — same auth as the dashboard (allowlisted session only).
  const wss = new WebSocketServer({ noServer: true });
  const hub = getHub();

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = parse(req.url || "");

    // Embedded ttyd/filebrowser WebSockets — gated, then proxied to localhost.
    const proxy = proxyFor(pathname);
    if (proxy) {
      const ok = await authorizeUpgrade(req.headers.cookie);
      if (!ok) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      proxy.ws(req, socket, head);
      return;
    }

    if (pathname !== "/ws") {
      // In dev, let Next handle HMR upgrades; in prod, reject stray upgrades so
      // sockets to arbitrary paths don't sit open on the internet-facing origin.
      if (!dev) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
      }
      return;
    }
    const ok = await authorizeUpgrade(req.headers.cookie);
    if (!ok) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    hub.addClient(ws);
    ws.on("close", () => hub.removeClient(ws));
    ws.on("error", () => hub.removeClient(ws));
    // keepalive ping
    const ping = setInterval(() => {
      try {
        if ((ws as any).readyState === 1) ws.ping();
      } catch {}
    }, 25000);
    ws.on("close", () => clearInterval(ping));
  });

  startScheduler();

  server.listen(port, hostname, () => {
    console.log(`> rathworkspace ready on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
