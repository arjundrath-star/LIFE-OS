import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { connectUrl, configured } from "@/lib/sources/whoop";
import { requireHealthUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

const base = process.env.NEXTAUTH_URL || "http://localhost:3000";

// Starts the WHOOP OAuth authorization-code flow. Requires the developer-app
// credentials to be present first (entered via /api/whoop/credentials).
export async function GET() {
  if (!(await requireHealthUser())) return NextResponse.redirect(new URL("/signin", base));
  if (!configured()) return NextResponse.redirect(new URL("/connections?whoop_error=not_configured", base));
  const state = crypto.randomBytes(16).toString("hex"); // 32 chars (>= WHOOP's 8 min)
  const res = NextResponse.redirect(connectUrl(state));
  res.cookies.set("rw_whoop_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
