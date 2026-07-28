// The connections registry — source of truth for which integrations exist, on which
// surfaces, how to reconnect, and how to health-check them. Real checks only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fetchHermesStatus } from "@/lib/sources/hermes";
import { readTelegramActivity } from "@/lib/sources/telegram";
import { hasSecret, secret } from "@/lib/secrets";
import { run } from "@/lib/shell";
import { all } from "@/db";

export type Surface = "dashboard" | "hermes" | "claude";
export type ReconnectMethod = "oauth" | "device_code" | "api_key" | "service" | "none";

export type HealthResult = { ok: boolean; detail: string };

export type ConnectionDef = {
  id: string;
  label: string;
  surfaces: Surface[];
  reconnect: ReconnectMethod;
  // user intent default when first seeded
  defaultEnabled: boolean;
  // a not-yet-configured integration shows an honest "connect me" (off), not broken
  configured: () => boolean;
  // cheap check that proves the credential / endpoint works
  check: () => Promise<HealthResult>;
  note?: string;
};

const HIGGS_CREDS = path.join(os.homedir(), ".config", "higgsfield", "credentials.json");

export const REGISTRY: ConnectionDef[] = [
  {
    id: "hermes",
    label: "Hermes",
    surfaces: ["dashboard", "hermes"],
    reconnect: "service",
    defaultEnabled: true,
    configured: () => true,
    note: "Personal agent OS gateway on the tailnet",
    check: async () => {
      const s = await fetchHermesStatus();
      return s.online
        ? { ok: true, detail: `gateway ${s.gatewayState} · v${s.version}` }
        : { ok: false, detail: s.error ? `unreachable: ${s.error}` : `gateway ${s.gatewayState ?? "down"}` };
    },
  },
  {
    id: "telegram",
    label: "Telegram",
    surfaces: ["dashboard", "hermes"],
    reconnect: "service",
    defaultEnabled: true,
    configured: () => true,
    note: "Phone-driven work through the Hermes gateway",
    check: async () => {
      const t = readTelegramActivity(await fetchHermesStatus());
      if (t.state === "active" || t.state === "idle") return { ok: true, detail: t.detail };
      return { ok: false, detail: t.detail };
    },
  },
  {
    id: "tailscale",
    label: "Tailscale",
    surfaces: ["dashboard", "hermes"],
    reconnect: "service",
    defaultEnabled: true,
    configured: () => true,
    note: "Tailnet for Hermes + internal services",
    check: async () => {
      const r = await run("tailscale", ["status", "--json"], 4000);
      if (!r.ok) return { ok: false, detail: "tailscale CLI error" };
      try {
        const j = JSON.parse(r.stdout);
        const state = j.BackendState;
        return state === "Running"
          ? { ok: true, detail: `connected · ${j.Self?.HostName ?? ""}`.trim() }
          : { ok: false, detail: `backend ${state}` };
      } catch {
        return { ok: false, detail: "unparseable status" };
      }
    },
  },
  {
    id: "cloudflare",
    label: "Cloudflare tunnel",
    surfaces: ["dashboard"],
    reconnect: "service",
    defaultEnabled: true,
    configured: () => true,
    note: "The pipe — rathworkspace.cloud ingress",
    check: async () => {
      const r = await run("systemctl", ["is-active", "cloudflared-rathworkspace.service"], 4000);
      const active = r.stdout.trim() === "active";
      return active
        ? { ok: true, detail: "tunnel active" }
        : { ok: false, detail: `service ${r.stdout.trim() || "inactive"}` };
    },
  },
  {
    id: "higgsfield",
    label: "Higgsfield CLI",
    surfaces: ["claude"],
    reconnect: "device_code",
    defaultEnabled: true,
    configured: () => fs.existsSync(HIGGS_CREDS),
    note: "Ad-engine video generation (device-login token)",
    check: async () => {
      if (!fs.existsSync(HIGGS_CREDS)) return { ok: false, detail: "not logged in" };
      try {
        const st = fs.statSync(HIGGS_CREDS);
        const ageDays = (Date.now() - st.mtimeMs) / 86400000;
        return { ok: true, detail: `token stored · ${ageDays.toFixed(0)}d old` };
      } catch {
        return { ok: false, detail: "credential unreadable" };
      }
    },
  },
  {
    id: "google",
    label: "Google accounts",
    surfaces: ["dashboard"],
    reconnect: "oauth",
    defaultEnabled: false,
    configured: () => hasSecret("GOOGLE_CLIENT_ID"),
    note: "Gmail + Calendar read (per-account, + Add from Email panel)",
    check: async () => {
      // health = at least one connected account with no error
      try {
        const rows = all<{ email: string; last_error: string | null; enabled: number }>(
          "SELECT email, last_error, enabled FROM google_accounts"
        );
        const active = rows.filter((r) => r.enabled);
        if (active.length === 0) return { ok: false, detail: "no accounts connected" };
        const broken = active.filter((r) => r.last_error);
        if (broken.length) return { ok: false, detail: `${broken.length}/${active.length} accounts need re-auth` };
        return { ok: true, detail: `${active.length} account${active.length > 1 ? "s" : ""} connected` };
      } catch {
        return { ok: false, detail: "no accounts connected" };
      }
    },
  },
  {
    id: "whoop",
    label: "Whoop",
    surfaces: ["dashboard"],
    reconnect: "oauth",
    defaultEnabled: false,
    configured: () => hasSecret("WHOOP_CLIENT_ID") && hasSecret("WHOOP_CLIENT_SECRET"),
    note: "Recovery / sleep / strain (v2). Needs developer app + OAuth.",
    check: async () => {
      const mod = await import("@/lib/sources/whoop");
      return mod.healthCheck();
    },
  },
  {
    id: "discord",
    label: "Discord deals bot",
    surfaces: ["dashboard"],
    reconnect: "api_key",
    defaultEnabled: false,
    configured: () => hasSecret("DISCORD_BOT_TOKEN") && hasSecret("DISCORD_WATCH_CHANNEL_IDS"),
    note: "Official guild bot · watched channels only",
    check: async () => {
      const token = secret("DISCORD_BOT_TOKEN");
      const channels = secret("DISCORD_WATCH_CHANNEL_IDS");
      if (!token || !channels) return { ok: false, detail: "bot token and watched channel IDs required" };
      try { const {validateDiscordBot}=await import("@/lib/connections/discord"); const result=await validateDiscordBot(token,channels.split(",").filter(Boolean)); return {ok:true,detail:`official bot verified · ${result.botName} · ${result.channelCount} watched channel(s)`}; }
      catch(e) { return {ok:false,detail:e instanceof Error?e.message:"Discord validation failed"}; }
    },
  },
  {
    id: "mercury",
    label: "Mercury",
    surfaces: ["dashboard"],
    reconnect: "api_key",
    defaultEnabled: false,
    configured: () => hasSecret("MERCURY_API_TOKEN"),
    note: "Vending revenue. Add a read API token when revenue starts.",
    check: async () => {
      if (!hasSecret("MERCURY_API_TOKEN")) return { ok: false, detail: "no API token yet" };
      return { ok: true, detail: "token present" };
    },
  },
  {
    id: "pocket",
    label: "Pocket capture",
    surfaces: ["dashboard"],
    reconnect: "api_key",
    defaultEnabled: false,
    configured: () => hasSecret("POCKET_API_TOKEN"),
    note: "Wearable audio capture into CRM touchpoints. Inert until a token is added.",
    check: async () => {
      const mod = await import("@/server/ingest/pocket");
      return mod.health();
    },
  },
  {
    id: "granola",
    label: "Granola notes",
    surfaces: ["dashboard"],
    reconnect: "api_key",
    defaultEnabled: false,
    configured: () => hasSecret("GRANOLA_API_TOKEN"),
    note: "Meeting notes into CRM touchpoints. Inert until a token is added.",
    check: async () => {
      const mod = await import("@/server/ingest/granola");
      return mod.health();
    },
  },
];

export function getDef(id: string): ConnectionDef | undefined {
  return REGISTRY.find((c) => c.id === id);
}
