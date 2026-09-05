import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getDb, kvGet } from "@/db";
import { accountScopes, SCOPE_SETS } from "@/lib/sources/google";
import type { ConnectionDef } from "@/lib/connections/registry";
type Account = { email: string; enabled: number; last_error: string; refresh_token_enc: string };
function account(stern: boolean) {
  return (getDb().prepare("SELECT email,enabled,last_error,refresh_token_enc FROM google_accounts ORDER BY enabled DESC,added_at DESC").all() as Account[]).find(a => stern ? /@stern\.nyu\.edu$/i.test(a.email) : /@nyu\.edu$/i.test(a.email));
}
let probe: { at: number; ok: boolean; detail: string } | undefined;
export function codexProbe() {
  if (process.env.STERN_LLM_MODE === "fixture" || process.env.STERN_LLM_MODE === "off") return { ok: false, detail: `LLM mode is ${process.env.STERN_LLM_MODE}` };
  if (probe && Date.now() - probe.at < 60000) return probe;
  const auth = fs.existsSync(path.join(os.homedir(), ".codex", "auth.json"));
  let ok = false;
  if (auth) try { execFileSync(process.env.STERN_CODEX_BIN || "codex", ["--version"], { timeout: 3000, stdio: "pipe" }); ok = true; } catch { /* unavailable */ }
  probe = { at: Date.now(), ok, detail: !auth ? "Codex subscription login missing" : ok ? "Codex CLI and subscription auth present" : "Codex CLI unavailable" };
  return probe;
}
export const sternConnections: ConnectionDef[] = [true, false].map((stern): ConnectionDef => ({
  id: stern ? "stern-google-stern" : "stern-google-nyu", label: stern ? "Stern Google · Stern" : "Stern Google · NYU",
  surfaces: ["dashboard"], reconnect: "oauth", defaultEnabled: false,
  configured: () => !!account(stern), note: "Gmail read and draft creation; Calendar read and event creation. Never sends email.",
  check: async () => {
    const a = account(stern);
    const error = kvGet<string>(`stern.google.${stern ? "stern" : "nyu"}_error`);
    if (error) return { ok: false, detail: error };
    if (!a) return { ok: false, detail: `Connect an @${stern ? "stern.nyu.edu" : "nyu.edu"} account` };
    if (!a.enabled) return { ok: false, detail: "Account is disabled" };
    if (!a.refresh_token_enc || a.last_error) return { ok: false, detail: "Google account needs re-auth" };
    const missing = SCOPE_SETS.stern.filter(scope => !["openid", "email", "profile"].includes(scope) && !accountScopes(a.email).includes(scope));
    const scan = getDb().prepare("SELECT last_error FROM stern_scan_state WHERE account=?").get(a.email.toLowerCase()) as { last_error: string } | undefined;
    if (!missing.length && scan?.last_error) return { ok: false, detail: `Last Stern email scan failed: ${scan.last_error}` };
    return missing.length ? { ok: false, detail: `Partial scopes: reconnect with Stern permissions (${missing.map(s => s.split("/").pop()).join(", ")})` } : { ok: true, detail: "Stern Gmail and Calendar permissions granted" };
  },
}));
sternConnections.push({ id: "stern-llm-codex", label: "Stern classifier · Codex", surfaces: ["dashboard"], reconnect: "device_code", defaultEnabled: false, configured: () => codexProbe().ok, check: async () => codexProbe(), note: "Cached CLI/version and subscription login probe; no LLM request" });
export async function sternConnectionSummary() {
  return Promise.all(sternConnections.map(async def => {
    const setting = getDb().prepare("SELECT enabled FROM connections WHERE service=? AND surface='dashboard'").get(def.id) as { enabled: number } | undefined;
    if (!(setting ? setting.enabled === 1 : def.defaultEnabled)) return { id: def.id, state: "off", detail: "Disabled by user" };
    const health = await def.check();
    return { id: def.id, state: health.ok ? "on_healthy" : "on_broken", detail: health.detail };
  }));
}
