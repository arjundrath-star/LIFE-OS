import { NextResponse } from "next/server";
import { handleCallback } from "@/lib/sources/google";
import { refreshAll, setEnabled } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";
import { pushEvent, kvSet } from "@/db";

export const dynamic = "force-dynamic";

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.redirect(new URL("/signin", base));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const cookieState = req.headers.get("cookie")?.match(/rw_g_state=([a-f0-9]+)/)?.[1];
  const target = req.headers.get("cookie")?.match(/rw_g_target=(generic|klade|personal|nyu)/)?.[1] || "generic";

  if (error) {
    if (target !== "generic") kvSet(`career.google.${target}_error`, target === "nyu" && error === "access_denied" ? "connect blocked — needs NYU tenant approval" : error);
    return NextResponse.redirect(new URL(`/connections?email_error=${encodeURIComponent(error)}`, base));
  }
  if (!code || !state || state !== cookieState) {
    return NextResponse.redirect(new URL("/?email_error=state_mismatch", base));
  }

  try {
    const { email } = await handleCallback(code);
    if (target !== "generic") kvSet(`career.google.${target}_error`, "");
    pushEvent("email", `Connected Google account ${email}`, "success");
    // connecting an account IS the user enabling the Google reader — flip it on so the
    // Connections panel shows healthy (not a misleading "off") now that mail is flowing.
    setEnabled("google", "dashboard", true);
    const careerService = target === "generic" ? null : `career-google-${target}`;
    if (careerService) setEnabled(careerService, "dashboard", true);
    // refresh connection states + email immediately
    const states = await refreshAll();
    getHub().broadcast("connections", states);
    try {
      const mod = await import("@/lib/sources/google");
      await mod.pollEmailAccounts();
      getHub().broadcast("email", mod.emailSnapshots());
    } catch {}
    const res = NextResponse.redirect(new URL(`/connections?email_connected=${encodeURIComponent(email)}`, base));
    res.cookies.delete("rw_g_state");
    res.cookies.delete("rw_g_target");
    return res;
  } catch (e: any) {
    return NextResponse.redirect(new URL(`/?email_error=${encodeURIComponent(String(e?.message || e).slice(0, 120))}`, base));
  }
}
