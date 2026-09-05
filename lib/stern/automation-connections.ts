import { getDb } from '@/db';
import { getDef } from '@/lib/connections/registry';
import { accountScopes } from '@/lib/sources/google';
import { sternConnectionSummary } from './connections';
import type { SternConnectionCard } from '@/lib/stern-types';

/** Reads the existing health cache for Hermes/Personal; never calls their network probes. */
export async function automationConnections(): Promise<SternConnectionCard[]> {
  const db=getDb(), health=await sternConnectionSummary();
  const accounts=db.prepare('SELECT email,enabled,last_error,last_sync FROM google_accounts ORDER BY enabled DESC,added_at DESC').all() as {email:string;enabled:number;last_error:string;last_sync:string|null}[];
  const specs=[['stern-google-stern','Stern Gmail','stern'],['stern-google-nyu','NYU Gmail','nyu'],['career-google-personal','Personal Gmail','personal'],['stern-llm-codex','Codex classifier',''],['hermes','Hermes','']] as const;
  return specs.map(([id,label,target])=>{
    const cached=db.prepare("SELECT state,detail,last_checked FROM connections WHERE service=? AND surface='dashboard'").get(id) as {state:string;detail:string;last_checked:string}|undefined;
    const personalHint = target==='personal' ? getDef(id)?.googleAccountHint?.() || '' : '';
    const a=target?accounts.find(a=> target==='stern'?/@stern\.nyu\.edu$/i.test(a.email):target==='nyu'?/@nyu\.edu$/i.test(a.email):a.email.toLowerCase()===personalHint.toLowerCase()):undefined;
    const h=health.find(h=>h.id===id);
    const scan=a?db.prepare('SELECT last_checked FROM stern_scan_state WHERE account=?').get(a.email.toLowerCase()) as {last_checked:string}|undefined:undefined;
    let state=h?.state||cached?.state||'off',detail=h?.detail||cached?.detail||'Health has not been checked';
    if(target && !a){state='off';detail='Google account not connected';}
    if(target==='personal'&&a){state=!a.enabled?'off':a.last_error?'on_broken':cached?.state||'off';detail=a.last_error?'Google account needs re-auth':cached?.detail||'Connected account; health has not been checked';}
    return {id,label,state,detail,account:a?.email||'',scopes:a?accountScopes(a.email).filter(s=>!['openid','email','profile'].includes(s)).map(s=>s.split('/').pop()||s):[],lastScan:target==='personal'?(a?.last_sync||''):target?(scan?.last_checked||''):(cached?.last_checked||''),
      reconnectHref:target?`/api/google/connect?set=${target==='personal'?'readonly':'stern'}&target=${target}${a?`&login_hint=${encodeURIComponent(a.email)}`:''}`:'/connections'};
  });
}
