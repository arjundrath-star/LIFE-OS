"use client";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";
import { BusinessPage, BusinessSection, Fact, SourceStamp } from "./Page";
import { useBusinessUnit } from "./BusinessContext";

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function FinanceWorkspace() {
  const { unit } = useBusinessUnit();
  const { data: vendingHttp } = useApi<any>("/api/vending");
  const vending = useLiveData<any>("vending") || vendingHttp;
  const { data: opsHttp } = useApi<PokemonOpsSnapshot>("/api/pokemon-ops");
  const ops = useLiveData<PokemonOpsSnapshot>("pokemon_ops") || opsHttp;
  const { data: accounts } = useApi<any>("/api/accounts");
  const books = (accounts?.accounts ?? []).filter((item: any) => /(mercury|account|book|drive)/i.test(`${item.label} ${item.kind} ${item.surface || ""} ${item.note || ""}`));
  if (unit === "portable-charging" || unit === "subtap") return <BusinessPage title="Finance" description="Operational revenue and cost sources only."><div className="business-empty"><h2>No finance feed for this unit</h2><p>{unit === "subtap" ? "Subtap" : "Portable Charging"} books are not synced into LIFE-OS. No values are estimated.</p></div></BusinessPage>;
  const sales = ops?.recent_sales ?? [];
  const recentSalesCents = sales.reduce((sum, sale) => sum + sale.qty * sale.unit_price_cents, 0);
  return <BusinessPage title="Finance" description="Operational revenue, sales, and costs from current read models. This is not a general ledger." actions={<SourceStamp>SQLite operational sources</SourceStamp>}>
    <div className="business-facts">
      <Fact label="Vending revenue today" value={vending?.revenueConnected ? money(vending.revenueTodayCents) : "Not connected"} detail="Mercury connection state" />
      <Fact label="Vending last 7 days" value={vending?.revenueConnected ? money(vending.revenueLast7Cents) : "—"} detail="revenue_daily read model" />
      <Fact label="Pokemon invested" value={ops ? money(ops.kpis.total_invested_cents) : "—"} detail="all purchase lots" />
      <Fact label={`Recent Pokemon sales (${sales.length})`} value={ops ? money(recentSalesCents) : "—"} detail="visible snapshot rows; not all-time revenue" />
    </div>
    <BusinessSection title="Accounting boundary"><p className="text-sm leading-6 text-txt-muted">Mercury connectivity only determines whether vending revenue can be shown. Accounting or Drive-backed books are not treated as synced ledger data unless a current API provides them. LIFE-OS does not calculate cash balance, tax, profit, or settlements from missing sources.</p></BusinessSection>
    <BusinessSection title="Book and banking sources" note={<SourceStamp>accounts catalog</SourceStamp>}>{books.length === 0 ? <p className="text-sm text-txt-muted">No Mercury, accounting, or Drive-backed books are catalogued. Books are not synced into LIFE-OS.</p> : <div className="business-list">{books.map((item: any) => <div key={item.id} className="flex min-h-14 items-center justify-between gap-4 py-3"><div><strong className="text-sm text-txt-primary">{item.label}</strong><p className="text-xs text-txt-muted">{item.note || item.surface || item.kind}</p></div><SourceStamp>{item.status || "catalogued — not a ledger sync"}</SourceStamp></div>)}</div>}</BusinessSection>
  </BusinessPage>;
}
