// Server-only secret loader. Reads ~/.config/rathworkspace/secrets.env once.
// NEVER import this into a client component. NEVER log a value. NEVER send to the client.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (typeof window !== "undefined") {
  throw new Error("lib/secrets.ts is server-only and must never reach the client bundle");
}

const SECRETS_PATH =
  process.env.RATHWORKSPACE_SECRETS_PATH ||
  path.join(os.homedir(), ".config", "rathworkspace", "secrets.env");

function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

let cache: Record<string, string> | null = null;

export function loadSecrets(): Record<string, string> {
  if (cache) return cache;
  let fileVals: Record<string, string> = {};
  try {
    fileVals = parseEnvFile(fs.readFileSync(SECRETS_PATH, "utf8"));
  } catch (err) {
    console.warn(`[secrets] could not read ${SECRETS_PATH}:`, (err as Error).message);
  }
  // process.env wins over the file so systemd/CLI overrides work (e.g. local dev NEXTAUTH_URL).
  cache = { ...fileVals, ...process.env } as Record<string, string>;
  return cache;
}

/**
 * Hydrate process.env from the secret file for any key not already set.
 * Called once at server startup so Next middleware (which can't read the file)
 * can still see NEXTAUTH_SECRET etc. via process.env.
 */
export function applySecretsToEnv(): void {
  let fileVals: Record<string, string> = {};
  try {
    fileVals = parseEnvFile(fs.readFileSync(SECRETS_PATH, "utf8"));
  } catch {
    return;
  }
  for (const [k, v] of Object.entries(fileVals)) {
    if (process.env[k] === undefined && v) process.env[k] = v;
  }
  cache = null; // force re-merge on next read
}

export function secret(key: string): string | undefined {
  const v = loadSecrets()[key];
  return v && v.length > 0 ? v : undefined;
}

export function requireSecret(key: string): string {
  const v = secret(key);
  if (!v) throw new Error(`[secrets] missing required secret: ${key}`);
  return v;
}

/** True when a credential is present and non-empty (used by health checks / honest UI). */
export function hasSecret(key: string): boolean {
  return !!secret(key);
}

/**
 * Write/replace a key in the secret store (used by API-key paste / OAuth token save).
 * Server-only. Keeps the file chmod 600. Never logs the value.
 */
export function setSecret(key: string, value: string): void {
  // Reject control characters / newlines so a malformed paste can't inject another
  // KEY=VALUE line into the store.
  if (/[\r\n\x00]/.test(value)) {
    throw new Error("secret value contains control characters");
  }
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(SECRETS_PATH, "utf8").split("\n");
  } catch {
    lines = [];
  }
  let found = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || !trimmed.includes("=")) return line;
    const k = trimmed.slice(0, trimmed.indexOf("=")).trim();
    if (k === key) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) out.push(`${key}=${value}`);
  fs.mkdirSync(path.dirname(SECRETS_PATH), { recursive: true });
  fs.writeFileSync(SECRETS_PATH, out.join("\n"), { mode: 0o600 });
  fs.chmodSync(SECRETS_PATH, 0o600);
  process.env[key] = value;
  cache = null;
}

/** Allowlist of emails permitted past the Google gate. */
export function allowedEmails(): string[] {
  return (secret("GOOGLE_ALLOWED_EMAILS") || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
