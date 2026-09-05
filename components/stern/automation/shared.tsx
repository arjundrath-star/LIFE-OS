'use client';
import { useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { apiPost } from '@/hooks/useApi';
import { SourceBadge, EmptyState } from '../Page';
import type { SternAuditRow } from '@/lib/stern-types';
import { dateLabel } from '../recruiting/Controls';

export function SternDialog({title,onClose,children,drawer=false}:{title:string;onClose:()=>void;children:ReactNode;drawer?:boolean}) {
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><D.Portal><D.Overlay className="stern-recruiting-scrim"/><D.Content className={`stern-mode stern-automation-dialog ${drawer?'drawer':''}`} aria-describedby={undefined} onEscapeKeyDown={e=>{e.preventDefault();onClose();}}>
    <header><D.Title>{title}</D.Title><D.Close asChild><Button className="stern-btn" aria-label="Close" data-testid="stern-automation-dialog-close"><X size={16}/></Button></D.Close></header>{children}
  </D.Content></D.Portal></Dialog>;
}
export function useAutomationAction(onSaved?:(response:any)=>void) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function act(body:Record<string,unknown>) {
    setBusy(true);setError('');setMessage('');
    try { const response=await apiPost('/api/stern/automation',body);onSaved?.(response);
      const result=response.result;
      setMessage(typeof result?.reverted==='number'?`Undid ${result.reverted} changes. ${result.skipped} skipped because later changes won.`:result?.error==='dry-run'||result?.dryRun?'Dry run completed. Nothing was delivered.':result?.delivery_status?`Delivery: ${result.delivery_status}${result.error?` · ${result.error}`:''}`:typeof result?.accounts==='number'?`${body.action==='scan.now'?'Scan':'Calendar sync'} complete: ${result.accounts} accounts, ${result.messages??result.events??0} ${body.action==='scan.now'?'messages':'events'}, ${result.failures??0} account failures${typeof result.errors==='number'?`, ${result.errors} message errors`:''}.`:'Saved.');
      return response;
    } catch(e){setError(e instanceof Error?e.message:'Action failed');return null;} finally{setBusy(false);}
  }
  return {act,busy,message,error};
}
export function ActionNotice({error,message}:{error:string;message:string}) {return <>{error&&<p className="stern-recruiting-error" role="alert">{error}</p>}{message&&<p className="stern-action-notice" role="status">{message}</p>}</>;}
export function AuditLogRows({rows,busy,undo}:{rows:SternAuditRow[];busy:boolean;undo:(batchId:string)=>void}) {
  const [evidence,setEvidence]=useState<SternAuditRow|null>(null);
  const batches=new Set<string>();
  return <><div className="stern-audit-scroll" data-testid="stern-audit-list">{!rows.length?<EmptyState title="No changes recorded" hint="Automatic updates appear here with their source and batch Undo."/>:<table className="stern-audit-table"><thead><tr><th>Time</th><th>Change</th><th>Source</th><th>Evidence</th><th>Batch</th></tr></thead><tbody>{rows.map(row=>{
    const canUndo=!!row.batch_id&&!row.undone_at&&row.action!=='undo'&&!batches.has(row.batch_id);
    if(canUndo)batches.add(row.batch_id);
    const value=(v:string)=>v.length>100?`${v.slice(0,100)}…`:v;
    return <tr key={row.id} data-component="AuditLogRow" data-testid={`stern-audit-${row.id}`}><td><time className="stern-mono" dateTime={row.created_at}>{dateLabel(row.created_at,true)}</time></td><td><strong>{row.entity_type.replace(/_/g,' ')} <span className="stern-mono">#{row.entity_id}</span></strong><div>{row.field?`${row.field.replace(/_/g,' ')}: `:''}{row.action==='update'?`${value(row.before_value)||'Empty'} → ${value(row.after_value)||'Empty'}`:row.action}</div></td><td><SourceBadge source={row.source}/></td><td>{row.evidence_excerpt?<button className="stern-text-button" data-testid={`stern-audit-evidence-${row.id}`} onClick={()=>setEvidence(row)}>View snippet</button>:<span className="stern-muted">No snippet</span>}</td><td>{row.undone_at?'Undone':canUndo?<button className="stern-text-button" disabled={busy} data-testid={`stern-audit-undo-${row.id}`} onClick={()=>undo(row.batch_id)}>Undo</button>:null}</td></tr>;
  })}</tbody></table>}</div>{evidence&&<SternDialog title="Source evidence" onClose={()=>setEvidence(null)}><SourceBadge source={evidence.source}/><p className="stern-evidence">{evidence.evidence_excerpt}</p>{evidence.gmail_message_id&&<a data-testid="stern-evidence-gmail" href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(evidence.gmail_account)}#all/${encodeURIComponent(evidence.gmail_message_id)}`} target="_blank" rel="noreferrer">Open in Gmail</a>}</SternDialog>}</>;
}
