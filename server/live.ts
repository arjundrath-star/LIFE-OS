// Live hub: the single broadcast point for the app WebSocket. Stored on globalThis
// so Next route handlers and the custom server share ONE instance in this process.
import type { WebSocket } from "ws";
import { appAllowlist, healthAllowlist, type WebSocketAuth } from "@/lib/ws-auth";
import { filterConnectionChannelPayload, filterTickerChannelPayload } from "@/lib/connections/access";

type Payload = any;
type LiveHubOptions = {
  now?: () => number;
  isAppAllowed?: (email: string) => boolean;
  isHealthAllowed?: (email: string) => boolean;
};

export interface LiveHub {
  clients: Set<WebSocket>;
  latest: Map<string, Payload>;
  last: Record<string, any>; // scratch space for change-diffing in the scheduler
  broadcast: (channel: string, payload: Payload) => void;
  snapshotFor: (ws: WebSocket) => void;
  addClient: (ws: WebSocket, auth: WebSocketAuth | null) => boolean;
  removeClient: (ws: WebSocket) => void;
}

const g = globalThis as any;

export function createLiveHub(options: LiveHubOptions = {}): LiveHub {
  const clients = new Set<WebSocket>();
  const latest = new Map<string, Payload>();
  const clientAuth = new Map<WebSocket, WebSocketAuth>();
  const now = options.now ?? Date.now;
  const isAppAllowed = options.isAppAllowed ?? ((email: string) => appAllowlist().includes(email));
  const isHealthAllowed = options.isHealthAllowed ?? ((email: string) => healthAllowlist().includes(email));

  const canReceive = (ws: WebSocket, channel?: string) => {
    const auth = clientAuth.get(ws);
    if (!auth || auth.expiresAtMs <= now() || !isAppAllowed(auth.email)) return false;
    return channel !== "health" || isHealthAllowed(auth.email);
  };

  const payloadFor = (ws: WebSocket, channel: string, payload: Payload) => {
    const auth = clientAuth.get(ws);
    const health = !!auth && isHealthAllowed(auth.email);
    if (channel === "connections") return filterConnectionChannelPayload(payload, health);
    if (channel === "ticker") return filterTickerChannelPayload(payload, health);
    return payload;
  };

  const hub: LiveHub = {
    clients,
    latest,
    last: {},
    broadcast(channel, payload) {
      latest.set(channel, payload);
      const ts = new Date().toISOString();
      for (const ws of clients) {
        if (!canReceive(ws, channel)) continue;
        try {
          const msg = JSON.stringify({ channel, payload: payloadFor(ws, channel, payload), ts });
          if ((ws as any).readyState === 1) ws.send(msg);
        } catch {
          /* drop */
        }
      }
    },
    snapshotFor(ws) {
      if (!canReceive(ws)) return;
      const batch = Array.from(latest.entries())
        .filter(([channel]) => canReceive(ws, channel))
        .map(([channel, payload]) => ({ channel, payload: payloadFor(ws, channel, payload) }));
      if (batch.length) {
        try {
          ws.send(JSON.stringify(batch));
        } catch {
          /* drop */
        }
      }
    },
    addClient(ws, auth) {
      if (!auth) return false;
      clientAuth.set(ws, auth);
      if (!canReceive(ws)) {
        clientAuth.delete(ws);
        return false;
      }
      clients.add(ws);
      hub.snapshotFor(ws);
      return true;
    },
    removeClient(ws) {
      clients.delete(ws);
      clientAuth.delete(ws);
    },
  };

  return hub;
}

export function getHub(): LiveHub {
  if (g.__rw_hub) return g.__rw_hub as LiveHub;
  g.__rw_hub = createLiveHub();
  return g.__rw_hub as LiveHub;
}
