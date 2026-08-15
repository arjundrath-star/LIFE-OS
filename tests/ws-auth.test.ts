import test from "node:test";
import assert from "node:assert/strict";
import {
  appAllowlist,
  authorizeWebSocketCookie,
  guardAppWebSocketSession,
  guardPrivilegedProxySocket,
  healthAllowlist,
} from "@/lib/ws-auth";
import { createLiveHub } from "@/server/live";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 1;
const reader = (token: any) => async () => token;
const fourUsers = "owner@example.com, one@example.com, two@example.com, THREE@example.com";

test("WebSocket auth accepts every configured app user while Health remains an explicit subset", async () => {
  const allowed = appAllowlist(fourUsers);
  assert.deepEqual(allowed, ["owner@example.com", "one@example.com", "two@example.com", "three@example.com"]);
  assert.deepEqual(healthAllowlist("OWNER@example.com, outsider@example.com", allowed), ["owner@example.com"]);
  assert.deepEqual(healthAllowlist("", allowed), []);

  const owner = await authorizeWebSocketCookie("session=fixture", {
    readToken: reader({ email: "owner@example.com", exp: future }) as any,
    allowed,
  });
  const ordinary = await authorizeWebSocketCookie("session=fixture", {
    readToken: reader({ email: "three@example.com", exp: future }) as any,
    allowed,
  });
  assert.equal(owner?.email, "owner@example.com");
  assert.equal(ordinary?.email, "three@example.com");
  assert.equal(await authorizeWebSocketCookie("session=fixture", {
    readToken: reader({ email: "outsider@example.com", exp: future }) as any,
    allowed,
  }), null);
  assert.equal(await authorizeWebSocketCookie(undefined, {
    readToken: reader({ email: "owner@example.com", exp: future }) as any,
    allowed,
  }), null);
});

test("WebSocket auth binds a future session expiry and fails closed for expired, missing-expiry, or disallowed tokens", async () => {
  const valid = await authorizeWebSocketCookie("session=fixture", {
    readToken: reader({ email: "OWNER@example.com", exp: future }) as any,
    allowed: ["owner@example.com"],
  });
  assert.deepEqual(valid, { email: "owner@example.com", expiresAtMs: future * 1000 });
  assert.equal(await authorizeWebSocketCookie("session=fixture", { readToken: reader({ email: "owner@example.com", exp: past }) as any, allowed: ["owner@example.com"] }), null);
  assert.equal(await authorizeWebSocketCookie("session=fixture", { readToken: reader({ email: "owner@example.com" }) as any, allowed: ["owner@example.com"] }), null);
  assert.equal(await authorizeWebSocketCookie("session=fixture", { readToken: reader({ email: "other@example.com", exp: future }) as any, allowed: ["owner@example.com"] }), null);
  assert.equal(await authorizeWebSocketCookie(undefined, { readToken: reader({ email: "owner@example.com", exp: future }) as any, allowed: ["owner@example.com"] }), null);
});

