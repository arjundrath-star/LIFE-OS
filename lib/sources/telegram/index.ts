// Telegram listener adapter. Taps the long-poll daemon's log (no Telegram API call).
// Log line format: "[YYYY-MM-DD HH:MM:SS UTC] <message>".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LOG_PATH =
  process.env.TELEGRAM_LISTENER_LOG ||
  path.join(os.homedir(), ".openclaw", "workspace", "logs", "telegram-listener.log");

export type TelegramActivity = {
  reachable: boolean;
  healthy: boolean; // listener producing real events, not just poll errors
  state: "active" | "conflict" | "idle" | "down";
  detail: string;
  lastEventAt: string | null;
  lastEvent: string | null;
  events: { ts: string; message: string }[];
  errorRate: number; // fraction of recent lines that are getUpdates errors
  checkedAt: string;
};

function parseLine(line: string): { ts: string | null; message: string } {
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\]\s*(.*)$/);
  if (!m) return { ts: null, message: line };
  return { ts: m[1].replace(" ", "T") + "Z", message: m[2] };
}

function readTail(file: string, maxBytes: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function readTelegramActivity(): TelegramActivity {
  const checkedAt = new Date().toISOString();
  if (!fs.existsSync(LOG_PATH)) {
    return {
      reachable: false,
      healthy: false,
      state: "down",
      detail: "listener log not found",
      lastEventAt: null,
      lastEvent: null,
      events: [],
      errorRate: 0,
      checkedAt,
    };
  }

  const text = readTail(LOG_PATH, 64 * 1024);
  const lines = text.split("\n").filter(Boolean).slice(-400);
  const parsed = lines.map(parseLine);

  const isPollError = (msg: string) =>
    /getUpdates error|Conflict: terminated|409/.test(msg);

  const recent = parsed.slice(-120);
  const errors = recent.filter((p) => isPollError(p.message)).length;
  const errorRate = recent.length ? errors / recent.length : 0;

  // Real, human-meaningful events (saved tasks, commands, sprint, replies).
  const meaningful = parsed
    .filter(
      (p) =>
        p.ts &&
        !isPollError(p.message) &&
        /saved|task|sprint|status|reply|claude|message|received|routed|processed|/i.test(
          p.message
        ) &&
        p.message.length > 0
    )
    .slice(-8)
    .map((p) => ({ ts: p.ts as string, message: p.message }));

  const lastRealLine = [...parsed].reverse().find((p) => p.ts);
  const lastEventAt = lastRealLine?.ts ?? null;

  // Freshness: when did the daemon last write *anything*?
  const ageMs = lastEventAt ? Date.now() - new Date(lastEventAt).getTime() : Infinity;
  const stale = ageMs > 5 * 60 * 1000;

  let state: TelegramActivity["state"];
  let detail: string;
  if (stale) {
    state = "down";
    detail = "no log writes in 5+ min";
  } else if (errorRate > 0.6) {
    state = "conflict";
    detail = "getUpdates 409 — two pollers running (bash listener + bun plugin)";
  } else if (meaningful.length > 0) {
    state = "active";
    detail = "processing messages";
  } else {
    state = "idle";
    detail = "polling, no recent messages";
  }

  return {
    reachable: true,
    healthy: state === "active" || state === "idle",
    state,
    detail,
    lastEventAt,
    lastEvent: lastRealLine?.message ?? null,
    events: meaningful.reverse(),
    errorRate,
    checkedAt,
  };
}
