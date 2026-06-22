// Live hub: the single broadcast point for the app WebSocket. Stored on globalThis
// so Next route handlers and the custom server share ONE instance in this process.
import type { WebSocket } from "ws";

type Payload = any;

export interface LiveHub {
  clients: Set<WebSocket>;
  latest: Map<string, Payload>;
  last: Record<string, any>; // scratch space for change-diffing in the scheduler
  broadcast: (channel: string, payload: Payload) => void;
  snapshotFor: (ws: WebSocket) => void;
  addClient: (ws: WebSocket) => void;
  removeClient: (ws: WebSocket) => void;
}

const g = globalThis as any;

export function getHub(): LiveHub {
  if (g.__rw_hub) return g.__rw_hub as LiveHub;

  const clients = new Set<WebSocket>();
  const latest = new Map<string, Payload>();

  const hub: LiveHub = {
    clients,
    latest,
    last: {},
    broadcast(channel, payload) {
      latest.set(channel, payload);
      const msg = JSON.stringify({ channel, payload, ts: new Date().toISOString() });
      for (const ws of clients) {
        try {
          if ((ws as any).readyState === 1) ws.send(msg);
        } catch {
          /* drop */
        }
      }
    },
    snapshotFor(ws) {
      const batch = Array.from(latest.entries()).map(([channel, payload]) => ({
        channel,
        payload,
      }));
      if (batch.length) {
        try {
          ws.send(JSON.stringify(batch));
        } catch {
          /* drop */
        }
      }
    },
    addClient(ws) {
      clients.add(ws);
      hub.snapshotFor(ws);
    },
    removeClient(ws) {
      clients.delete(ws);
    },
  };

  g.__rw_hub = hub;
  return hub;
}