class FakeSocket {
  destroyed = 0;
  listeners = new Map<string, Set<() => void>>();
  destroy() { this.destroyed += 1; }
  on(event: "close" | "error", listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  emit(event: "close" | "error") {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
}

class FakeWebSocket {
  readyState = 1;
  sent: string[] = [];
  closed: Array<{ code?: number; reason?: string }> = [];
  listeners = new Map<string, Set<() => void>>();
  send(message: string) { this.sent.push(message); }
  close(code?: number, reason?: string) { this.closed.push({ code, reason }); }
  on(event: "close" | "error", listener: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
}

function channels(messages: string[]): string[] {
  return messages.flatMap((message) => {
    const parsed = JSON.parse(message);
    return Array.isArray(parsed) ? parsed.map((entry) => entry.channel) : [parsed.channel];
  });
}

function payloads(messages: string[], channel: string): any[] {
  return messages.flatMap((message) => {
    const parsed = JSON.parse(message);
    const entries = Array.isArray(parsed) ? parsed : [parsed];
    return entries.filter((entry) => entry.channel === channel).map((entry) => entry.payload);
  });
}

test("Health snapshots and broadcasts reach only the Health owner; ordinary and unauthenticated users receive no Health payload", () => {
  let now = 1_000;
  const general = new Set(["owner@example.com", "ordinary@example.com"]);
  const health = new Set(["owner@example.com"]);
  const hub = createLiveHub({
    now: () => now,
    isAppAllowed: (email) => general.has(email),
    isHealthAllowed: (email) => health.has(email),
  });

  hub.broadcast("pulse", { status: "ok" });
  hub.broadcast("health", { private: "fixture-only" });

  const owner = new FakeWebSocket();
  const ordinary = new FakeWebSocket();
  const unauthenticated = new FakeWebSocket();
  assert.equal(hub.addClient(owner as any, { email: "owner@example.com", expiresAtMs: 10_000 }), true);
  assert.equal(hub.addClient(ordinary as any, { email: "ordinary@example.com", expiresAtMs: 10_000 }), true);
  assert.equal(hub.addClient(unauthenticated as any, null), false);
  assert.deepEqual(channels(owner.sent), ["pulse", "health"]);
  assert.deepEqual(channels(ordinary.sent), ["pulse"]);
  assert.deepEqual(unauthenticated.sent, []);

  owner.sent = [];
  ordinary.sent = [];
  hub.broadcast("health", { private: "later-fixture" });
  hub.broadcast("pulse", { status: "later" });
  assert.deepEqual(channels(owner.sent), ["health", "pulse"]);
  assert.deepEqual(channels(ordinary.sent), ["pulse"]);

  health.clear();
  hub.broadcast("health", { private: "must-not-leak-after-removal" });
  assert.deepEqual(channels(owner.sent), ["health", "pulse"]);

  general.delete("ordinary@example.com");
  hub.broadcast("pulse", { status: "after-removal" });
  assert.deepEqual(channels(ordinary.sent), ["pulse"]);

  now = 10_000;
  hub.broadcast("pulse", { status: "after-expiry" });
  assert.deepEqual(channels(owner.sent), ["health", "pulse", "pulse"]);
});

test("connection snapshots and later broadcasts remove WHOOP and Hevy metadata only for ordinary users", () => {
  const hub = createLiveHub({
    now: () => 1_000,
    isAppAllowed: () => true,
    isHealthAllowed: (email) => email === "owner@example.com",
  });
  const connectionStates = [
    { service: "telegram", state: "on_healthy", detail: "listener active" },
    { service: "whoop", state: "on_healthy", detail: "PRIVATE-WHOOP-DETAIL" },
    { service: "hevy", state: "on_broken", detail: "PRIVATE-HEVY-DETAIL" },
    { service: "mercury", state: "off", detail: "no API token yet" },
  ];
  hub.broadcast("connections", connectionStates);

  const owner = new FakeWebSocket();
  const ordinary = new FakeWebSocket();
  hub.addClient(owner as any, { email: "owner@example.com", expiresAtMs: 10_000 });
  hub.addClient(ordinary as any, { email: "ordinary@example.com", expiresAtMs: 10_000 });
  assert.deepEqual(payloads(owner.sent, "connections")[0], connectionStates);
  assert.deepEqual(payloads(ordinary.sent, "connections")[0], [connectionStates[0], connectionStates[3]]);
  assert.doesNotMatch(ordinary.sent.join("\n"), /WHOOP|HEVY|whoop|hevy/);

  owner.sent = [];
  ordinary.sent = [];
  const later = connectionStates.map((row) => ({ ...row, state: row.service === "telegram" ? "on_broken" : row.state }));
  hub.broadcast("connections", later);
  assert.deepEqual(payloads(owner.sent, "connections")[0], later);
  assert.deepEqual(payloads(ordinary.sent, "connections")[0], [later[0], later[3]]);
  assert.doesNotMatch(ordinary.sent.join("\n"), /PRIVATE-WHOOP-DETAIL|PRIVATE-HEVY-DETAIL|whoop|hevy/i);
});

test("privileged proxy socket expires fail-closed with timer delays capped below Node's maximum", () => {
  const socket = new FakeSocket();
  let now = 0;
  const timeouts: { callback: () => void; delay: number }[] = [];
  const clearedIntervals: number[] = [];
  guardPrivilegedProxySocket(socket, "session=fixture", { email: "owner@example.com", expiresAtMs: 5_000 }, {
    now: () => now,
    maxTimerMs: 1_000,
    setTimeoutFn: ((callback: () => void, delay: number) => { timeouts.push({ callback, delay }); return timeouts.length as any; }) as any,
    clearTimeoutFn: (() => {}) as any,
    setIntervalFn: (() => 99 as any) as any,
    clearIntervalFn: ((handle: any) => { clearedIntervals.push(Number(handle)); }) as any,
  });
  assert.equal(timeouts[0].delay, 1_000);
  now = 5_000;
  timeouts[0].callback();
  assert.equal(socket.destroyed, 1);
  assert.deepEqual(clearedIntervals, [99]);
});

test("privileged proxy socket destroys on general allowlist/session revalidation failure and clears timers", async () => {
  const socket = new FakeSocket();
  const clearedTimeouts: any[] = [];
  const clearedIntervals: any[] = [];
  const guard = guardPrivilegedProxySocket(socket, "session=fixture", { email: "owner@example.com", expiresAtMs: 10_000 }, {
    now: () => 0,
    authorize: async () => null,
    setTimeoutFn: (() => 11 as any) as any,
    clearTimeoutFn: ((handle: any) => { clearedTimeouts.push(handle); }) as any,
    setIntervalFn: (() => 22 as any) as any,
    clearIntervalFn: ((handle: any) => { clearedIntervals.push(handle); }) as any,
  });
  await guard.revalidateNow();
  assert.equal(socket.destroyed, 1);
  assert.deepEqual(clearedTimeouts, [11]);
  assert.deepEqual(clearedIntervals, [22]);
});

test("app WebSocket closes when general access is removed during revalidation", async () => {
  const socket = new FakeWebSocket();
  const guard = guardAppWebSocketSession(socket as any, "session=fixture", {
    email: "ordinary@example.com",
    expiresAtMs: 10_000,
  }, {
    now: () => 0,
    authorize: async () => null,
    setTimeoutFn: (() => 11 as any) as any,
    clearTimeoutFn: (() => {}) as any,
    setIntervalFn: (() => 22 as any) as any,
    clearIntervalFn: (() => {}) as any,
  });
  await guard.revalidateNow();
  assert.deepEqual(socket.closed, [{ code: 4001, reason: "session expired" }]);
});
