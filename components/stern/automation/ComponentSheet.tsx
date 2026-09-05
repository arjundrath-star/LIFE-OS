'use client';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { SternPage, SternSection, StatusChip, SourceBadge, StrengthDots, StatTile, SkeletonRows, EmptyState } from '../Page';
import * as T from '@/lib/stern-types';
import { ConnectionCard } from './AutomationView';
import { SternDialog } from './shared';
const groups=[['Process',T.PROCESS_STATUSES],['Club',T.CLUB_STATUSES],['Program',T.PROGRAM_STATUSES],['Coffee chat',T.COFFEE_CHAT_STATES],['Person',T.PERSON_STATUSES],['Relationship',T.RELATIONSHIP_TYPES],['Task',T.TASK_STATUSES],['Assignment',T.ASSIGNMENT_STATUSES],['Draft',T.DRAFT_STATES],['Suggestion',T.SUGGESTION_STATES],['Email',T.EMAIL_APPLIED_STATES],['Reminder',T.REMINDER_DELIVERY_STATUSES]] as const;
export function ComponentSheet(){
  const [dialog,setDialog]=useState(false),[strength,setStrength]=useState(3),[toast,setToast]=useState(false);
  return <SternPage title="Component sheet" subtitle="Development preview · placeholder data only" testId="stern-component-sheet">
    <div className="stern-component-grid"><SternSection title="Status vocabulary"><div data-testid="stern-component-statuses">{groups.map(([label,values])=><div className="stern-component-group" key={label}><h3>{label}</h3><div className="stern-button-row">{values.map(v=><StatusChip key={v} value={v}/>)}</div></div>)}</div></SternSection>
    <div className="stern-component-stack"><SternSection title="Sources and strength"><div className="stern-button-row" data-testid="stern-component-sources">{T.SOURCE_BADGE_KINDS.map(s=><SourceBadge key={s} source={s==='auto_imessage'?'imessage':s}/>)}</div><StrengthDots value={strength} editable onChange={setStrength}/></SternSection>
    <SternSection title="Buttons, fields, and dialog"><div className="stern-button-row"><Button className="stern-btn primary" data-testid="stern-component-primary" onClick={()=>setDialog(true)}>Open dialog</Button><Button className="stern-btn" data-testid="stern-component-secondary" onClick={()=>setToast(true)}>Show notice</Button><Button className="stern-btn" disabled data-testid="stern-component-disabled">Disabled</Button></div><label className="stern-field"><span>Example input</span><input className="stern-input" data-testid="stern-component-input" placeholder="Search people, clubs, tasks"/></label>{toast&&<p role="status">Example change saved. <button className="stern-text-button" data-testid="stern-component-undo" onClick={()=>setToast(false)}>Undo</button></p>}</SternSection>
    <SternSection title="StatTile and skeleton"><div className="stern-stat-grid"><StatTile label="Coffee chats owed" value={3} tone="warn" sub="2 replies waiting"/><SkeletonRows rows={3}/></div></SternSection>
    <SternSection title="Empty and error states"><EmptyState title="No people yet" hint="Text the Stern bot or use Quick add."/><p className="stern-recruiting-error" role="alert">Example: Gmail could not be reached.</p><StatusChip value="skipped" label="Skipped (dry run)"/></SternSection>
    <SternSection title="Person and assignment rows"><div className="stern-need-row" data-component="PersonRow"><strong>Example Person</strong><StatusChip value="club_connect"/><StatusChip value="chatted"/></div><div className="stern-reminder-row" data-component="AssignmentRow"><span>Example assignment</span><StatusChip value="upcoming"/><span className="stern-mono">20 pts</span><SourceBadge source="manual"/></div></SternSection></div></div>
    <div className="stern-connection-grid" data-testid="stern-component-connections">{['on_healthy','on_broken','off'].map(state=><ConnectionCard key={state} card={{id:`preview-google-${state}`,label:'Example Gmail',state,detail:'Development status preview',account:'example@example.com',scopes:['gmail.readonly'],lastScan:'',reconnectHref:'#'}}/>)}</div>
    {dialog&&<SternDialog title="Example dialog" onClose={()=>setDialog(false)}><p>Escape closes this dialog and restores focus.</p><Button className="stern-btn primary" data-testid="stern-component-dialog-done" onClick={()=>setDialog(false)}>Done</Button></SternDialog>}
  </SternPage>;
}
