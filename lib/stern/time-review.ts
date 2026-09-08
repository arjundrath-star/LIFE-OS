import { getDb, nowIso } from '@/db';
import { type AuditMeta } from './audit';
import { insert } from './recruiting-write';
import { parseEventTime } from './time';

export function resolveTime(value:string, field:string, entityType:string, entityId:number, audit:AuditMeta, referenceIso?:string):string | null {
  const evidence = audit.gmailMessageId ? getDb().prepare('SELECT internal_date FROM stern_email_messages WHERE gmail_account=? AND gmail_message_id=?').get(audit.gmailAccount || '',audit.gmailMessageId) as {internal_date:number}|undefined : undefined;
  const reference = referenceIso || (evidence?.internal_date ? new Date(evidence.internal_date).toISOString() : nowIso());
  const parsed = parseEventTime(value, reference);
  if(parsed) return parsed.iso;
  const key=`time-review:${audit.batchId}:${entityType}:${entityId}:${field}`;
  if(!getDb().prepare('SELECT 1 FROM stern_suggestions WHERE dedupe_key=?').get(key)) insert('suggestion',{dedupe_key:key,suggestion_type:'time_parse_review',entity_type:entityType,entity_id:entityId,
    evidence_type:audit.gmailMessageId?'gmail':'manual',gmail_account:audit.gmailAccount || '',gmail_message_id:audit.gmailMessageId || '',
    proposed_data:JSON.stringify({field,raw:value,referenceIso:reference}),evidence_excerpt:`Unparsed ${field}: ${value}`.slice(0,300)},audit);
  return null;
}
