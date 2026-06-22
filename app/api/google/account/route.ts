import { NextResponse } from "next/server";
import { listAccounts, setAccountEnabled, removeAccount, emailSnapshots, pollEmailAccounts } from "@/lib/sources/google";
import { getHub } from "@/server/live";
import { requireUser } from "@/lib/guard";
import { setEnabled, refreshAll } from "@/lib/connections";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ accounts: listAccounts() });
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { action, email, enabled } = await req.json();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (action === "toggle") setAccountEnabled(email, !!enabled);
  else if (action === "remove") removeAccount(email);
  else return NextResponse.json({ error: "bad action" }, { status: 400 });

  // If the last reader account is gone, return Google to an honest "off / connect me"
  // rather than leaving it enabled and flipping to "broken (no accounts)".
  const remaining = listAccounts().filter((a: any) => a.enabled).length;
  if (remaining === 0) setEnabled("google", "dashboard", false);
  else setEnabled("google", "dashboard", true);

  try {
    await pollEmailAccounts();
  } catch {}
  const states = await refreshAll();
  getHub().broadcast("connections", states);
  getHub().broadcast("email", emailSnapshots());
  return NextResponse.json({ accounts: listAccounts(), email: emailSnapshots() });
}
