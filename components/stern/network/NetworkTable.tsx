"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Instagram, Linkedin, Mail, Phone, Plus, Search, Users } from "lucide-react";
import { SternPage, StatusChip, StrengthDots, EmptyState, SkeletonRows } from "@/components/stern/Page";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { PERSON_STATUSES, RELATIONSHIP_TYPES, SPHERES, statusLabel, type NetworkResponse, type SternSnapshot } from "@/lib/stern-types";
import { timeAgo } from "@/lib/time";
import { PersonDrawer } from "./PersonDrawer";
import { useNetworkVersion, Toggle } from "./shared";

export function NetworkTable() {
  const router = useRouter(), params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || ""), [relationships, setRelationships] = useState<string[]>([]);
  const [strength, setStrength] = useState(""), [club, setClub] = useState(""), [status, setStatus] = useState("");
  const [sphere, setSphere] = useState(""), [owed, setOwed] = useState(false), [archived, setArchived] = useState(false), [sort, setSort] = useState("name"), [page, setPage] = useState(1);
  const query = new URLSearchParams({ q, sort, page: String(page) });
  if (relationships.length) query.set("relationshipType", relationships.join(","));
  if (strength) query.set("strengthMin", strength); if (club) query.set("clubId", club); if (status) query.set("status", status); if (sphere) query.set("sphere", sphere); if (owed) query.set("followUpOwed", "1"); if (archived) query.set("archived", "1");
  const { data, loading, error, refetch } = useApi<NetworkResponse>(`/api/stern/network?${query}`);
  useEffect(() => { window.addEventListener("stern:network-changed", refetch); return () => window.removeEventListener("stern:network-changed", refetch); }, [refetch]);
  const live = useLiveData<SternSnapshot>("stern");
  useNetworkVersion(live?.network.version, refetch);
  useEffect(() => setPage(1), [q, relationships, strength, club, status, sphere, owed, archived, sort]);
  const personId = Number(params.get("person")) || null;
  const selectPerson = (id: number | null) => { const next = new URLSearchParams(params.toString()); if (id) next.set("person", String(id)); else next.delete("person"); router.replace(`/stern/network${next.size ? `?${next}` : ""}`, { scroll: false }); };
  const quickAdd = () => window.dispatchEvent(new CustomEvent("stern:quick-add"));
  const select = (label: string, value: string, change: (v: string) => void, options: { value: string; label: string }[]) => <select className="stern-select" aria-label={label} data-testid={`stern-network-${label.toLowerCase()}`} value={value} onChange={e => change(e.target.value)}><option value="">{label}: any</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  return <SternPage title="Network" subtitle={<span className="stern-mono">{data?.counts.total ?? "—"} people</span>} testId="stern-network" actions={<><a className="stern-btn" href={`/api/stern/network?${query}&export=csv`} data-testid="stern-network-export-csv">Export CSV</a><a className="stern-btn" href={`/api/stern/network?${query}&export=json`} data-testid="stern-network-export-json">Export JSON</a><button type="button" className="stern-btn primary" onClick={quickAdd} data-testid="stern-network-add"><Plus size={14} />Quick add</button></>}>
    <div className="stern-network-filters" data-testid="stern-network-filters">
      <div className="stern-network-chips"><button className={!relationships.length ? "active" : ""} data-testid="stern-network-relationship-all" aria-pressed={!relationships.length} onClick={() => setRelationships([])}>All</button>{RELATIONSHIP_TYPES.map(type => <button key={type} className={relationships.includes(type) ? "active" : ""} data-testid={`stern-network-relationship-${type}`} aria-pressed={relationships.includes(type)} onClick={() => setRelationships(v => v.includes(type) ? v.filter(t => t !== type) : [...v, type])}>{statusLabel(type)}</button>)}</div>
      {select("Strength", strength, setStrength, [1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n}+` })))}
      {select("Club", club, setClub, (data?.clubs || []).map(c => ({ value: String(c.id), label: c.name })))}
      {select("Status", status, setStatus, PERSON_STATUSES.map(s => ({ value: s, label: statusLabel(s) })))}
      {select("Sphere", sphere, setSphere, SPHERES.map(s => ({ value: s, label: statusLabel(s) })))}
      <Toggle label="Follow-up owed" checked={owed} onChange={setOwed} testId="stern-network-follow-up" />
      <Toggle label="Archived" checked={archived} onChange={setArchived} testId="stern-network-archived" />
      <label className="stern-network-search"><Search size={14} /><input className="stern-input" aria-label="Search people" placeholder="Search people" value={q} onChange={e => setQ(e.target.value)} data-testid="stern-network-search" /></label>
      <select className="stern-select" aria-label="Sort people" value={sort} onChange={e => setSort(e.target.value)} data-testid="stern-network-sort"><option value="name">Name</option><option value="recent">Recently added</option><option value="strength">Strength</option><option value="last_contact">Last contact</option></select>
    </div>
    {error && <p role="alert">{error} <button className="stern-btn" data-testid="stern-network-retry" onClick={refetch}>Retry</button></p>}
    {loading && !data ? <SkeletonRows rows={8} /> : data && <div className="stern-network-table-wrap">
      <table className="stern-network-table" data-testid="stern-network-table"><thead><tr>{["Name", "Affiliation", "Relationship", "Strength", "Status", "Last contact", "Next action", "Contact"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>
        {data.people.map(p => <tr key={p.id} data-testid="stern-network-row" data-person-id={p.id} onClick={() => selectPerson(p.id)}>
          <td><button className="stern-network-person-link" data-testid={`stern-network-open-${p.id}`} onClick={e => { e.stopPropagation(); selectPerson(p.id); }}><span className="stern-network-initials">{p.display_name.split(/\s+/).slice(0, 2).map(n => n[0]).join("")}</span>{p.display_name}</button></td>
          <td>{p.affiliations.length ? p.affiliations.map(a => <div key={a.id} className="stern-network-affiliation"><span>{a.club_name || a.org} {a.is_eboard === 1 && <b className="stern-network-eboard">E-board</b>}</span>{a.role && <small>{a.role}</small>}</div>) : p.org || "—"}</td>
          <td><StatusChip value={p.relationship_type} className="stern-network-relationship" /></td><td><StrengthDots value={p.strength} /></td><td><StatusChip value={p.status} /></td>
          <td className="stern-mono" title={p.last_contact_at}>{p.last_contact_at ? timeAgo(p.last_contact_at) : "—"}</td><td>{p.next_action || "—"}<span className="stern-network-row-actions"><button type="button" className="stern-btn" data-testid={`stern-network-task-${p.id}`} onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("stern:quick-add", { detail: { segment: "Task", personId: p.id } })); }}>Add task</button><button type="button" className="stern-btn" data-testid={`stern-network-status-${p.id}`} onClick={e => { e.stopPropagation(); selectPerson(p.id); }}>Set status</button></span></td>
          <td><span className="stern-network-contact-icons">{([["email", Mail], ["phone", Phone], ["instagram", Instagram], ["linkedin", Linkedin]] as const).map(([key, Icon]) => <Icon key={key} size={14} opacity={p[key] ? 1 : .25} aria-label={`${key}${p[key] ? " available" : " missing"}`} />)}</span></td>
        </tr>)}
      </tbody></table>
      {!data.people.length && <EmptyState icon={<Users size={22} />} title={data.counts.total === 0 && !archived ? "No people yet. Text the Stern bot or use Quick add." : "No people match these filters."} hint={data.counts.total ? "Try another search or clear a filter." : undefined} testId="stern-network-empty" action={<button type="button" className="stern-btn" onClick={quickAdd} data-testid="stern-network-empty-add">Quick add</button>} />}
      <footer className="stern-network-pagination"><span className="stern-mono">{data.total ? (data.page - 1) * data.pageSize + 1 : 0}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}</span><span><button type="button" className="stern-btn ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)} data-testid="stern-network-previous">Previous</button><button type="button" className="stern-btn ghost" disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)} data-testid="stern-network-next">Next</button></span></footer>
    </div>}
    {personId && <PersonDrawer key={personId} id={personId} clubs={data?.clubs || []} onClose={() => selectPerson(null)} onChange={refetch} />}
  </SternPage>;
}
