// Server read models: resolve names without changing stored audit evidence.
import { getDb } from '@/db';
import { statusLabel, type SternSuggestion } from '@/lib/stern-types';

const LABEL_QUERIES: Record<string, string> = {
  person: 'SELECT display_name label FROM people WHERE id=?',
  coffee_chat: 'SELECT p.display_name label FROM coffee_chats c JOIN people p ON p.id=c.person_id WHERE c.id=?',
  club: 'SELECT name label FROM stern_clubs WHERE id=?',
  program: "SELECT c.name || ' · ' || p.name label FROM stern_programs p JOIN stern_clubs c ON c.id=p.club_id WHERE p.id=?",
  course: 'SELECT code label FROM courses WHERE id=?',
  assignment: 'SELECT title label FROM assignments WHERE id=?',
  task: 'SELECT title label FROM stern_tasks WHERE id=?',
  draft: 'SELECT subject label FROM stern_drafts WHERE id=?',
  calendar_event: 'SELECT title label FROM stern_calendar_events WHERE id=?',
  process: 'SELECT name label FROM stern_processes WHERE id=?',
};
export function entityLabel(type: string, id: number): string {
  const sql = LABEL_QUERIES[type];
  const row = sql ? getDb().prepare(sql).get(id) as {label:string}|undefined : undefined;
  return row?.label || `${statusLabel(type) || 'Record'} #${id}`;
}
export function labelAuditRows<T extends {entity_type:string;entity_id:number}>(rows:T[]): (T & {entity_label:string})[] {
  const labels = new Map<string,string>();
  return rows.map(row => {
    const key = `${row.entity_type}:${row.entity_id}`;
    if (!labels.has(key)) labels.set(key, entityLabel(row.entity_type,row.entity_id));
    return {...row,entity_label:labels.get(key)!};
  });
}

export function suggestionSummary(row: Omit<SternSuggestion,'summary'>): string {
  const fallback = statusLabel(row.suggestion_type);
  try {
    const parsed = JSON.parse(row.proposed_data);
    const effects = Array.isArray(parsed) ? parsed : [parsed];
    const summaries = effects.map(effect => {
      if (!effect || typeof effect !== 'object') return fallback;
      const label = row.entity_id ? entityLabel(row.entity_type,row.entity_id) : '';
      if (effect.state || effect.status) return `Mark ${label || 'record'} as ${statusLabel(effect.state || effect.status)}`;
      if (effect.kind === 'calendar_create') return `Create calendar event: ${effect.intent?.title || 'Coffee chat'}`;
      if (effect.kind === 'program_window') return `Update dates for ${entityLabel('program',effect.programId)}`;
      const cls = effect.classification;
      if (cls) {
        const name = cls.people?.map((p:{name:string}) => p.name).filter(Boolean).join(', ') || label || cls.club || 'contact';
        const states:Record<string,string> = {coffee_chat_request_sent:'requested',coffee_chat_reply_positive:'reply_received',coffee_chat_reply_negative:'declined',thank_you_sent:'thank_you_sent',club_application_confirmation:'submitted',club_interview_invite:'interview_invited',club_result_accepted:'accepted',club_result_rejected:'rejected'};
        const target = effect.kind === 'program' ? cls.club || name : name;
        if (effect.kind === 'coffee' && cls.confirmed_time && ['coffee_chat_reply_positive','scheduling_confirmed','calendar_invite'].includes(cls.category)) return `Schedule coffee chat with ${name}`;
        if (cls.category === 'scheduling_proposal' && cls.direction === 'inbound') return `Mark ${name} as ${statusLabel('reply_received')}`;
        if (states[cls.category]) return `Mark ${target} as ${statusLabel(states[cls.category])}`;
        if (cls.assignment?.title) return `Update assignment: ${cls.assignment.title}`;
        if (cls.tasks?.length) return `Create tasks: ${cls.tasks.map((t:{title:string})=>t.title).join(', ')}`;
        return `${statusLabel(cls.category)}${cls.club ? ` · ${cls.club}` : name !== 'contact' ? ` · ${name}` : ''}`;
      }
      return label ? `${fallback} · ${label}` : fallback;
    });
    return [...new Set<string>(summaries)].join('; ') || fallback;
  } catch { return fallback; }
}
