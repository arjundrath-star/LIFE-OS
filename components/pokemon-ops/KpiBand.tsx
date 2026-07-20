"use client";
// Machine-only KPI band. Values arrive pre-computed on the snapshot; this
// component only formats and renders them with explicit light-theme contrast.
import { Grid } from "@tremor/react";
import { CountUp } from "@/components/CountUp";
import { cn } from "@/lib/cn";
import type { PokemonOpsSnapshot } from "@/lib/pokemon-ops/snapshot";

function Tile({
  label,
  value,
  sub,
  primary = false,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  primary?: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-lg border border-slate-300 !bg-white p-6 shadow-sm",
        primary && "border-orange-400"
      )}
    >
      <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] !text-[#475569]">
        {label}
      </p>
      <div className="mt-2 font-mono text-3xl font-semibold leading-none tabular !text-[#0a1f3d]">
        {value}
      </div>
      {sub && <p className="mt-2 text-xs !text-[#475569]">{sub}</p>}
    </div>
  );
}

export function KpiBand({ snapshot }: { snapshot: PokemonOpsSnapshot }) {
  const { kpis } = snapshot;
  const marginKnown = kpis.margin_per_slot_day_cents !== null;
  const sellThroughKnown = kpis.sell_through_pct !== null;
  const spreadKnown = kpis.days_of_supply_spread !== null;

  return (
    <Grid numItemsSm={2} numItemsLg={4} className="gap-3">
      <Tile
        testId="kpi-margin-per-slot-day"
        label="Margin $/slot/day"
        primary
        value={
          marginKnown ? (
            <CountUp value={(kpis.margin_per_slot_day_cents as number) / 100} decimals={2} prefix="$" />
          ) : (
            "—"
          )
        }
        sub={marginKnown ? "sum across active slots, trailing 14d" : "no active slots yet"}
      />
      <Tile
        testId="kpi-total-invested"
        label="Lifetime purchases"
        value={<CountUp value={kpis.total_invested_cents / 100} decimals={2} prefix="$" />}
        sub="all purchase lots, including sold stock"
      />
      <Tile
        testId="kpi-sell-through"
        label="Sell-through"
        value={sellThroughKnown ? <CountUp value={kpis.sell_through_pct as number} decimals={1} suffix="%" /> : "—"}
        sub={sellThroughKnown ? "units sold / units refilled, trailing 30d" : "no refills logged in 30d"}
      />
      <Tile
        testId="kpi-days-of-supply-spread"
        label="Days-of-supply spread"
        value={spreadKnown ? <CountUp value={kpis.days_of_supply_spread as number} decimals={1} suffix="d" /> : "—"}
        sub={spreadKnown ? "max − min across active slots" : "fewer than 2 comparable slots"}
      />
    </Grid>
  );
}
