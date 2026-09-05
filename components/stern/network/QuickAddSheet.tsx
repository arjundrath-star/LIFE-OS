"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui";
import { SkeletonRows } from "@/components/stern/Page";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { HOW_MET, HOW_MET_LABELS, RELATIONSHIP_TYPES, statusLabel, type NetworkResponse, type SternSnapshot } from "@/lib/stern-types";
import { Field, NetworkDialog, Toggle, networkAction } from "./shared";

type Segment = "Person" | "Task" | "Note";
export function QuickAddSheet() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const [open, setOpen] = useState(false), [segment, setSegment] = useState<Segment>("Person"), [personId, setPersonId] = useState(0);
  useEffect(() => { if (params.get("add") === "1") setOpen(true); }, [params]);
  useEffect(() => {
    const handler = (event: Event) => { const detail = (event as CustomEvent<{ segment?: Segment; personId?: number }>).detail; setSegment(detail?.segment || "Person"); setPersonId(detail?.personId || 0); setOpen(true); };
    window.addEventListener("stern:quick-add", handler); return () => window.removeEventListener("stern:quick-add", handler);
  }, []);
  const close = () => { setOpen(false); if (params.has("add")) { const next = new URLSearchParams(params.toString()); next.delete("add"); router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }); } };
  return open ? <QuickAddForm segment={segment} setSegment={setSegment} personId={personId} onClose={close} /> : null;
}
function QuickAddForm({ segment, setSegment, personId, onClose }: { segment: Segment; setSegment: (value: Segment) => void; personId: number; onClose: () => void }) {
  const [query, setQuery] = useState(""), [selectedPerson, setSelectedPerson] = useState(personId);
  const { data, loading, error, refetch } = useApi<NetworkResponse>(`/api/stern/network?q=${encodeURIComponent(query)}`);
  const live = useLiveData<SternSnapshot>("stern");
  useEffect(() => { if (live) refetch(); }, [live, refetch]);
  const [eboard, setEboard] = useState(false), [reachOut, setReachOut] = useState(false), [relationship, setRelationship] = useState("general_connect");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  // datetime-local uses the viewer's local zone, then converts to ISO on save.
  const [metAt] = useState(() => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); });
  useEffect(() => {
    const update = () => { const v = window.visualViewport; const el = document.querySelector<HTMLElement>('[data-testid="stern-quick-add"]'); if (v && el) { el.style.setProperty("--stern-viewport-height", `${v.height}px`); el.style.setProperty("--stern-viewport-top", `${v.offsetTop}px`); } };
    update(); window.visualViewport?.addEventListener("resize", update); window.visualViewport?.addEventListener("scroll", update);
    return () => { window.visualViewport?.removeEventListener("resize", update); window.visualViewport?.removeEventListener("scroll", update); };
  }, []);
  return <NetworkDialog open onClose={() => { if (!busy) onClose(); }} title="Quick add" sheet testId="stern-quick-add">
    <div className="stern-add-segments" role="group" aria-label="Capture type">{(["Person", "Task", "Note"] as const).map(s => <button key={s} type="button" disabled={busy} className={segment === s ? "active" : ""} aria-pressed={segment === s} onClick={() => { setSegment(s); setNotice(""); }} data-testid={`stern-quick-add-${s.toLowerCase()}`}>{s}</button>)}</div>
    <form className="stern-add-form" onSubmit={async e => {
      e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setNotice("");
      try {
        if (segment === "Person") {
          const clubId = Number(form.get("clubId")), org = String(form.get("org") || "");
          const person = { display_name: form.get("name"), met_at: new Date(String(form.get("met_at"))).toISOString(), met_event: form.get("met_event"), how_met: form.get("how_met"), org: data?.clubs.find(c => c.id === clubId)?.name || org, title: form.get("role"), relationship_type: relationship, email: form.get("email"), phone: form.get("phone"), instagram: form.get("instagram"), linkedin: form.get("linkedin"), status: reachOut ? "need_to_reach_out" : "met" };
          await networkAction({ action: "person.create", person, ...((clubId || org) ? { affiliation: { clubId, org, role: form.get("role"), isEboard: eboard, relevantForRecruiting: !!clubId } } : {}) });
        } else if (segment === "Note") {
          await networkAction({ action: "touchpoint.add", personId: selectedPerson, kind: "note", summary: form.get("summary"), detail: form.get("detail") });
        } else {
          const task = { title: form.get("title"), domain: form.get("domain"), due_at: form.get("due_at") ? new Date(String(form.get("due_at"))).toISOString() : "", person_id: selectedPerson, notes: form.get("detail") };
          const response = await fetch("/api/stern/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "task.create", task }) });
          if (response.status === 404) throw new Error("Tasks arrive with the next package");
          const payload = await response.json().catch(() => null);
          if (!response.ok) throw new Error(payload?.error || `Could not save task (${response.status})`);
        }
        window.dispatchEvent(new CustomEvent("stern:network-changed")); onClose();
      } catch (e) { setNotice(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
    }}>
      <div className="stern-add-fields">
        {notice && <p role="alert" data-testid="stern-quick-add-notice">{notice}</p>}
        {error && <p role="alert">{error} <button type="button" className="stern-btn" data-testid="stern-quick-add-retry" onClick={refetch}>Retry</button></p>}
        {segment === "Person" ? <>
          <Field label="Name"><input autoFocus required className="stern-input" name="name" autoComplete="off" data-testid="stern-quick-add-name" /></Field>
          <div className="stern-network-two"><Field label="Met at"><input className="stern-input" name="met_event" placeholder="Event or place" list="stern-met-events" data-testid="stern-quick-add-event" /><datalist id="stern-met-events">{(data?.clubs || []).map(c => <option key={c.id} value={`${c.name} general meeting`} />)}</datalist></Field><Field label="Date and time"><input required className="stern-input stern-mono" type="datetime-local" name="met_at" defaultValue={metAt} data-testid="stern-quick-add-met-at" /></Field></div>
          <Field label="How met"><select className="stern-select" name="how_met" data-testid="stern-quick-add-how-met"><option value="">Choose how you met</option>{HOW_MET.map(h => <option key={h} value={h}>{HOW_MET_LABELS[h]}</option>)}</select></Field>
          {loading && !data ? <SkeletonRows rows={1} /> : <Field label="Club"><select className="stern-select" name="clubId" data-testid="stern-quick-add-club"><option value="0">Choose a club</option>{(data?.clubs || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
          <div className="stern-network-two"><Field label="Or organization"><input className="stern-input" name="org" data-testid="stern-quick-add-org" /></Field><Field label="Role"><input className="stern-input" name="role" data-testid="stern-quick-add-role" /></Field></div>
          <Toggle label="E-board" checked={eboard} onChange={setEboard} testId="stern-quick-add-eboard" />
          <Field label="Relationship"><div className="stern-network-chips">{RELATIONSHIP_TYPES.map(r => <button key={r} type="button" aria-pressed={relationship === r} className={relationship === r ? "active" : ""} onClick={() => setRelationship(r)} data-testid={`stern-quick-add-relationship-${r}`}>{statusLabel(r)}</button>)}</div></Field>
          <div className="stern-network-two">{([['email', 'Email', 'email'], ['instagram', 'Instagram', 'text'], ['phone', 'Phone', 'tel'], ['linkedin', 'LinkedIn', 'text']] as const).map(([name, label, type]) => <Field key={name} label={label}><input className="stern-input" name={name} type={type} data-testid={`stern-quick-add-${name}`} /></Field>)}</div>
          <Toggle label="Need to reach out for coffee chat" checked={reachOut} onChange={setReachOut} testId="stern-quick-add-reach-out" />
        </> : <>
          <Field label="Find person"><input className="stern-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name, email, or organization" data-testid="stern-quick-add-person-search" /></Field>
          <Field label={segment === "Note" ? "Person (required)" : "Related person"}><select className="stern-select" required={segment === "Note"} value={selectedPerson || ""} onChange={e => setSelectedPerson(Number(e.target.value))} data-testid="stern-quick-add-person-select"><option value="">Choose a person</option>{selectedPerson && !data?.people.some(p => p.id === selectedPerson) ? <option value={selectedPerson}>Selected person #{selectedPerson}</option> : null}{(data?.people || []).map(p => <option value={p.id} key={p.id}>{p.display_name}</option>)}</select></Field>
          {segment === "Task" ? <><Field label="Task"><input required className="stern-input" name="title" data-testid="stern-quick-add-task-title" /></Field><Field label="Domain"><select className="stern-select" name="domain" defaultValue="professional" data-testid="stern-quick-add-task-domain"><option value="professional">Professional</option><option value="academic">Academic</option><option value="campus">Campus</option></select></Field><Field label="Due"><input className="stern-input" type="datetime-local" name="due_at" data-testid="stern-quick-add-task-due" /></Field></> : <Field label="Note"><input required className="stern-input" name="summary" data-testid="stern-quick-add-note-summary" /></Field>}
          <Field label="Details"><textarea className="stern-textarea" name="detail" rows={4} data-testid="stern-quick-add-details" /></Field>
        </>}
      </div>
      <footer><Button className="stern-btn primary" disabled={busy || (segment === "Note" && !selectedPerson)} data-testid="stern-quick-add-save">{busy ? "Saving…" : "Save"}</Button></footer>
    </form>
  </NetworkDialog>;
}
