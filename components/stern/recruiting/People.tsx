"use client";
import { useState } from "react";
import { Mail, Plus } from "lucide-react";
import { apiPost } from "@/hooks/useApi";
import { EmptyState, StatusChip } from "@/components/stern/Page";
import { CHAT_TRANSITIONS, type CoffeeChat, type RecruitingClubDetail } from "@/lib/stern-types";
import { RecruitingButton, RecruitingDialog, Field, dateLabel, StatusSelect } from "./Controls";
import type { RecruitingMutation } from "./useRecruiting";

export function CoffeeChatChip({ chat }: { chat: CoffeeChat | null }) {
  return <span data-component="CoffeeChatChip" data-testid="stern-chat-chip">{chat ? <StatusChip value={chat.state}/> : <span className="stern-muted">No chat tracked</span>}</span>;
}
export function People({ club, disabled, draftsAvailable, mutate, compact = false, error }: { error?: string; club: RecruitingClubDetail; disabled: boolean; draftsAvailable: boolean; mutate: RecruitingMutation; compact?: boolean }) {
  const [scheduling, setScheduling] = useState<number | null>(null); const [notice, setNotice] = useState(""); const [draftBusy, setDraftBusy] = useState(false);
  return <>
    {notice && <p role="status" className="stern-muted">{notice}</p>}
    {!club.people.length ? <EmptyState title="No E-board people linked yet" hint="Add people in Network with this club affiliation and mark them as E-board."/> : <div className="stern-people-list" data-testid="stern-club-people-list">{club.people.map(person => <article key={person.id} className="stern-person-row" data-component="PersonRow">
      <div className="stern-person-heading"><span className="stern-avatar">{person.display_name.split(/\s+/).slice(0,2).map(n => n[0]).join("")}</span><div><strong>{person.display_name}</strong><small>{person.role || person.title || "E-board"}{person.year ? ` · ${person.year}` : ""}</small></div><CoffeeChatChip chat={person.chat}/></div>
      <div className="stern-person-actions">
        {!person.chat ? <RecruitingButton data-testid={`stern-chat-create-${person.id}`} disabled={disabled} onClick={() => void mutate({ action: "chat.create", personId: person.id, clubId: club.id })}><Plus size={12}/>Track coffee chat</RecruitingButton> : <StatusSelect testId={`stern-chat-state-${person.chat.id}`} label={`Record chat status for ${person.display_name}`} disabled={disabled} value={person.chat.state} choices={CHAT_TRANSITIONS[person.chat.state]} onChange={state => { if (state === "scheduled") setScheduling(person.chat!.id); else void mutate({ action: "chat.transition", chatId: person.chat!.id, state }); }}/>} 
        <span title={!draftsAvailable ? "drafts arrive with automation" : !person.email ? "Add an email address in Network" : "Generate a draft for review"}><RecruitingButton data-testid={`stern-chat-draft-${person.id}`} disabled={disabled || draftBusy || !draftsAvailable || !person.email} onClick={async () => {
          setDraftBusy(true); setNotice("");
          try { await apiPost("/api/stern/network", { action: "drafts.request", personId: person.id, clubId: club.id, coffeeChatId: person.chat?.id }); setNotice("Draft requested. Review it in Network."); }
          catch (e) { setNotice(e instanceof Error ? e.message : "Draft request failed"); }
          finally { setDraftBusy(false); }
        }}><Mail size={12}/>Draft email</RecruitingButton></span>
      </div>
      {person.chat && !compact && <>
        <dl className="stern-chat-dates">{([ ["Requested", person.chat.requested_at], ["Reply", person.chat.reply_at], ["Scheduled", person.chat.scheduled_at], ["Occurred", person.chat.occurred_at], ["Thank-you sent", person.chat.thank_you_sent_at] ] as const).filter(([,date]) => date).map(([label,date]) => <div key={label}><dt>{label}</dt><dd className="stern-mono">{dateLabel(date, true)}</dd></div>)}</dl>
        <form className="stern-form-stack" onSubmit={async e => { e.preventDefault(); await mutate({ action: "chat.update", chatId: person.chat!.id, patch: Object.fromEntries(new FormData(e.currentTarget)) }); }}>
          <fieldset disabled={disabled}><Field label="Location"><input className="stern-input" data-testid={`stern-chat-location-${person.chat.id}`} name="location" defaultValue={person.chat.location} key={person.chat.location}/></Field><Field label="Prep notes"><textarea className="stern-textarea" rows={2} data-testid={`stern-chat-prep-${person.chat.id}`} name="prep_notes" defaultValue={person.chat.prep_notes} key={person.chat.prep_notes}/></Field><Field label="Takeaways"><textarea className="stern-textarea" rows={2} data-testid={`stern-chat-takeaways-${person.chat.id}`} name="takeaways" defaultValue={person.chat.takeaways} key={person.chat.takeaways}/></Field><RecruitingButton data-testid={`stern-chat-save-${person.chat.id}`} type="submit">Save chat notes</RecruitingButton></fieldset>
        </form>
      </>}
    </article>)}</div>}
    <RecruitingDialog error={error} title="Record scheduled coffee chat" open={scheduling !== null} onOpenChange={open => { if (!open) setScheduling(null); }}><p>Record the agreed time in New York. This does not send an invitation.</p><form className="stern-form-stack" onSubmit={async e => { e.preventDefault(); const form = new FormData(e.currentTarget); if (await mutate({ action: "chat.transition", chatId: scheduling, state: "scheduled", meta: { scheduled_at: form.get("scheduled_at"), location: form.get("location") } })) setScheduling(null); }}><Field label="Date and time with timezone"><input required className="stern-input stern-mono" name="scheduled_at" data-testid="stern-chat-scheduled-at" placeholder="2026-09-08T14:00:00-04:00"/></Field><Field label="Location"><input className="stern-input" name="location" data-testid="stern-chat-scheduled-location"/></Field><RecruitingButton primary data-testid="stern-chat-schedule-save" disabled={disabled} type="submit">Save scheduled chat</RecruitingButton></form></RecruitingDialog>
  </>;
}
