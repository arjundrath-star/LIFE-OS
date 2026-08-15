import { NextResponse } from "next/server";
import { setApiKey, API_KEY_ENV } from "@/lib/connections";
import { getHub } from "@/server/live";
import { filterConnectionStates, mayMutateConnection } from "@/lib/connections/access";
import { requireConnectionAccess } from "@/lib/guard";
import { dashboardHealthSnapshot } from "@/lib/health";

export const dynamic = "force-dynamic";

// Accepts an API key, writes it server-side to the secret store, never echoes it back.
export async function POST(req: Request) {
  const access=await requireConnectionAccess();
  if (!access) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { service, value } = await req.json();
  if (!mayMutateConnection(access,service)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const envKey = API_KEY_ENV[service];
  if (!envKey) return NextResponse.json({ error: "service does not accept an API key" }, { status: 400 });
  if (!value || typeof value !== "string" || value.length < 8) {
    return NextResponse.json({ error: "invalid key" }, { status: 400 });
  }
  const states = await setApiKey(service, envKey, value);
  getHub().broadcast("connections", states);
  if(service==="hevy")getHub().broadcast("health",dashboardHealthSnapshot());
  return NextResponse.json({ ok: true, connections: filterConnectionStates(states,access) }); // note: no key in response
}
