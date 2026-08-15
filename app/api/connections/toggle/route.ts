import { NextResponse } from "next/server";
import { setEnabled } from "@/lib/connections";
import { getHub } from "@/server/live";
import { filterConnectionStates, mayMutateConnection } from "@/lib/connections/access";
import { requireConnectionAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const access=await requireConnectionAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { service, surface, enabled } = await req.json();
  if (!service || !surface) return NextResponse.json({ error: "service+surface required" }, { status: 400 });
  if (!mayMutateConnection(access,service)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const states = setEnabled(service, surface, !!enabled);
  getHub().broadcast("connections", states);
  return NextResponse.json({ connections: filterConnectionStates(states,access) });
}
