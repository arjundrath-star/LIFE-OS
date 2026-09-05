"use client";
import { useEffect, useRef, useState } from "react";
import { Copy, Plus } from "lucide-react";
import { StatusChip, StrengthDots, SourceBadge, SkeletonRows } from "@/components/stern/Page";
import { useApi } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import { DRAFT_KIND_LABELS, TOUCHPOINT_KIND_LABELS, HOW_MET_LABELS, PERSON_STATUSES, RELATIONSHIP_TYPES, statusLabel, type NetworkResponse, type PersonDetail, type SternSnapshot } from "@/lib/stern-types";
import { timeAgo } from "@/lib/time";
import { useNetworkVersion, Field, NetworkDialog, Toggle, networkAction, statusAllowed } from "./shared";

type Props = { id: number; clubs: NetworkResponse["clubs"]; onClose: () => void; onChange: () => void };
export function PersonDrawer({ id, clubs, onClose, onChange }: Props) {
  const { data: person, loading, error, refetch } = useApi<PersonDetail>(`/api/stern/network?person=${id}`);
  const live = useLiveData<SternSnapshot>("stern");
  const [addingAffiliation, setAddingAffiliation] = useState(false);
  const [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(""), [saved, setSaved] = useState(""), [noteState, setNoteState] = useState("");
  const dirty = useRef(false), saving = useRef<Promise<void> | null>(null), latestNotes = useRef("");
  useNetworkVersion(live?.network.version, refetch);
  useEffect(() => { if (person && !dirty.current) { setNotes(person.notes); latestNotes.current = person.notes; setSaved(person.notes); } }, [person]);
  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setNotice("");
    try { await networkAction(body); refetch(); onChange(); return true; }
    catch (e) { setNotice(e instanceof Error ? e.message : "Update failed"); return false; }
    finally { setBusy(false); }
  };
  const saveNotes = async (): Promise<void> => {
    if (saving.current) { await saving.current; if (dirty.current) return saveNotes(); return; }
    if (!dirty.current) return;
    const value = latestNotes.current;
    setNoteState("Saving…");
    const request = networkAction({ action: "person.update", id, patch: { notes: value } }).then(() => {
      setSaved(value); dirty.current = latestNotes.current !== value; setNoteState(dirty.current ? "Unsaved changes" : "Saved"); onChange();
    }).catch((e: unknown) => { setNoteState("Could not save notes. Retry below."); throw e; }).finally(() => { saving.current = null; });
    saving.current = request;
    return request;
  };
  useEffect(() => {
    if (notes === saved) return;
    const timer = setTimeout(() => { void saveNotes().catch(() => {}); }, 650);
    return () => clearTimeout(timer);
    // saveNotes uses refs so a live refresh never replaces an unsaved draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, saved]);
  const close = async () => { try { await saveNotes(); onClose(); } catch { setNotice("Notes have not saved. Retry before closing."); } };
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); setNotice("Copied"); } catch { setNotice("Copy unavailable. Select and copy the text."); } };
  return <NetworkDialog open onClose={() => { void close(); }} title={person?.display_name || "Person"} testId="stern-person-drawer">
    {loading && !person ? <SkeletonRows rows={8} /> : person ? <>
      <div className="stern-person-summary">
        <p>{[person.year, person.major].filter(Boolean).join(" · ") || "Year and major not added"}</p>
        <p>Met {person.met_event || (person.how_met ? HOW_MET_LABELS[person.how_met] : "—")} · <span className="stern-mono">{person.met_at ? new Date(person.met_at).toLocaleDateString() : "Date not added"}</span></p>
        <div className="stern-network-inline"><StatusChip value={person.relationship_type} className="stern-network-relationship" />{person.relationship_type !== "friend" && <button className="stern-network-text-button" disabled={busy} data-testid="stern-person-upgrade-friend" onClick={() => void mutate({ action: "person.upgrade_friend", id })}>Upgrade to Friend</button>}<span data-testid="stern-person-strength" aria-disabled={busy} className={busy ? "stern-network-disabled" : ""}><StrengthDots value={person.strength} editable onChange={strength => void mutate({ action: "person.set_relationship", id, relationshipType: person.relationship_type, strength })} /></span></div>
      </div>
      <div className="stern-person-body">
        {(notice || error) && <p role="status" className="stern-network-notice">{notice || error}</p>}
        <section><div className="stern-network-section-heading"><h3>Contact</h3><button className="stern-network-text-button" data-testid="stern-person-edit" onClick={() => setEditing(v => !v)}>{editing ? "Cancel edit" : "Edit person"}</button></div>
          <div className="stern-person-contacts" data-testid="stern-person-contacts">{([['email', 'Email'], ['email_alt', 'Alternate email'], ['phone', 'Phone'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn']] as const).map(([key, label]) => <div key={key}><small>{label}</small><span className={key === "phone" ? "stern-mono" : ""}>{person[key] || "Not added"}</span><button disabled={!person[key]} aria-label={`Copy ${label}`} data-testid={`stern-person-copy-${key}`} onClick={() => void copy(person[key])}><Copy size={14} /></button></div>)}</div>
          {editing && <form className="stern-network-form" onSubmit={async e => { e.preventDefault(); const form = new FormData(e.currentTarget); const patch = Object.fromEntries(form); if (await mutate({ action: "person.update", id, patch })) setEditing(false); }}>
            {([['display_name', 'Name'], ['year', 'Year'], ['major', 'Major'], ['org', 'Organization'], ['title', 'Title'], ['email', 'Email'], ['email_alt', 'Alternate email'], ['phone', 'Phone'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['next_action', 'Next action']] as const).map(([key, label]) => <Field key={key} label={label}><input className="stern-input" name={key} defaultValue={person[key]} required={key === 'display_name'} type={key.startsWith('email') ? 'email' : 'text'} data-testid={`stern-person-edit-${key}`} /></Field>)}
            <Field label="Relationship"><select name="relationship_type" className="stern-select" defaultValue={person.relationship_type} data-testid="stern-person-edit-relationship">{RELATIONSHIP_TYPES.map(r => <option key={r} value={r}>{statusLabel(r)}</option>)}</select></Field>
            <button type="submit" className="stern-btn primary" disabled={busy} data-testid="stern-person-save">Save person</button>
          </form>}
        </section>
        <section><div className="stern-network-section-heading"><h3>Affiliations</h3><button className="stern-network-text-button" data-testid="stern-person-affiliation-toggle" onClick={() => setAddingAffiliation(v => !v)}>{addingAffiliation ? "Cancel" : "Add affiliation"}</button></div><div data-testid="stern-person-affiliations">{!person.affiliations.length && <p className="stern-network-muted">No affiliations yet. Add a club or organization.</p>}{person.affiliations.map(a => <div key={a.id} className="stern-person-affiliation"><span className="stern-network-affiliation-chip">{a.club_name || a.org}{a.role && ` · ${a.role}`}</span>{a.is_eboard === 1 && <b className="stern-network-eboard">E-board</b>}<Toggle label="Relevant for recruiting" checked={!!a.relevant_for_recruiting} disabled={busy} onChange={value => void mutate({ action: "affiliation.update", id: a.id, patch: { relevantForRecruiting: value } })} testId={`stern-person-relevant-${a.id}`} /><button className="stern-network-text-button" disabled={busy} onClick={() => void mutate({ action: "affiliation.remove", id: a.id })} data-testid={`stern-person-affiliation-remove-${a.id}`}>Remove</button></div>)}</div>
          {addingAffiliation && <form className="stern-network-form" onSubmit={async e => { e.preventDefault(); const element = e.currentTarget; const f = new FormData(element); if (await mutate({ action: "affiliation.add", personId: id, affiliation: { clubId: Number(f.get("club")), org: f.get("org"), role: f.get("role"), isEboard: f.has("eboard"), relevantForRecruiting: f.has("relevant") } })) { element.reset(); setAddingAffiliation(false); } }}>
            <Field label="Club"><select className="stern-select" name="club" data-testid="stern-person-affiliation-club"><option value="0">Choose club or use organization</option>{clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="stern-network-two"><Field label="Organization"><input className="stern-input" name="org" data-testid="stern-person-affiliation-org" /></Field><Field label="Role"><input className="stern-input" name="role" data-testid="stern-person-affiliation-role" /></Field></div>
            <label><input type="checkbox" name="eboard" data-testid="stern-person-affiliation-eboard" /> E-board</label><label><input type="checkbox" name="relevant" data-testid="stern-person-affiliation-relevant" /> Relevant for recruiting</label>
            <button type="submit" className="stern-btn" disabled={busy} data-testid="stern-person-affiliation-add"><Plus size={14} />Add affiliation</button>
          </form>}
        </section>
        {person.mergedRecords.length > 0 && <section data-testid="stern-person-merged-records"><h3>Merged records: {person.mergedRecords.length} archived duplicates</h3><p className="stern-network-muted">Coffee chats and drafts on merged records remain available below.</p>{person.mergedRecords.map(p => <a className="stern-btn" data-testid={`stern-person-merged-${p.id}`} href={`/stern/network?person=${p.id}`} key={p.id}>{p.display_name}</a>)}</section>}
        <section><h3>Coffee chat</h3><div data-testid="stern-person-coffee-chats">{!person.coffeeChats.length && <p className="stern-network-muted">No coffee chats yet.</p>}{person.coffeeChats.map(chat => <div key={chat.id} className="stern-person-coffee"><span data-component="CoffeeChatChip"><StatusChip value={chat.state} /></span><dl><dt>Requested</dt><dd>{chat.requested_at ? new Date(chat.requested_at).toLocaleString() : "Not requested"}</dd><dt>Scheduled</dt><dd>{chat.scheduled_at ? new Date(chat.scheduled_at).toLocaleString() : "Not scheduled"}</dd><dt>Location</dt><dd>{chat.location || "Not added"}</dd><dt>Thank-you</dt><dd>{chat.thank_you_sent_at ? new Date(chat.thank_you_sent_at).toLocaleString() : "Not sent"}</dd></dl>{chat.takeaways && <p>{chat.takeaways}</p>}</div>)}</div>
          <div data-component="DraftPanel" className="stern-person-drafts" data-testid="stern-person-drafts">{!person.drafts.length && <p>No drafts yet</p>}{person.drafts.map(d => <article key={d.id}><div className="stern-network-inline"><strong>{DRAFT_KIND_LABELS[d.kind]} draft</strong><StatusChip value={d.state} /></div><b>{d.subject}</b><p>{d.body}</p><button type="button" className="stern-btn" onClick={() => void copy(d.body)} data-testid={`stern-person-draft-copy-${d.id}`}><Copy size={14} />Copy</button></article>)}</div>
        </section>
        <section><h3>Notes</h3><textarea className="stern-textarea" rows={5} value={notes} aria-label="Person notes" data-testid="stern-person-notes" onChange={e => { latestNotes.current = e.target.value; dirty.current = true; setNotes(e.target.value); setNoteState("Unsaved changes"); }} onBlur={() => void saveNotes().catch(() => {})} /><span role="status" className="stern-network-muted">{noteState || "Autosaves as you type"}</span>{noteState.startsWith("Could not") && <button className="stern-btn" data-testid="stern-person-notes-retry" onClick={() => void saveNotes().catch(() => {})}>Retry save</button>}</section>
        <section><h3>Touchpoints</h3><ol data-component="TouchpointTimeline" data-testid="stern-person-touchpoints" className="stern-person-timeline">{!person.touchpoints.length && <li className="stern-network-muted">No touchpoints yet. Add a note to record a conversation.</li>}{person.touchpoints.map(t => <li key={t.id}><div><strong>{t.summary || TOUCHPOINT_KIND_LABELS[t.kind]}</strong><time className="stern-mono" dateTime={t.occurred_at} title={t.occurred_at}>{timeAgo(t.occurred_at)}</time><SourceBadge source={t.source} /></div>{t.detail && <p>{t.detail}</p>}</li>)}</ol>
          <form className="stern-network-inline" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const summary = new FormData(form).get("summary"); if (await mutate({ action: "touchpoint.add", personId: id, kind: "note", summary })) form.reset(); }}><input className="stern-input" name="summary" required placeholder="Add a touchpoint note" aria-label="Touchpoint note" data-testid="stern-person-touchpoint-note" /><button type="submit" className="stern-btn" disabled={busy} data-testid="stern-person-touchpoint-add">Add</button></form>
        </section>
      </div>
      <footer className="stern-person-footer"><select className="stern-select" aria-label="Set status" value={person.status} disabled={busy} onChange={e => void mutate({ action: "person.set_status", id, status: e.target.value })} data-testid="stern-person-status">{PERSON_STATUSES.map(s => <option key={s} value={s} disabled={!statusAllowed(person.status, s)}>{statusLabel(s)}</option>)}</select><button type="button" className="stern-btn" data-testid="stern-person-add-task" onClick={() => window.dispatchEvent(new CustomEvent("stern:quick-add", { detail: { segment: "Task", personId: id } }))}>Add task</button><button type="button" className="stern-btn ghost" disabled={busy || !!person.archived} data-testid="stern-person-archive" onClick={async () => { try { await saveNotes(); if (await mutate({ action: "person.archive", id })) onClose(); } catch { setNotice("Save notes before archiving."); } }}>{person.archived ? "Archived" : "Archive"}</button></footer>
    </> : <p role="alert" className="stern-person-body">{error?.includes("(404)") ? "Person not found" : error || "Person not found"}</p>}
  </NetworkDialog>;
}
