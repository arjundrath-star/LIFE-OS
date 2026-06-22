import { NextResponse } from "next/server";
import { all, run } from "@/db";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ todos: all("SELECT * FROM todos ORDER BY done, id") });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.action === "add") {
    if (!body.text) return NextResponse.json({ error: "text required" }, { status: 400 });
    run("INSERT INTO todos (text, source, due) VALUES (?, 'manual', ?)", body.text, body.due || null);
  } else if (body.action === "toggle") {
    run("UPDATE todos SET done = CASE WHEN done=1 THEN 0 ELSE 1 END WHERE id=?", body.id);
  } else if (body.action === "delete") {
    run("DELETE FROM todos WHERE id=?", body.id);
  } else {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  return NextResponse.json({ todos: all("SELECT * FROM todos ORDER BY done, id") });
}
