// SQLite data layer (better-sqlite3). Server-only. Single-user, synchronous reads.
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("db/index.ts is server-only");
}

const DB_PATH =
  process.env.RATHWORKSPACE_DB || path.join(process.cwd(), "data", "rathworkspace.db");
const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

let _db: Database.Database | null = null;

function open(): Database.Database {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

function migrate(db: Database.Database) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     );`
  );
  const applied = new Set(
    db.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name)
  );
  const files = fs.existsSync(MIGRATIONS_DIR)
    ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
    : [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    });
    tx();
    console.log(`[db] applied migration ${file}`);
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = open();
  migrate(_db);
  return _db;
}

// ---- small typed helpers ----
export function all<T = any>(sql: string, ...params: any[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}
export function get<T = any>(sql: string, ...params: any[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: any[]) {
  return getDb().prepare(sql).run(...params);
}
export function nowIso(): string {
  return new Date().toISOString();
}

// ---- KV convenience ----
export function kvGet<T = any>(key: string): T | undefined {
  const row = get<{ v: string }>("SELECT v FROM kv WHERE k = ?", key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.v) as T;
  } catch {
    return row.v as unknown as T;
  }
}
export function kvSet(key: string, value: unknown) {
  run(
    `INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso()
  );
}

// ---- event ticker + activity helpers ----
export function pushEvent(source: string, message: string, level: "info" | "success" | "warn" | "error" = "info") {
  run("INSERT INTO events (source, level, message) VALUES (?, ?, ?)", source, level, message);
}
export function recentEvents(limit = 40) {
  return all(
    "SELECT id, ts, source, level, message FROM events ORDER BY id DESC LIMIT ?",
    limit
  );
}

// CLI: `tsx db/index.ts --migrate-only`
if (process.argv.includes("--migrate-only")) {
  getDb();
  console.log("[db] migrations up to date at", DB_PATH);
  process.exit(0);
}
