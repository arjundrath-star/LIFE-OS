import { getDb, kvGet, kvSet } from '@/db';
import { nyDateKey, nyDayBounds, nyWallTime } from './time';
import { queueReminder, reminderMeta } from './reminder-store';

export function googleConsent(email:string):string {
  return kvGet<string>(`stern.google_consent.${email.toLowerCase()}`) ||
    (getDb().prepare('SELECT added_at FROM google_accounts WHERE lower(email)=?').get(email.toLowerCase()) as {added_at:string}|undefined)?.added_at || '';
}
export function recordGoogleConsent(email:string, now=new Date()) {
  getDb().transaction(()=>kvSet(`stern.google_consent.${email.toLowerCase()}`,now.toISOString())).immediate();
}
export function googleExpiryDays(email:string,now=new Date()):number | undefined {
  const consent=Date.parse(googleConsent(email));
  return Number.isFinite(consent) ? Math.max(0,Math.ceil((consent+7*86400000-now.getTime())/86400000)) : undefined;
}
export function queueGoogleReauth(email:string,now=new Date(),invalidGrant=false) {
  const consent=googleConsent(email); if(!consent || !Number.isFinite(Date.parse(consent))) return false;
  const due=nyWallTime(nyDayBounds(consent,6).dateKey,'09:00');
  if(!invalidGrant && now<due) return false;
  const day=nyDateKey(now),account=email.toLowerCase(),audit=reminderMeta();
  const link=`https://rathworkspace.cloud/api/google/connect?set=stern&login_hint=${encodeURIComponent(account)}`;
  return getDb().transaction(()=>{
    // One reminder per account/local date, including a day-six reminder followed by invalid_grant.
    const key=`google_reauth_due:${account}:${day}`;
    if(getDb().prepare("SELECT 1 FROM stern_reminders WHERE rule_key='google_reauth_due' AND json_valid(message) AND json_extract(message,'$.key')=?").get(key)) return false;
    const fireAt=(invalidGrant?now:nyWallTime(day,'09:00')).toISOString();
    return queueReminder({rule:'google_reauth_due',entity:`google_account:${account}`,entityId:0,fireAt,channel:'both',
      message:{key,subject:'Reconnect Google for Stern',body:`${account}: ${invalidGrant?'Google consent expired.':'Google testing-mode consent expires after seven days.'} Reconnect: ${link}`,
        urgent:invalidGrant,scheduledAt:fireAt,fingerprint:consent,validUntil:''}},audit).inserted;
  }).immediate();
}
export function evaluateGoogleReauth(now=new Date()) {
  let inserted=0;
  for(const {email} of getDb().prepare("SELECT email FROM google_accounts WHERE enabled=1 AND lower(email) LIKE '%nyu.edu'").all() as {email:string}[]) {
    if(queueGoogleReauth(email,now)) inserted++;
  }
  return inserted;
}
