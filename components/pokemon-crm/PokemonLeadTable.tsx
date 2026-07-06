"use client";
// Dense operator-style lead grid. Rows open the full-screen lead detail.
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui";
import {
  type LeadRow,
  type Stage,
  STAGES,
  STAGE_CLASS,
  scoreTone,
  clusterLabel,
} from "./types";

const GRID =
  "grid grid-cols-[46px_minmax(180px,1.5fr)_148px_minmax(104px,0.9fr)_minmax(150px,1.2fr)_118px_46px_50px_38px_42px_84px_minmax(140px,1fr)_32px] items-center gap-2.5";

export function PokemonLeadTable({
  leads,
  onOpen,
  onStageChange,
}: {
  leads: LeadRow[];
  onOpen: (id: number) => void;
  onStageChange: (id: number, stage: Stage) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[1380px]">
        <div
          className={cn(
            GRID,
            "border-b border-border/70 bg-panel-2/40 px-5 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-txt-faint"
          )}
        >
          <span>Score</span>
          <span>Venue</span>
          <span>Stage</span>
          <span>Category</span>
          <span>Address</span>
          <span>Biz phone</span>
          <span>Rtg</span>
          <span>Revs</span>
          <span>Web</span>
          <span>Notes</span>
          <span>Contacts</span>
          <span>Next action</span>
          <span />
        </div>
        {leads.map((l) => (
          <div
            key={l.id}
            onClick={() => onOpen(l.id)}
            role="button"
            tabIndex={0}
            aria-label={`Open ${l.venue_name}`}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                e.preventDefault();
                onOpen(l.id);
              }
            }}
            className={cn(
              GRID,
              "cursor-pointer border-b border-border/50 px-5 py-2 transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-none"
            )}
          >
            <Badge tone={scoreTone(l.vending_score)} className="min-w-[26px] justify-center font-bold">
              {l.vending_score ?? "—"}
            </Badge>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[13px] font-medium text-txt-primary">{l.venue_name}</span>
                <Badge tone={l.active ? "accent" : "off"} className="shrink-0 !px-1.5 !text-[8.5px]">
                  {l.active ? "active" : "not active"}
                </Badge>
              </span>
              <span className="mt-0.5 block truncate font-mono text-[9.5px] uppercase tracking-wider text-txt-faint">
                {clusterLabel(l)}
              </span>
            </span>
            <span onClick={(e) => e.stopPropagation()}>
              <select
                value={l.stage}
                onChange={(e) => onStageChange(l.id, e.target.value as Stage)}
                aria-label={`Stage for ${l.venue_name}`}
                className={cn(
                  "w-full cursor-pointer appearance-none rounded-[6px] border border-border bg-base px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.05em] outline-none focus:border-accent/50",
                  STAGE_CLASS[l.stage] || "text-txt-muted"
                )}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <Badge tone="muted" className="!normal-case !tracking-normal !text-[9px]">
                {l.category || "—"}
              </Badge>
            </span>
            <span className="truncate text-[11.5px] text-txt-faint">{l.address || "—"}</span>
            <span className="font-mono text-[11px] text-txt-muted">{l.venue_phone || "—"}</span>
            <span
              className={cn(
                "font-mono text-[11px] tabular",
                l.rating == null
                  ? "text-txt-faint"
                  : l.rating >= 4.3
                    ? "text-healthy"
                    : l.rating >= 4
                      ? "text-txt-muted"
                      : "text-warn"
              )}
            >
              {l.rating != null ? l.rating.toFixed(1) : "—"}
            </span>
            <span className="font-mono text-[11px] tabular text-txt-faint">{l.reviews ?? "—"}</span>
            <span className={cn("font-mono text-[11px]", l.website ? "text-accent" : "text-txt-faint")}>
              {l.website ? "yes ↗" : "—"}
            </span>
            <span className="font-mono text-[10px] text-txt-faint">{l.notes ? "1n" : "—"}</span>
            <span className="flex items-center gap-1.5 font-mono text-[10.5px]">
              <span className="text-txt-muted">{l.contact_count}c</span>
              <span
                className={cn(
                  l.untested_count > 0 ? "font-bold text-healthy" : "text-txt-faint"
                )}
              >
                {l.untested_count}#
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11.5px] text-txt-primary">
                {l.next_action || "—"}
              </span>
              {l.next_action_due && (
                <span
                  className={cn(
                    "mt-px block truncate font-mono text-[9px] uppercase tracking-[0.1em]",
                    l.next_action_due.toLowerCase().startsWith("overdue")
                      ? "text-error"
                      : l.next_action_due.toLowerCase().startsWith("due")
                        ? "text-warn"
                        : "text-txt-faint"
                  )}
                >
                  {l.next_action_due}
                </span>
              )}
            </span>
            <span className="flex justify-end text-txt-faint">
              <ChevronRight size={14} />
            </span>
          </div>
        ))}
        {leads.length === 0 && (
          <div className="px-5 py-8 text-center font-mono text-[11px] uppercase tracking-[0.1em] text-txt-faint">
            no leads match the current filters
          </div>
        )}
      </div>
    </div>
  );
}
