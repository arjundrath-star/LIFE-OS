import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { pokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";

export const dynamic = "force-dynamic";

/** First-paint fallback for the /pokemon-ops tab — same shape the scheduler
 *  broadcasts on the 'pokemon_ops' WS channel every 60s. */
export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(pokemonOpsSnapshot(new Date().toISOString()));
}
