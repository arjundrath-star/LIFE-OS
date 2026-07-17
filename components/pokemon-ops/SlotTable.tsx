"use client";
// Per-slot table: SKU, price, velocity, stock, days of supply, projected sellout.
// Pure render of snapshot.slots — no client-side math.
import { EmptyState } from "@/components/Panel";
import { formatCents, formatDate, formatDays, formatVelocity } from "@/lib/pokemon-ops/format";
import type { PokemonOpsSlotRow } from "@/lib/pokemon-ops/snapshot";

export function SlotTable({ slots }: { slots: PokemonOpsSlotRow[] }) {
  if (slots.length === 0) {
    return (
      <EmptyState
        title="no active slots"
        hint="assign a SKU to a machine slot below — the Mini Wall has no live assignments yet"
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="slot-table">
        <thead>
          <tr className="border-b border-border/70 text-[10px] uppercase tracking-wider text-txt-faint">
            <th className="py-2 pr-3 font-mono">Slot</th>
            <th className="py-2 pr-3">Set</th>
            <th className="py-2 pr-3 font-mono">Price</th>
            <th className="py-2 pr-3 font-mono">Velocity/day</th>
            <th className="py-2 pr-3 font-mono">Stock</th>
            <th className="py-2 pr-3 font-mono">Days of supply</th>
            <th className="py-2 pr-3 font-mono">Margin $/day</th>
            <th className="py-2 pr-3 font-mono">Proj. sellout</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.slot_number} className="border-b border-border/40" data-testid={`slot-row-${s.slot_number}`}>
              <td className="py-2 pr-3 font-mono text-txt-primary">{s.slot_number}</td>
              <td className="py-2 pr-3 text-txt-primary">{s.set_name}</td>
              <td className="py-2 pr-3 font-mono text-txt-muted">{formatCents(s.price_cents)}</td>
              <td className="py-2 pr-3 font-mono text-txt-muted">{formatVelocity(s.velocity_units_per_day)}</td>
              <td className="py-2 pr-3 font-mono text-txt-muted">{s.current_stock}</td>
              <td className="py-2 pr-3 font-mono text-txt-muted">{formatDays(s.days_of_supply)}</td>
              <td className="py-2 pr-3 font-mono text-txt-muted">{formatCents(s.margin_per_slot_day_cents)}</td>
              <td className="py-2 pr-3 font-mono text-txt-faint">{formatDate(s.projected_sellout_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
