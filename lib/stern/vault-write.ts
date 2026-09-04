// Obsidian dual-write helper for the Stern tab. Writes ONLY under <vault>/Stern/, creates
// folders, never deletes. Server-only. Off by default in tests (opt in with STERN_VAULT_WRITE=1)
// and a no-op when the vault root is missing or STERN_VAULT_WRITE is "0", so a missing
// vault can never break a write path in the app.
import fs from "node:fs";
import path from "node:path";
import { vaultRoot } from "@/lib/sources/vault";
import { SternError } from "@/lib/stern/errors";

export type FrontmatterValue = string | number | boolean | null;
export type UpsertResult = { written: true; path: string } | { written: false; reason: string };

/** Read env live on every call (never a frozen snapshot) so tests and runtime overrides both work. */
export function vaultSternRoot(): string {
  const root = process.env.COMMAND_CENTER_VAULT || vaultRoot();
  return path.join(root, "Stern");
}

function writesEnabled(): { ok: true } | { ok: false; reason: string } {
  const flag = process.env.STERN_VAULT_WRITE;
  if (flag === "0") return { ok: false, reason: "STERN_VAULT_WRITE=0" };
  const inTests = !!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === "test";
  if (inTests && flag !== "1") return { ok: false, reason: "disabled in tests" };
  return { ok: true };
}

function yamlValue(value: FrontmatterValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (s === "" || /[:#\[\]{}&*!|>'"%@`,]/.test(s) || /^[\s\-?]/.test(s) || /\s$/.test(s) || /[\r\n]/.test(s)) {
    return JSON.stringify(s.replace(/[\r\n]+/g, " "));
  }
  return s;
}

/** Resolve a vault-relative path and refuse anything that escapes <vault>/Stern/. */
export function resolveSternPath(relPath: string): { root: string; full: string } {
  if (typeof relPath !== "string" || !relPath.trim()) throw new SternError(400, "vault path is required");
  const normalized = relPath.replace(/\\/g, "/");
  if (path.isAbsolute(normalized) || normalized.startsWith("/")) throw new SternError(400, "vault path must be relative");
  if (normalized.split("/").some((seg) => seg === "..")) throw new SternError(400, "vault path may not contain ..");
  if (!normalized.toLowerCase().endsWith(".md")) throw new SternError(400, "vault path must end in .md");
  const root = path.resolve(vaultSternRoot());
  const full = path.resolve(root, normalized);
  if (full !== root && !full.startsWith(root + path.sep)) throw new SternError(400, "vault path escapes Stern/");
  if (full === root) throw new SternError(400, "vault path must name a file");
  return { root, full };
}

export function renderNote(frontmatter: Record<string, FrontmatterValue>, body: string): string {
  const lines = Object.entries(frontmatter || {}).map(([key, value]) => `${key.replace(/[^A-Za-z0-9_-]/g, "_")}: ${yamlValue(value)}`);
  const fm = lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "";
  const text = String(body ?? "").replace(/\r\n/g, "\n");
  return `${fm}${text}${text.endsWith("\n") ? "" : "\n"}`;
}

/**
 * Create or overwrite one note under <vault>/Stern/<relPath>. Idempotent: the same call twice
 * yields the same file. Returns { written:false, reason } instead of throwing when the vault is
 * absent or writes are disabled; throws SternError 400 only for unsafe paths.
 */
export function upsertNote(relPath: string, frontmatter: Record<string, FrontmatterValue>, body: string): UpsertResult {
  const { root, full } = resolveSternPath(relPath);
  const enabled = writesEnabled();
  if (!enabled.ok) return { written: false, reason: enabled.reason };
  const vault = path.resolve(process.env.COMMAND_CENTER_VAULT || vaultRoot());
  let vaultExists = false;
  try {
    vaultExists = fs.statSync(vault).isDirectory();
  } catch {
    vaultExists = false;
  }
  if (!vaultExists) return { written: false, reason: `vault root missing: ${vault}` };
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  const content = renderNote(frontmatter, body);
  const tmp = `${full}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, full);
  return { written: true, path: full };
}

/** Read a note under Stern/ (tests and future UI previews). Returns null when missing. */
export function readNote(relPath: string): string | null {
  const { full } = resolveSternPath(relPath);
  try {
    return fs.readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

/** Filesystem-safe slug for note names: "Priya Nair" -> "priya-nair". */
export function noteSlug(text: string): string {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}
