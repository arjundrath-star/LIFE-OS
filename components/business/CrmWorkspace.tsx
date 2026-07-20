"use client";
// Pokemon CRM — manual call/visit pipeline for Pokemon machine placements.
// Lead pool from PeopleFinder CSV imports; leads flip active on first touchpoint.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CircleDot, Upload } from "lucide-react";
import { ProjectPage, HeroStat, Section } from "@/components/shell/ProjectPage";
import { Button, Dialog, DialogContent, DialogTrigger } from "@/components/ui";
import { EmptyState } from "@/components/Panel";
import { useApi, apiPost } from "@/hooks/useApi";
import { LeadFilterChips, filterMatches, type FilterKey } from "@/components/pokemon-crm/LeadFilterChips";
import { PokemonLeadTable } from "@/components/pokemon-crm/PokemonLeadTable";
import { LeadDetailPage } from "@/components/pokemon-crm/LeadDetailPage";
import type { EmailStatus, LeadDetail, PhoneStatus, Snapshot, Stage } from "@/components/pokemon-crm/types";

const ACTOR_KEY = "pokemon-crm.actor";
const IMPORT_CMD =
  "npm run import-pokemon-crm -- '/path/to/peoplefinder-export.csv'";

function ImportCsvDialog({ trigger }: { trigger: React.ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Import a PeopleFinder CSV" className="max-w-xl">
        <div className="space-y-3 p-5 text-sm text-txt-muted">
          <p>
            Imports run on the server so every number and email lands in SQLite with full
            history. From a terminal on the box (or the Terminal tab):
          </p>
          <pre className="overflow-x-auto rounded-inner border border-border bg-base px-3 py-2.5 font-mono text-xs text-accent">
            {IMPORT_CMD}
          </pre>
          <p className="text-xs leading-relaxed text-txt-faint">
            Re-importing the same file is safe — venues are matched on name + address, and
            existing stages, notes, and call history are never overwritten. New numbers and
            emails are appended.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function CrmWorkspace() {
  const { data: snap, refetch } = useApi<Snapshot>("/api/pokemon-crm");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [selId, setSelId] = useState<number | null>(null);
  const selIdRef = useRef<number | null>(null);
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [actor, setActor] = useState("Arjun");
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showError = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 5000);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACTOR_KEY);
      if (saved) setActor(saved);
    } catch {}
  }, []);
  const changeActor = (a: string) => {
    setActor(a);
    try {
      localStorage.setItem(ACTOR_KEY, a);
    } catch {}
  };

  const leads = useMemo(() => snap?.leads ?? [], [snap]);

  const openLead = useCallback(async (id: number) => {
    setSelId(id);
    selIdRef.current = id;
    setDetail(null);
    const r = await fetch(`/api/pokemon-crm?view=lead&id=${id}`);
    // Drop stale responses: only apply if this lead is still the one open.
    if (r.ok && selIdRef.current === id) setDetail(await r.json());
    else if (!r.ok && selIdRef.current === id) {
      setSelId(null);
      selIdRef.current = null;
    }
  }, []);

  const closeLead = useCallback(() => {
    setSelId(null);
    selIdRef.current = null;
    setDetail(null);
    refetch();
  }, [refetch]);

  // Every mutation returns the fresh lead detail; keep the open lead in sync and
  // refresh the list in the background.
  const post = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await apiPost("/api/pokemon-crm", { actor, ...body });
        if (res?.detail && res.detail.lead?.id === selIdRef.current) {
          setDetail(res.detail);
        }
        if (res?.error) showError(res.error);
        refetch();
        return res;
      } catch (e: any) {
        showError(e?.message || "request failed");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [actor, refetch, showError]
  );

  // ---- derived list state ----
  const cats = useMemo(
    () => [...new Set(leads.map((l) => l.category).filter(Boolean) as string[])].sort(),
    [leads]
  );
  const base = useMemo(() => {
    const q = query.trim().toLowerCase();
    return leads.filter((l) => {
      if (q && !`${l.venue_name} ${l.address || ""} ${l.category || ""}`.toLowerCase().includes(q))
        return false;
      if (selectedCats.length && !selectedCats.includes(l.category || "")) return false;
      return true;
    });
  }, [leads, query, selectedCats]);
  const filtered = useMemo(() => base.filter((l) => filterMatches(l, filter)), [base, filter]);
  const countFor = useCallback(
    (f: FilterKey) => base.filter((l) => filterMatches(l, f)).length,
    [base]
  );

  const activeN = leads.filter((l) => l.active).length;
  const untestedN = leads.reduce((n, l) => n + l.untested_count, 0);
  const followN = leads.filter(
    (l) => l.stage === "follow_up" || (l.next_action_due || "").toLowerCase().startsWith("overdue")
  ).length;

  const errorBanner = flash && (
    <div className="fixed bottom-12 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-inner border border-error/40 bg-panel px-4 py-2 text-xs text-error shadow-panel">
      <AlertCircle size={13} /> {flash}
    </div>
  );

  // ---- detail view swaps out the whole list UI (same URL, no overlay) ----
  if (selId != null) {
    return (
      <div className="mx-auto max-w-[1700px]">
        {errorBanner}
        {detail ? (
          <LeadDetailPage
            detail={detail}
            actor={actor}
            onActorChange={changeActor}
            busy={busy}
            onBack={closeLead}
            onStageChange={(stage: Stage) =>
              post({ action: "update_lead_stage", leadId: detail.lead.id, stage })
            }
            onNotesSave={(notes) =>
              post({ action: "update_lead_notes", leadId: detail.lead.id, notes })
            }
            onNextActionSave={(next_action, next_action_due) =>
              post({
                action: "update_lead_next_action",
                leadId: detail.lead.id,
                next_action,
                next_action_due,
              })
            }
            onOutcome={(phoneId, outcome: PhoneStatus) =>
              post({ action: "log_phone_call", leadId: detail.lead.id, phoneId, outcome })
            }
            onQuickMark={(phoneId, status) =>
              post({ action: "update_phone_status", leadId: detail.lead.id, phoneId, status })
            }
            onEmailStatus={(emailId, status: EmailStatus) =>
              post({ action: "update_email_status", leadId: detail.lead.id, emailId, status })
            }
            onAddPhone={(contactId, phone) =>
              post({ action: "add_phone", leadId: detail.lead.id, contactId, phone })
            }
            onAddContact={(name, title) =>
              post({ action: "add_contact", leadId: detail.lead.id, name, title })
            }
            onQuickLog={(kind, notes, next) =>
              post({ action: `log_${kind}`, leadId: detail.lead.id, notes, next })
            }
          />
        ) : (
          <Section>
            <EmptyState title="loading lead" />
          </Section>
        )}
      </div>
    );
  }

  return (
    <ProjectPage
      title="CRM"
      icon={<CircleDot size={18} />}
      subtitle="Pokemon placement leads, contacts, calls, visits, email status, and next actions."
      statusDot={untestedN > 0 ? "healthy" : "off"}
      statusLabel={`${leads.length} leads · ${activeN} active`}
      actions={
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search venues, addresses…"
            aria-label="Search leads"
            className="h-9 w-52 rounded-inner border border-border bg-base px-3 text-xs text-txt-primary outline-none focus:border-accent/50"
          />
          <ImportCsvDialog
            trigger={
              <Button variant="accent">
                <Upload size={13} /> Import CSV
              </Button>
            }
          />
        </div>
      }
      hero={
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeroStat
            label="All leads"
            value={leads.length}
            tone="primary"
            sub={`${leads.length - activeN} not active`}
          />
          <HeroStat label="Active leads" value={activeN} tone="accent" sub="touchpoint logged" />
          <HeroStat label="Usable numbers" value={untestedN} tone="healthy" sub="dials available" />
          <HeroStat
            label="Follow ups due"
            value={followN}
            tone={followN > 0 ? "warn" : "muted"}
            sub={followN > 0 ? "check the timeline" : "nothing due"}
          />
        </div>
      }
    >
      {errorBanner}
      {!snap ? (
        <Section>
          <EmptyState title="loading" />
        </Section>
      ) : leads.length === 0 ? (
        <Section>
          <EmptyState
            title="no leads imported"
            hint="Leads start inactive until you log a call, visit, email, or follow-up."
            icon={<CircleDot size={22} />}
            action={
              <ImportCsvDialog
                trigger={
                  <Button variant="accent">
                    <Upload size={13} /> Import PeopleFinder CSV
                  </Button>
                }
              />
            }
          />
        </Section>
      ) : (
        <>
          <Section bodyClassName="px-5 py-3">
            <LeadFilterChips
              filter={filter}
              onFilter={setFilter}
              showWindowTabs={leads.some((l) => l.best_visit_window || l.route_cluster)}
              cats={cats}
              selectedCats={selectedCats}
              onToggleCat={(c) =>
                setSelectedCats((prev) =>
                  prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
                )
              }
              countFor={countFor}
            />
          </Section>
          <Section
            title="Leads"
            right={
              <span className="font-mono text-[10px] text-txt-faint">
                {filtered.length} of {leads.length} shown · sorted by score
              </span>
            }
            bodyClassName="p-0"
          >
            <PokemonLeadTable
              leads={filtered}
              onOpen={openLead}
              onStageChange={(id, stage) => post({ action: "update_lead_stage", leadId: id, stage })}
            />
          </Section>
        </>
      )}
    </ProjectPage>
  );
}
