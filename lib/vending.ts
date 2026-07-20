// Shared vending snapshot builder. Used by the /api/vending route AND the scheduler so
// the WebSocket push and the HTTP fetch always agree. Server-only (reads SQLite + secrets).
import { all } from "@/db";
import { hasSecret } from "@/lib/secrets";
import { vendingOutreachSnapshot } from "@/lib/sources/google";

export function vendingSnapshot() {
  const machines = all<any>("SELECT * FROM machines ORDER BY created_at DESC");
  const deals = all<any>("SELECT * FROM deals ORDER BY updated_at DESC");
  const revenueRows = all<any>(
    "SELECT day, amount_cents FROM revenue_daily ORDER BY day DESC LIMIT 30"
  );
  const last7 =
    all<any>(
      // last 7 days inclusive of today = today and the 6 days before it
      "SELECT COALESCE(SUM(amount_cents),0) c FROM revenue_daily WHERE day >= date('now','-6 day')"
    )[0]?.c ?? 0;
  const today =
    all<any>("SELECT COALESCE(SUM(amount_cents),0) c FROM revenue_daily WHERE day = date('now')")[0]
      ?.c ?? 0;
  const mtd =
    all<any>(
      "SELECT COALESCE(SUM(amount_cents),0) c FROM revenue_daily WHERE day >= date('now','start of month')"
    )[0]?.c ?? 0;

  // Real outreach signal, read straight from the outreach inbox (not the deal log).
  const outreach = vendingOutreachSnapshot();

  return {
    revenueConnected: hasSecret("MERCURY_API_TOKEN"),
    machines,
    deals,
    // Conversation activity is represented by the real deals/CRM tables. The
    // former hard-coded list was removed so this read model never invents status.
    inConversation: [],
    stages: {
      lead: deals.filter((d: any) => d.stage === "lead").length,
      contacted: deals.filter((d: any) => d.stage === "contacted").length,
      verbal_yes: deals.filter((d: any) => d.stage === "verbal_yes").length,
      placing: deals.filter((d: any) => d.stage === "placing").length,
      live: deals.filter((d: any) => d.stage === "live").length,
    },
    needsRefill: machines.filter((m: any) => m.needs_refill).length,
    liveMachines: machines.filter((m: any) => m.status === "live").length,
    revenueTodayCents: today,
    revenueLast7Cents: last7,
    revenueMtdCents: mtd,
    outreach,
    revenueHistory: revenueRows.reverse(),
  };
}
