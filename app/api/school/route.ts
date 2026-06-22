import { NextResponse } from "next/server";
import { kvGet, kvSet } from "@/db";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

// Pre-term "set up before school" checklist, persisted in KV. Editable from the
// School page. Once classes start (2026-09-02) the page shifts to the live NYU feed.
type Item = { id: number; text: string; done: boolean };
const KEY = "school_checklist";

const DEFAULTS: Item[] = [
  { id: 1, text: "Connect the NYU calendar (student@example.edu) in the Email panel", done: false },
  { id: 2, text: "Register for fall classes and confirm the schedule", done: false },
  { id: 3, text: "Get the textbook / course-materials list", done: false },
  { id: 4, text: "Set up Brightspace + NYU email forwarding", done: false },
  { id: 5, text: "Sort housing and the commute", done: false },
];

function load(): Item[] {
  const v = kvGet<Item[]>(KEY);
  if (!v) {
    kvSet(KEY, DEFAULTS);
    return DEFAULTS;
  }
  return v;
}

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ checklist: load() });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  let items = load();
  if (body.action === "toggle") {
    items = items.map((i) => (i.id === body.id ? { ...i, done: !i.done } : i));
  } else if (body.action === "add") {
    if (!body.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
    const nextId = items.reduce((m, i) => Math.max(m, i.id), 0) + 1;
    items = [...items, { id: nextId, text: body.text.trim(), done: false }];
  } else if (body.action === "delete") {
    items = items.filter((i) => i.id !== body.id);
  } else {
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  }
  kvSet(KEY, items);
  return NextResponse.json({ checklist: items });
}
