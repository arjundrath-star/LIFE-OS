import { NextResponse } from "next/server";
import { setSecret } from "@/lib/secrets";
import { refreshAll } from "@/lib/connections";
import { getHub } from "@/server/live";
import { requireHealthUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Stores the WHOOP developer-app client_id + client_secret server-side in the secret
// store. Never echoes them back. After this the Connect (OAuth) button is enabled.
export async function POST(req: Request) {
  if (!(await requireHealthUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { clientId, clientSecret } = await req.json();
  const id = typeof clientId === "string" ? clientId.trim() : "";
  const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
  if (id.length < 8 || secret.length < 8) {
    return NextResponse.json({ error: "client id and secret are required" }, { status: 400 });
  }
  try {
    setSecret("WHOOP_CLIENT_ID", id);
    setSecret("WHOOP_CLIENT_SECRET", secret);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 400 });
  }
  const states = await refreshAll();
  getHub().broadcast("connections", states);
  return NextResponse.json({ ok: true }); // note: no secrets in response
}
