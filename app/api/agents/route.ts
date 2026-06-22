import { NextResponse } from "next/server";
import { fetchHermesStatus } from "@/lib/sources/hermes";
import { readTelegramActivity } from "@/lib/sources/telegram";
import { all, get } from "@/db";
import { requireUser } from "@/lib/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const hermes = await fetchHermesStatus();
  const telegram = readTelegramActivity();
  const claudeRow = get<any>(
    "SELECT ts, summary, detail FROM agent_activity WHERE source='claude' ORDER BY id DESC LIMIT 1"
  );
  const activity = all<any>("SELECT ts, source, kind, summary FROM agent_activity ORDER BY id DESC LIMIT 30");
  return NextResponse.json({
    hermes: {
      online: hermes.online,
      reachable: hermes.reachable,
      version: hermes.version,
      gatewayState: hermes.gatewayState,
      activeSessions: hermes.activeSessions,
      platforms: hermes.platforms,
      detail: hermes.error ?? null,
      checkedAt: hermes.checkedAt,
    },
    telegram,
    claude: claudeRow ? { lastAt: claudeRow.ts, summary: claudeRow.summary, detail: claudeRow.detail } : null,
    activity,
  });
}
