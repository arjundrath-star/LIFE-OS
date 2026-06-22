import { NextResponse } from "next/server";
import { listAccounts, setAccountEnabled, removeAccount, emailSnapshots, pollEmailAccounts } from "@/lib/sources/google";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ accounts: listAccounts() });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, email, enabled } = await req.json();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (action === "toggle") setAccountEnabled(email, !!enabled);
  else if (action === "remove") removeAccount(email);
  else return NextResponse.json({ error: "bad action" }, { status: 400 });

  try {
    await pollEmailAccounts();
  } catch {}
  getHub().broadcast("email", emailSnapshots());
  return NextResponse.json({ accounts: listAccounts(), email: emailSnapshots() });
}
