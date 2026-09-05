import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { connectUrl } from "@/lib/sources/google";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Starts the "+ Add Google account" reader flow. Same Google client as the gate,
// but a separate flow requesting gmail.readonly + calendar.readonly + offline.
const TARGETS: Record<string,{ loginHint?:string; hostedDomain?:string }> = {
  generic:{}, stern:{ hostedDomain:"stern.nyu.edu" }, klade:{ loginHint:"arjun@kladeai.com" }, personal:{ loginHint:"arjundrath@gmail.com" }, nyu:{ hostedDomain:"nyu.edu" },
};

export async function GET(req: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.redirect(new URL("/signin", process.env.NEXTAUTH_URL || "http://localhost:3000"));
  const requested = new URL(req.url).searchParams.get("target") || "generic";
  const target = Object.hasOwn(TARGETS, requested) ? requested : "generic";
  const state = crypto.randomBytes(16).toString("hex");
  const set = new URL(req.url).searchParams.get("set");
  const scopeSet = set === "stern" ? "stern" : "readonly";
  const hint = new URL(req.url).searchParams.get("login_hint") || "";
  const loginHint = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hint) && hint.length <= 254 ? hint : TARGETS[target].loginHint;
  const url = connectUrl(state, { ...TARGETS[target], loginHint, scopeSet });
  const res = NextResponse.redirect(url);
  res.cookies.set("rw_g_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXTAUTH_URL || "").startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  res.cookies.set("rw_g_target", target, { httpOnly:true, sameSite:"lax", secure:(process.env.NEXTAUTH_URL || "").startsWith("https://"), maxAge:600, path:"/" });
  res.cookies.set("rw_g_scope_set", scopeSet, { httpOnly:true, sameSite:"lax", secure:(process.env.NEXTAUTH_URL || "").startsWith("https://"), maxAge:600, path:"/" });
  return res;
}
