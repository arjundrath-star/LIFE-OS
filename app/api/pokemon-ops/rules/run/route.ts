import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { listOpenRecommendations, listRecommendationsFiltered } from "@/lib/pokemon-ops/db";
import { runRules } from "@/lib/pokemon-ops/rules";
import {
  RECOMMENDATION_RULES,
  RECOMMENDATION_STATUSES,
} from "@/lib/pokemon-ops/types";

export const dynamic = "force-dynamic";

/** On-demand rules run. The engine itself is deterministic — asOf is stamped
 *  here, at the boundary, not inside the rules module. */
export async function POST() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const result = runRules(new Date().toISOString());
    return NextResponse.json({ ok: true, ...result, open: listOpenRecommendations() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "rules run failed" }, { status: 500 });
  }
}

/** List recommendations. Filters: ?status=open&rule=refill_order&machine_id=1&limit=50 */
export async function GET(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const rule = url.searchParams.get("rule") ?? undefined;
  const machineIdParam = url.searchParams.get("machine_id");
  const limitParam = url.searchParams.get("limit");

  if (status !== undefined && !(RECOMMENDATION_STATUSES as readonly string[]).includes(status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  if (rule !== undefined && !(RECOMMENDATION_RULES as readonly string[]).includes(rule)) {
    return NextResponse.json({ error: "bad rule" }, { status: 400 });
  }
  let machineId: number | undefined;
  if (machineIdParam) {
    const n = parseInt(machineIdParam, 10);
    if (!Number.isInteger(n) || n <= 0) {
      return NextResponse.json({ error: "bad machine_id" }, { status: 400 });
    }
    machineId = n;
  }
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 100) : undefined;

  const rows = listRecommendationsFiltered({ status, rule, machineId, limit });
  return NextResponse.json({
    recommendations: rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) })),
  });
}
