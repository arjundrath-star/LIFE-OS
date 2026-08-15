import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/connections";
import { REGISTRY } from "@/lib/connections/registry";
import { filterConnectionStates, visibleConnectionDefinitions } from "@/lib/connections/access";
import { getHub } from "@/server/live";
import { requireConnectionAccess } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function POST() {
  const access=await requireConnectionAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const states = await refreshAll(visibleConnectionDefinitions(REGISTRY,access),{force:true});
  getHub().broadcast("connections", states);
  return NextResponse.json({ connections: filterConnectionStates(states,access) });
}
