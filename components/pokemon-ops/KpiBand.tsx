"use client";
// KPI band: margin $/slot/day (PRIMARY), total invested, sell-through, days-of-supply
// spread. Tremor tiles per rathworkspace-ui skill; JetBrains Mono numbers via <CountUp>.
// All four numbers arrive pre-computed on the snapshot (lib/pokemon-ops/snapshot.ts) —
// this component only formats and renders, it never computes margin/sell-through/spread.
import { Card, Grid, Text } from "@tremor/react";
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
    // data-testid lives on the plain wrapping div — Tremor's CardProps has no
    // index signature for arbitrary data-* attributes, so it goes on the div,
    // an intrinsic element (TS allows data-* there unconditionally).
    <div data-testid={testId}>
      <Card
        className={cn(
          "!rounded-panel !border !border-border !bg-panel !shadow-panel",
          primary && "!border-accent/30"
        )}
      >
        <Text className="!font-mono !text-[10px] !uppercase !tracking-[0.18em] !text-tremor-content-subtle">
          {label}
        </Text>
        <div
          className={cn(
            "mt-1 font-mono text-3xl font-semibold tabular leading-none",
            primary ? "text-accent text-glow" : "text-slate-950 dark:text-white text-txt-primary"
          )}
        >
          {value}
        </div>
        {sub && <Text className="!mt-1.5 !text-xs !text-tremor-content">{sub}</Text>}
      </Card>
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
        label="Total invested"
        value={<CountUp value={kpis.total_invested_cents / 100} decimals={2} prefix="$" />}
        sub="all purchase lots, all-time"
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
