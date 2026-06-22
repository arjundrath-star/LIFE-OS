import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { connectUrl } from "@/lib/sources/google";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Starts the "+ Add Google account" reader flow. Same Google client as the gate,
// but a separate flow requesting gmail.readonly + calendar.readonly + offline.
export async function GET() {
  if (!(await requireUser())) return NextResponse.redirect(new URL("/signin", process.env.NEXTAUTH_URL || "http://localhost:3000"));
  const state = crypto.randomBytes(16).toString("hex");
  const url = connectUrl(state);
  const res = NextResponse.redirect(url);
  res.cookies.set("rw_g_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.NEXTAUTH_URL || "").startsWith("https://"),
    maxAge: 600,
    path: "/",
  });
  return res;
}
