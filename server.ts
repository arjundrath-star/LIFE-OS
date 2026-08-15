// Custom Next server: owns the app, the single WebSocket, and the scheduler.
// Run via tsx (dev: tsx watch, prod: tsx server.ts after `next build`).
import { applySecretsToEnv } from "@/lib/secrets";
applySecretsToEnv(); // hydrate process.env BEFORE Next/middleware load

import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer, type WebSocket } from "ws";
import httpProxy from "http-proxy";
import { getDb } from "@/db";
import { getHub } from "@/server/live";
import { startScheduler } from "@/server/scheduler";
import {
  authorizeWebSocketCookie,
  guardAppWebSocketSession,
  guardPrivilegedProxySocket,
  type WebSocketAuth,
} from "@/lib/ws-auth";

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
  // Only the trailing-slash subpaths reach the embedded services (the iframes always
  // request "/terminal/" and "/files/"). The bare "/terminal" and "/files" are real
  // Next pages now (the full-size embed views), so they must NOT be proxied.
  if (pathname.startsWith("/terminal/")) return ttydProxy;
  if (pathname.startsWith("/files/")) return filesProxy;
  return null;
}

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
// Production ingress and both embedded tools are local-only. Default to loopback so a
// missing systemd HOST override cannot accidentally expose the origin on every interface.
const hostname = process.env.HOST || "127.0.0.1";

async function authorizeUpgrade(cookieHeader: string | undefined): Promise<WebSocketAuth | null> {
  return authorizeWebSocketCookie(cookieHeader);
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
      const auth = await authorizeUpgrade(req.headers.cookie);
      if (!auth) {
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
      const auth = await authorizeUpgrade(req.headers.cookie);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      guardPrivilegedProxySocket(socket, req.headers.cookie, auth, { authorize: authorizeUpgrade });
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
    const auth = await authorizeUpgrade(req.headers.cookie);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    (req as any).rathAuth = auth;
    (req as any).rathCookie = req.headers.cookie;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req) => {
    const initialAuth = (req as any).rathAuth as WebSocketAuth;
    const cookieHeader = (req as any).rathCookie as string | undefined;
    if (!hub.addClient(ws, initialAuth)) {
      try { ws.close(4001, "session expired"); } catch {}
      return;
    }
    guardAppWebSocketSession(ws, cookieHeader, initialAuth, { authorize: authorizeUpgrade });
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
