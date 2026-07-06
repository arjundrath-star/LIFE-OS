"use client";
// Row 1: mutually-exclusive filter tabs with live counts.
// Row 2: multi-select category chips derived from the imported data.
import { cn } from "@/lib/cn";
import type { LeadRow } from "./types";

export type FilterKey =
  | "all"
  | "not_active"
  | "active"
  | "call_queue"
  | "visit_queue"
  | "untested"
  | "weekend"
  | "pm"
  | "am";

export const FILTERS: { key: FilterKey; label: string; window?: boolean }[] = [
  { key: "all", label: "All" },
  { key: "not_active", label: "Not Active" },
  { key: "active", label: "Active" },
  { key: "call_queue", label: "Call Queue" },
  { key: "visit_queue", label: "Visit Queue" },
  { key: "untested", label: "Has Usable #s" },
  // Window/route tabs only appear once route planning fills those fields in.
  { key: "weekend", label: "Weekend Route", window: true },
  { key: "pm", label: "7-10 PM", window: true },
  { key: "am", label: "7-9 AM", window: true },
];

export function filterMatches(l: LeadRow, f: FilterKey): boolean {
  switch (f) {
    case "all":
      return true;
    case "not_active":
      return !l.active;
    case "active":
      return !!l.active;
    case "call_queue":
      return l.stage === "call_queue";
    case "visit_queue":
      return l.stage === "visit_queue";
    case "untested":
      return l.untested_count > 0;
    case "weekend":
      return `${l.route_cluster || ""} ${l.best_visit_window || ""}`.toLowerCase().includes("weekend");
    case "pm":
      return l.best_visit_window === "7-10 PM";
    case "am":
      return l.best_visit_window === "7-9 AM";
  }
}

export function LeadFilterChips({
  filter,
  onFilter,
  showWindowTabs,
  cats,
  selectedCats,
  onToggleCat,
  countFor,
}: {
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  showWindowTabs: boolean;
  cats: string[];
  selectedCats: string[];
  onToggleCat: (c: string) => void;
  countFor: (f: FilterKey) => number;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-1">
        {FILTERS.filter((f) => showWindowTabs || !f.window).map((f) => {
          const on = filter === f.key;
          return (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.06em] transition-colors",
                on
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-transparent text-txt-muted hover:text-txt-primary"
              )}
            >
              {f.label}
              <span className={cn("text-[9.5px]", on ? "text-accent-glow" : "text-txt-faint")}>
                {countFor(f.key)}
              </span>
            </button>
          );
        })}
      </div>
      {cats.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-txt-faint">
            category
          </span>
          {cats.map((c) => {
            const on = selectedCats.includes(c);
            return (
              <button
                key={c}
                onClick={() => onToggleCat(c)}
                className={cn(
                  "whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                  on
                    ? "border-accent/50 bg-accent/10 text-accent"
                    : "border-border bg-panel-2/40 text-txt-muted hover:text-txt-primary"
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
