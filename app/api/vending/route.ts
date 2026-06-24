import { NextResponse } from "next/server";
import { run } from "@/db";
import { requireUser } from "@/lib/guard";
import { getHub } from "@/server/live";
import { vendingSnapshot } from "@/lib/vending";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(vendingSnapshot());
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
  const snap = vendingSnapshot();
  getHub().broadcast("vending", snap);
  return NextResponse.json(snap);
}
