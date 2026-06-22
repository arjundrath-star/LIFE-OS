import { NextResponse } from "next/server";
import { all, run, nowIso } from "@/db";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({
    accounts: all("SELECT * FROM accounts ORDER BY sort, label"),
  });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const { action } = body;
  if (action === "add") {
    const { label, kind, email, url, surface, note } = body;
    if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
    run(
      "INSERT INTO accounts (label, kind, email, url, surface, note, created_at) VALUES (?,?,?,?,?,?,?)",
      label, kind || "service", email || null, url || null, surface || null, note || null, nowIso()
    );
  } else if (action === "update") {
    const { id, label, kind, email, url, surface, note, status } = body;
    run(
      "UPDATE accounts SET label=?, kind=?, email=?, url=?, surface=?, note=?, status=? WHERE id=?",
      label, kind, email || null, url || null, surface || null, note || null, status || "active", id
    );
  } else if (action === "delete") {
    run("DELETE FROM accounts WHERE id=?", body.id);
  } else {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  return NextResponse.json({ accounts: all("SELECT * FROM accounts ORDER BY sort, label") });
}
