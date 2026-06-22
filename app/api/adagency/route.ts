import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "@/lib/shell";
import { requireUser } from "@/lib/guard";
import { kvGet, kvSet } from "@/db";

export const dynamic = "force-dynamic";

// Klade Ad Agency live data. Shells the official Higgsfield CLI (the verification
// commands — account status + generate list — cost nothing) and caches the result
// in KV so we never shell out on every page load. Honest "connect me" if not logged in.
const HIGGS_CREDS = path.join(os.homedir(), ".config", "higgsfield", "credentials.json");
const CACHE_KEY = "adagency_cache";
const TTL_MS = 5 * 60 * 1000;

type Video = {
  id: string;
  title: string;
  url: string;
  poster: string | null;
  prompt: string;
  aspect: string;
  duration: number | null;
  createdAt: number | null;
};

async function higgs(args: string[]): Promise<any | null> {
  const r = await run("higgsfield", ["--json", "--no-color", ...args], 25000);
  if (!r.ok) return null;
  try {
    // tolerate any leading banner noise before the JSON body
    const s = r.stdout;
    const start = Math.min(
      ...[s.indexOf("{"), s.indexOf("[")].filter((i) => i >= 0).concat([s.length])
    );
    return JSON.parse(s.slice(start));
  } catch {
    return null;
  }
}

async function build() {
  if (!fs.existsSync(HIGGS_CREDS)) {
    return { connected: false, reason: "Higgsfield CLI not logged in on the VPS", account: null, videos: [] as Video[] };
  }
  const account = await higgs(["account", "status"]);
  const list = await higgs(["generate", "list", "--video", "--size", "8"]);
  const videos: Video[] = Array.isArray(list)
    ? list
        .filter((j: any) => j?.status === "completed" && j?.result_url)
        .map((j: any) => {
          const start = (j.params?.medias ?? []).find((m: any) => m?.role === "start_image");
          return {
            id: j.id,
            title: j.display_name || j.job_set_type || "Generation",
            url: j.result_url,
            poster: start?.data?.url ?? null,
            prompt: j.params?.prompt ?? "",
            aspect: j.params?.aspect_ratio ?? "16:9",
            duration: j.params?.duration ?? null,
            createdAt: typeof j.created_at === "number" ? Math.round(j.created_at * 1000) : null,
          };
        })
    : [];
  return {
    connected: !!account,
    reason: account ? null : "Higgsfield CLI returned no account (token may be expired — re-auth on the VPS)",
    account: account
      ? { email: account.email, credits: account.credits, plan: account.subscription_plan_type }
      : null,
    videos,
  };
}

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const cached = kvGet<{ at: number; data: any }>(CACHE_KEY);
  if (!force && cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ ...cached.data, cachedAt: cached.at });
  }
  const data = await build();
  kvSet(CACHE_KEY, { at: Date.now(), data });
  return NextResponse.json({ ...data, cachedAt: Date.now() });
}
