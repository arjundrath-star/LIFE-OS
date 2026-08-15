import { NextResponse } from "next/server";
import { handleCallback, pollWhoop } from "@/lib/sources/whoop";
import { dashboardHealthSnapshot } from "@/lib/health";
import { refreshAll, setEnabled } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireHealthUser } from "@/lib/guard";
import { pushEvent } from "@/db";

export const dynamic = "force-dynamic";

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

export async function GET(req: Request) {
  if (!(await requireHealthUser())) return NextResponse.redirect(new URL("/signin", base));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = req.headers.get("cookie")?.match(/rw_whoop_state=([a-f0-9]+)/)?.[1];

  if (error) return NextResponse.redirect(new URL("/connections?whoop_error=oauth_denied", base));
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/connections?whoop_error=state_mismatch", base));
  }

  try {
    await handleCallback(code);
    pushEvent("whoop", "WHOOP account connected", "success");
    // authorizing IS the user enabling Whoop — flip it on so the panel shows healthy.
    setEnabled("whoop", "dashboard", true);
    const states = await refreshAll();
    getHub().broadcast("connections", states);
    // first pull so the Health panel fills immediately instead of waiting for the tick
    try {
      await pollWhoop();
      getHub().broadcast("health", dashboardHealthSnapshot());
    } catch {}
    const res = NextResponse.redirect(new URL("/connections?whoop_connected=1", base));
    res.cookies.delete("rw_whoop_state");
    return res;
  } catch {
    return NextResponse.redirect(new URL("/connections?whoop_error=oauth_callback_failed", base));
  }
}
