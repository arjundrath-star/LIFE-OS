import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { updateRecommendationStatus } from "@/lib/pokemon-ops/db";

export const dynamic = "force-dynamic";

const ACTION_TO_STATUS: Record<string, "acked" | "dismissed"> = {
  ack: "acked",
  dismiss: "dismissed",
};

/** Dashboard Ack/Dismiss buttons. POST {id, action: "ack"|"dismiss"}. */
export async function PATCH(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const status = typeof body.action === "string" ? ACTION_TO_STATUS[body.action] : undefined;
  if (!status) return NextResponse.json({ error: "action must be ack or dismiss" }, { status: 400 });

  try {
    const recommendation = updateRecommendationStatus(id, status);
    return NextResponse.json({ ok: true, recommendation });
  } catch (e: any) {
    const notFound = /not found/.test(e?.message || "");
    return NextResponse.json({ error: e?.message || "write failed" }, { status: notFound ? 404 : 400 });
  }
}

// Same action, POST verb — the dashboard buttons use POST (simpler fetch call,
// no method override needed); PATCH above is kept for REST-conventional callers.
export async function POST(req: Request) {
  return PATCH(req);
}
