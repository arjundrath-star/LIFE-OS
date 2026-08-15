"use client";
// One app-owned WebSocket. Panels never poll sources directly — they read live
// channels from this store. Server pushes { channel, payload, ts }.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

type ConnStatus = "connecting" | "open" | "closed";

export class LiveStore {
  private data = new Map<string, any>();
  private listeners = new Map<string, Set<() => void>>();
  status: ConnStatus = "connecting";
  private statusListeners = new Set<() => void>();
  private epoch = 0;
  lastMessageAt = 0;

  private clearData() {
    const channels = [...this.data.keys()];
    this.data.clear();
    this.lastMessageAt = 0;
    for (const channel of channels) this.listeners.get(channel)?.forEach((listener) => listener());
  }
  beginConnection() {
    this.epoch += 1;
    this.clearData();
    this.setStatus("connecting");
    return this.epoch;
  }
  markOpen(epoch: number) {
    if (epoch !== this.epoch) return false;
    this.setStatus("open");
    return true;
  }
  closeConnection(epoch: number) {
    if (epoch !== this.epoch) return false;
    this.clearData();
    this.setStatus("closed");
    return true;
  }
  setForEpoch(epoch: number, channel: string, payload: any) {
    if (epoch !== this.epoch || this.status !== "open") return false;
    this.data.set(channel, payload);
    this.lastMessageAt = Date.now();
    this.listeners.get(channel)?.forEach((l) => l());
    return true;
  }
  get(channel: string) {
    return this.data.get(channel);
  }
  subscribe(channel: string, cb: () => void) {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(cb);
    return () => set!.delete(cb);
  }
  setStatus(s: ConnStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }
  subscribeStatus(cb: () => void) {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }
}

const LiveContext = createContext<LiveStore | null>(null);

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<LiveStore | null>(null);
  if (!storeRef.current) storeRef.current = new LiveStore();
  const store = storeRef.current;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: any;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const epoch = store.beginConnection();
      let socket: WebSocket;
      try {
        socket = new WebSocket(`${proto}://${window.location.host}/ws`);
        ws = socket;
      } catch {
        store.closeConnection(epoch);
        schedule();
        return;
      }
      socket.onopen = () => {
        if (store.markOpen(epoch)) retry = 0;
      };
      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (Array.isArray(msg)) {
            for (const m of msg) if (m?.channel) store.setForEpoch(epoch, m.channel, m.payload);
          } else if (msg?.channel) {
            store.setForEpoch(epoch, msg.channel, msg.payload);
          }
        } catch {
          /* ignore malformed */
        }
      };
      socket.onclose = () => {
        if (store.closeConnection(epoch)) schedule();
      };
      socket.onerror = () => {
        try {
          socket.close();
        } catch {}
      };
    };

    const schedule = () => {
      if (closed) return;
      retry = Math.min(retry + 1, 6);
      const delay = Math.min(1000 * 2 ** retry, 15000);
      clearTimeout(timer);
      timer = setTimeout(connect, delay);
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
    };
  }, [store]);

  return <LiveContext.Provider value={store}>{children}</LiveContext.Provider>;
}

function useStore(): LiveStore {
  const s = useContext(LiveContext);
  if (!s) throw new Error("useLiveData must be used inside <LiveProvider>");
  return s;
}

/** Subscribe to one live channel. Returns the latest payload (or undefined). */
export function useLiveData<T = any>(channel: string): T | undefined {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(channel, cb),
    () => store.get(channel) as T | undefined,
    () => undefined
  );
}

/** The live WebSocket connection status (for the "live" badge). */
export function useConnStatus(): ConnStatus {
  const store = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribeStatus(cb),
    () => store.status,
    () => "connecting" as ConnStatus
  );
}
