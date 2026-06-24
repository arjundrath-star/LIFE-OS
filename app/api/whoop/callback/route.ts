import { NextResponse } from "next/server";
import { handleCallback, pollWhoop, healthSnapshot } from "@/lib/sources/whoop";
import { refreshAll, setEnabled } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";
import { pushEvent } from "@/db";

export const dynamic = "force-dynamic";

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.redirect(new URL("/signin", base));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = req.headers.get("cookie")?.match(/rw_whoop_state=([a-f0-9]+)/)?.[1];

  if (error) return NextResponse.redirect(new URL(`/connections?whoop_error=${encodeURIComponent(error)}`, base));
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/connections?whoop_error=state_mismatch", base));
  }

  try {
    const { name } = await handleCallback(code);
    pushEvent("whoop", `Connected WHOOP account (${name})`, "success");
    // authorizing IS the user enabling Whoop — flip it on so the panel shows healthy.
    setEnabled("whoop", "dashboard", true);
    const states = await refreshAll();
    getHub().broadcast("connections", states);
    // first pull so the Health panel fills immediately instead of waiting for the tick
    try {
      await pollWhoop();
      getHub().broadcast("health", healthSnapshot());
    } catch {}
    const res = NextResponse.redirect(new URL(`/connections?whoop_connected=${encodeURIComponent(name)}`, base));
    res.cookies.delete("rw_whoop_state");
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/connections?whoop_error=${encodeURIComponent(String(e?.message || e).slice(0, 140))}`, base));
  }
}
