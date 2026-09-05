"use client";
import { PROGRAM_TRANSITIONS, type RecruitingProgram } from "@/lib/stern-types";
import { StatusChip } from "@/components/stern/Page";
import { Field, dateLabel, SafeLink, StatusSelect, RecruitingButton } from "./Controls";
import type { RecruitingMutation } from "./useRecruiting";

const DATES = [
  ["app_opens_at", "Applications open"], ["app_deadline_at", "Application deadline"], ["interview_start", "Interviews start"],
  ["interview_end", "Interviews end"], ["decision_at", "Decision date"], ["interview_at", "Your interview time"],
] as const;
export function ProgramCard({ program, editing = false, disabled, mutate }: { program: RecruitingProgram; editing?: boolean; disabled: boolean; mutate: RecruitingMutation }) {
  return <article className="stern-panel stern-program-card" data-component="ProgramCard" data-testid="stern-program-card">
    <header><h3>{program.name}</h3><StatusChip value={program.status}/></header>
    {editing ? <form data-testid={`stern-program-form-${program.id}`} className="stern-form-stack" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget; const values = Object.fromEntries(new FormData(form));
      await mutate({ action: "program.upsert", program: { id: program.id, ...values } });
    }}>
      <fieldset disabled={disabled}>
        <Field label="Program name"><input className="stern-input" data-testid={`stern-program-name-${program.id}`} name="name" defaultValue={program.name} key={program.name} required/></Field>
        <div className="stern-form-grid">{DATES.map(([field,label]) => <Field key={field} label={label}><input className="stern-input stern-mono" data-testid={`stern-program-${field}-${program.id}`} name={field} defaultValue={program[field]} key={program[field]} placeholder={field === "interview_at" ? "2026-09-22T14:00:00-04:00" : "YYYY-MM-DD or ISO time with offset"}/></Field>)}</div>
        <p className="stern-muted">Dates are in New York time. A date-only application deadline closes at the end of that day. Exact times need a timezone offset.</p>
        <Field label="Application URL"><input className="stern-input" type="url" data-testid={`stern-program-url-${program.id}`} name="application_url" defaultValue={program.application_url} key={program.application_url} placeholder="https://"/></Field>
        <Field label="Requirements"><textarea className="stern-textarea" data-testid={`stern-program-requirements-${program.id}`} name="requirements" defaultValue={program.requirements} key={program.requirements} rows={3} placeholder="Add each requirement on a new line"/></Field>
        <Field label="Dress code"><input className="stern-input" data-testid={`stern-program-dress-${program.id}`} name="dress_code" defaultValue={program.dress_code} key={program.dress_code} placeholder="Not specified yet"/></Field>
        <Field label="Interview location"><input className="stern-input" data-testid={`stern-program-location-${program.id}`} name="interview_location" defaultValue={program.interview_location} key={program.interview_location}/></Field>
        <Field label="Notes"><textarea className="stern-textarea" data-testid={`stern-program-notes-${program.id}`} name="notes" defaultValue={program.notes} key={program.notes} rows={3}/></Field>
        <RecruitingButton primary type="submit" data-testid={`stern-program-save-${program.id}`}>Save application</RecruitingButton>
      </fieldset>
    </form> : <>
      <dl className="stern-program-facts"><dt>Opens</dt><dd className="stern-mono">{dateLabel(program.app_opens_at, true)}</dd><dt>Closes</dt><dd className="stern-mono">{dateLabel(program.app_deadline_at, true)}{/^\d{4}-\d{2}-\d{2}$/.test(program.app_deadline_at) ? ", end of day ET" : ""}</dd><dt>Interviews</dt><dd className="stern-mono">{dateLabel(program.interview_start)} to {dateLabel(program.interview_end)}</dd><dt>Decision</dt><dd className="stern-mono">{dateLabel(program.decision_at)}</dd><dt>Dress code</dt><dd>{program.dress_code || "Not specified yet"}</dd><dt>Application</dt><dd><SafeLink href={program.application_url} testId={`stern-program-link-${program.id}`}>Form link</SafeLink></dd></dl>
      <div className="stern-requirements"><strong>Requirements</strong>{program.requirements ? <ul data-testid={`stern-program-requirements-list-${program.id}`}>{program.requirements.split("\n").filter(Boolean).map((line,i) => <li key={i}>{line}</li>)}</ul> : <p className="stern-muted">No requirements added yet.</p>}</div>
    </>}
    <Field label="Program status"><StatusSelect testId={`stern-program-status-${program.id}`} label={`${program.name} status`} disabled={disabled} value={program.status} choices={PROGRAM_TRANSITIONS[program.status]} onChange={status => void mutate({ action: "program.set_status", programId: program.id, status })}/></Field>
  </article>;
}
