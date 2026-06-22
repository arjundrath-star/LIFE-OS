"use client";
import { useState } from "react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Button, Badge } from "@/components/ui";
import { StatusDot } from "@/components/StatusDot";
import { EmptyState } from "@/components/Panel";
import { useApi, apiPost } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Boxes, DollarSign, Plus, X, AlertCircle, MapPin, ChevronRight, ChevronLeft, Send } from "lucide-react";

const STAGES = [
  { key: "lead", label: "Lead" },
  { key: "contacted", label: "Contacted" },
  { key: "verbal_yes", label: "Bar said yes" },
  { key: "placing", label: "Placing" },
  { key: "live", label: "Live" },
];
const ORDER = STAGES.map((s) => s.key);

function money(cents: number | undefined) {
  return `$${((cents ?? 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function VendingPage() {
  const { data, refetch } = useApi<any>("/api/vending");
  const live = useLiveData<any>("vending");
  const v = live || data;
  const [dealName, setDealName] = useState("");
  const [machineName, setMachineName] = useState("");
  const [machineLoc, setMachineLoc] = useState("");

  const post = async (body: any) => {
    await apiPost("/api/vending", body);
    refetch();
  };
  const addDeal = async () => {
    if (!dealName.trim()) return;
    await post({ action: "add_deal", name: dealName.trim() });
    setDealName("");
  };
  const moveDeal = (d: any, dir: 1 | -1) => {
    const i = ORDER.indexOf(d.stage);
    const next = ORDER[Math.min(ORDER.length - 1, Math.max(0, i + dir))];
    if (next !== d.stage) post({ action: "set_stage", id: d.id, stage: next });
  };
  const addMachine = async () => {
    if (!machineName.trim()) return;
    await post({ action: "add_machine", name: machineName.trim(), location: machineLoc.trim() || null });
    setMachineName("");
    setMachineLoc("");
  };

  const connected = !!v?.revenueConnected;
  const machines: any[] = v?.machines ?? [];
  const deals: any[] = v?.deals ?? [];

  // group machines by location for the placement view
  const byLocation = new Map<string, any[]>();
  for (const m of machines) {
    const k = m.location || "Unplaced";
    byLocation.set(k, [...(byLocation.get(k) || []), m]);
  }

  return (
    <ProjectPage
      title="Vending Ops"
      icon={<Boxes size={18} />}
      subtitle="Snack machines in bars across the city. Revenue, the deal pipeline, and machine fleet."
      statusDot={v?.needsRefill > 0 ? "warn" : "healthy"}
      statusLabel={`${machines.length} machine${machines.length === 1 ? "" : "s"} · ${v?.liveMachines ?? 0} live`}
      actions={!connected ? <a href="/connections"><Button size="sm" variant="accent"><Plus size={12} /> connect Mercury</Button></a> : undefined}
      hero={
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Revenue today" value={connected ? money(v?.revenueTodayCents) : "$—"} tone={connected ? "accent" : "muted"} sub={connected ? "via Mercury" : "Mercury not connected"} />
          <HeroStat label="This week" value={connected ? money(v?.revenueLast7Cents) : "$—"} tone={connected ? "primary" : "muted"} sub="last 7 days" />
          <HeroStat label="Month to date" value={connected ? money(v?.revenueMtdCents) : "$—"} tone={connected ? "primary" : "muted"} sub="since the 1st" />
        </div>
      }
    >
      {!v ? (
        <Section><EmptyState title="loading" /></Section>
      ) : (
        <>
          {/* deal pipeline */}
          <Section
            title="Deal pipeline"
            icon={<Send size={13} />}
            right={
              <div className="flex items-center gap-2">
                <input value={dealName} onChange={(e) => setDealName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addDeal()} placeholder="new lead (bar name)" className="w-44 rounded-inner border border-border bg-base px-2 py-1 text-xs text-txt-primary outline-none focus:border-accent/50" />
                <Button size="sm" variant="accent" onClick={addDeal}><Plus size={12} /> add</Button>
              </div>
            }
            bodyClassName="overflow-x-auto"
          >
            <div className="grid min-w-[820px] grid-cols-5 gap-3">
              {STAGES.map((s) => {
                const items = deals.filter((d) => d.stage === s.key);
                return (
                  <div key={s.key} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between rounded-inner border border-border/60 bg-panel-2/40 px-2.5 py-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-txt-muted">{s.label}</span>
                      <span className="font-mono text-xs text-accent">{items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {items.map((d) => (
                        <div key={d.id} className="group/deal rounded-inner border border-border/70 bg-panel p-2.5">
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-xs text-txt-primary">{d.name}</span>
                            <button onClick={() => post({ action: "delete_deal", id: d.id })} className="opacity-0 transition-opacity group-hover/deal:opacity-100 text-txt-faint hover:text-error" aria-label="delete deal"><X size={11} /></button>
                          </div>
                          {d.location && <div className="mt-0.5 truncate text-[10px] text-txt-faint">{d.location}</div>}
                          <div className="mt-1.5 flex items-center justify-between">
                            <button onClick={() => moveDeal(d, -1)} disabled={d.stage === ORDER[0]} className="text-txt-faint hover:text-accent disabled:opacity-30" aria-label="back a stage"><ChevronLeft size={13} /></button>
                            <span className="font-mono text-[9px] text-txt-faint/70">{timeAgo(d.updated_at)}</span>
                            <button onClick={() => moveDeal(d, 1)} disabled={d.stage === ORDER[ORDER.length - 1]} className="text-txt-faint hover:text-accent disabled:opacity-30" aria-label="advance a stage"><ChevronRight size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-3">
            {/* machines */}
            <Section
              className="lg:col-span-2"
              title="Machines"
              icon={<Boxes size={13} />}
              right={
                <div className="flex items-center gap-1.5">
                  <input value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="name" className="w-24 rounded-inner border border-border bg-base px-2 py-1 text-xs text-txt-primary outline-none focus:border-accent/50" />
                  <input value={machineLoc} onChange={(e) => setMachineLoc(e.target.value)} placeholder="location" className="w-28 rounded-inner border border-border bg-base px-2 py-1 text-xs text-txt-primary outline-none focus:border-accent/50" />
                  <Button size="sm" variant="accent" onClick={addMachine} aria-label="Add machine"><Plus size={12} /></Button>
                </div>
              }
            >
              {machines.length === 0 ? (
                <EmptyState title="no machines yet" hint="Add a machine once one is placed." icon={<Boxes size={20} />} />
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {machines.map((m) => (
                    <div key={m.id} className={cn("rounded-inner border bg-panel-2/30 p-3", m.needs_refill ? "border-warn/40" : "border-border/70")}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <StatusDot state={m.status === "live" ? "healthy" : m.status === "placing" ? "warn" : "off"} size={7} pulse={m.status === "live"} />
                          <span className="text-sm text-txt-primary">{m.name}</span>
                        </div>
                        <Badge tone={m.status === "live" ? "healthy" : "muted"} className="!normal-case">{m.status}</Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-txt-faint"><MapPin size={10} /> {m.location || "unplaced"}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-txt-faint">refilled {m.last_refill ? timeAgo(m.last_refill) : "never"}</span>
                        <button onClick={() => post({ action: "toggle_refill", id: m.id })} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", m.needs_refill ? "border-warn/40 text-warn" : "border-border text-txt-faint hover:text-accent")}>
                          {m.needs_refill ? "needs refill" : "ok"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {v.needsRefill > 0 && (
                <div className="mt-3 flex items-center gap-2 rounded-inner border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
                  <AlertCircle size={13} /> {v.needsRefill} machine{v.needsRefill > 1 ? "s" : ""} need a refill
                </div>
              )}
            </Section>

            {/* outreach + placements */}
            <div className="flex flex-col gap-5">
              <Section title="Outreach" icon={<Send size={13} />}>
                <div className="grid grid-cols-2 gap-3">
                  <HeroStat label="Opened (7d)" value={v.outreachThisWeek ?? 0} tone="accent" sub="new leads" />
                  <HeroStat label="Replied" value={v.replies ?? 0} tone="healthy" sub="advanced past lead" />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-txt-faint/70">Derived from the deal log. Wire a dedicated outreach inbox later to count sends and replies directly.</p>
              </Section>

              <Section title="Placements" icon={<MapPin size={13} />}>
                {machines.length === 0 ? (
                  <div className="py-3 text-center text-xs text-txt-faint/70">no placements yet</div>
                ) : (
                  <div className="space-y-2">
                    {Array.from(byLocation.entries()).map(([loc, ms]) => (
                      <div key={loc} className="rounded-inner border border-border/60 bg-panel-2/30 px-3 py-2">
                        <div className="flex items-center gap-1.5 text-xs text-txt-primary"><MapPin size={11} className="text-accent" /> {loc}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {ms.map((m) => (
                            <span key={m.id} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-txt-muted">
                              <StatusDot state={m.status === "live" ? "healthy" : "off"} size={5} /> {m.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        </>
      )}
    </ProjectPage>
  );
}
