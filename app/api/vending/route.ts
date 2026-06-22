import { NextResponse } from "next/server";
import { all, run } from "@/db";
import { hasSecret } from "@/lib/secrets";
import { requireUser } from "@/lib/guard";
import { getHub } from "@/server/live";

export const dynamic = "force-dynamic";

function snapshot() {
  const machines = all("SELECT * FROM machines ORDER BY created_at DESC");
  const deals = all("SELECT * FROM deals ORDER BY updated_at DESC");
  const revenueRows = all<any>("SELECT day, amount_cents FROM revenue_daily ORDER BY day DESC LIMIT 30");
  const last7 = all<any>(
    "SELECT COALESCE(SUM(amount_cents),0) c FROM revenue_daily WHERE day >= date('now','-7 day')"
  )[0]?.c ?? 0;
  return {
    revenueConnected: hasSecret("MERCURY_API_TOKEN"),
    machines,
    deals,
    stages: {
      lead: deals.filter((d: any) => d.stage === "lead").length,
      contacted: deals.filter((d: any) => d.stage === "contacted").length,
      verbal_yes: deals.filter((d: any) => d.stage === "verbal_yes").length,
      placing: deals.filter((d: any) => d.stage === "placing").length,
      live: deals.filter((d: any) => d.stage === "live").length,
    },
    needsRefill: machines.filter((m: any) => m.needs_refill).length,
    revenueLast7Cents: last7,
    revenueHistory: revenueRows.reverse(),
  };
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(snapshot());
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  switch (body.action) {
    case "add_deal":
      if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });
      run("INSERT INTO deals (name, stage, location, machine_type, note) VALUES (?,?,?,?,?)",
        body.name, body.stage || "lead", body.location || null, body.machine_type || null, body.note || null);
      break;
    case "set_stage":
      run("UPDATE deals SET stage=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", body.stage, body.id);
      break;
    case "delete_deal":
      run("DELETE FROM deals WHERE id=?", body.id);
      break;
    case "add_machine":
      run("INSERT INTO machines (name, location, status, note) VALUES (?,?,?,?)",
        body.name, body.location || null, body.status || "prospect", body.note || null);
      break;
    case "toggle_refill":
      run("UPDATE machines SET needs_refill = CASE WHEN needs_refill=1 THEN 0 ELSE 1 END WHERE id=?", body.id);
      break;
    default:
      return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  const snap = snapshot();
  getHub().broadcast("vending", snap);
  return NextResponse.json(snap);
}
