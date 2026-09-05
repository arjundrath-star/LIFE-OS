'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CheckSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui';
import { SternPage, EmptyState, SkeletonRows, SourceBadge } from '@/components/stern/Page';
import { useSternArea } from '@/components/stern/useSternArea';
import { TASK_DOMAINS, TASK_DOMAIN_LABELS, type SternTask, type TaskDomain, type TasksSnapshot } from '@/lib/stern-types';
import { formatDue } from '../classes/format';
const EMPTY_GROUP:Record<string,string>={overdue:'Nothing overdue',today:'Nothing due today',week:'Nothing due this week',later:'Nothing due later',none:'No undated tasks',all:'No open tasks'};
export function TasksView(){
  const {data,error,busy,mutate,refetch}=useSternArea('tasks');const [domains,setDomains]=useState<TaskDomain[]>([]),[grouped,setGrouped]=useState(true),[editing,setEditing]=useState<SternTask|null>(null),[history,setHistory]=useState(false);
  const matches=(t:SternTask)=>!domains.length||domains.includes(t.domain);
  const groups=data?(grouped?data.groups:[{key:'all',title:'Open tasks',rows:data.tasks.filter(t=>t.status==='open')}]).map(g=>({...g,rows:g.rows.filter(matches)})):[];
  async function save(body:Record<string,unknown>){await mutate(body);setEditing(null);}
  function taskRow(task:SternTask){return <div className="stern-task-row" data-testid="stern-task-row" data-task-id={task.id} key={task.id}>
    <input type="checkbox" checked={task.status==='done'} disabled={busy} aria-label={`${task.status==='done'?'Reopen':'Complete'} ${task.title}`} data-testid={`stern-task-check-${task.id}`} onChange={()=>void mutate({action:task.status==='done'?'task.reopen':'task.complete',id:task.id}).catch(()=>{})}/>
    <button className={task.status==='done'?'stern-task-title done':'stern-task-title'} onClick={()=>setEditing(task)} data-testid={`stern-task-edit-${task.id}`}>{task.title}</button>
    <span className="stern-task-links" data-testid="stern-task-links">{task.course_code&&<Link href={`/stern/classes/${task.course_id}`} data-testid={`stern-task-course-${task.id}`}>{task.course_code}</Link>}{task.club_name&&<Link href={`/stern/recruiting/${task.club_id}`} data-testid={`stern-task-club-${task.id}`}>{task.club_name}</Link>}{task.person_name&&<Link href={`/stern/network?person=${task.person_id}`} data-testid={`stern-task-person-${task.id}`}>{task.person_name}</Link>}</span>
    <time className="stern-mono">{formatDue(task.due_at)}</time><i className="stern-priority" data-priority={task.priority} title={`Priority ${task.priority}`} aria-label={`Priority ${task.priority}`}/><SourceBadge source={task.source}/>
  </div>;}
  return <SternPage title="Tasks" testId="stern-tasks-view" actions={<><div className="stern-domain-chips" data-testid="stern-tasks-domains"><button data-testid="stern-tasks-domain-all" aria-pressed={!domains.length} onClick={()=>setDomains([])}>All</button>{TASK_DOMAINS.map(domain=><button key={domain} data-testid={`stern-tasks-domain-${domain}`} aria-pressed={domains.includes(domain)} onClick={()=>setDomains(v=>v.includes(domain)?v.filter(d=>d!==domain):[...v,domain])}>{TASK_DOMAIN_LABELS[domain]}</button>)}</div><label className="stern-group-switch"><input data-testid="stern-tasks-group" type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)}/>Group by due</label></>}>
    {data&&error&&<p role="alert" className="stern-recruiting-error">{error}</p>}
    {!data?(error?<EmptyState title="Tasks could not be loaded" hint={error} action={<button className="stern-btn" data-testid="stern-tasks-retry" onClick={refetch}>Retry</button>}/>:<SkeletonRows/>):<div className="stern-tasks-columns"><div className="stern-task-groups" data-testid="stern-tasks-list">
      {groups.map(g=><section key={g.key} data-testid={`stern-tasks-group-${g.key}`}><h2>{g.title} <span className="stern-mono">{g.rows.length}</span></h2><div className="stern-row-surface">{g.rows.length?g.rows.map(taskRow):<EmptyState title={EMPTY_GROUP[g.key]} hint={g.key==='all'?'Add a task to get started.':undefined}/>}</div></section>)}
      <details data-testid="stern-tasks-done"><summary data-testid="stern-tasks-done-toggle">Done today <span className="stern-mono">{data.doneToday.filter(matches).length}</span></summary><div className="stern-row-surface" data-testid="stern-tasks-done-list">{data.doneToday.filter(matches).length?data.doneToday.filter(matches).map(taskRow):<EmptyState title="No tasks completed today"/>}</div></details>
      <button className="stern-text-button" data-testid="stern-tasks-history-toggle" onClick={()=>setHistory(v=>!v)}>{history?'Hide':'Show'} completed and dropped tasks (latest 100)</button>
      {history&&<div className="stern-row-surface" data-testid="stern-tasks-history">{data.tasks.filter(t=>t.status!=='open'&&matches(t)).length?data.tasks.filter(t=>t.status!=='open'&&matches(t)).map(taskRow):<EmptyState title="No completed or dropped tasks"/>}</div>}
    </div><TaskComposer key={editing?.id??'new'} task={editing} data={data} busy={busy} save={save} cancel={()=>setEditing(null)}/></div>}
  </SternPage>;
}
function TaskComposer({task,data,busy,save,cancel}:{task:SternTask|null;data:TasksSnapshot;busy:boolean;save:(body:Record<string,unknown>)=>Promise<void>;cancel:()=>void}){
  const [title,setTitle]=useState(task?.title??''),[domain,setDomain]=useState(task?.domain??'academic'),[due,setDue]=useState(task?.due_at??''),[priority,setPriority]=useState(task?.priority??2),[linked,setLinked]=useState(''),[notes,setNotes]=useState(task?.notes??'');
  async function submit(e:FormEvent){e.preventDefault();const patch:Record<string,unknown>={title,domain,due_at:due,priority,notes};if(linked){for(const key of ['course_id','club_id','person_id'])patch[key]=0;if(linked!=='none'){const [type,id]=linked.split(':');patch[`${type}_id`]=Number(id);}}try{await save(task?{action:'task.update',id:task.id,patch}:{action:'task.create',task:patch});setTitle('');setNotes('');setDue('');setLinked('');}catch{}}
  return <form className="stern-task-composer stern-form-stack stern-row-surface" data-testid="stern-task-composer" onSubmit={submit}><h2>{task?'Edit task':'Add task'}</h2>
    <label className="stern-field">Task title<input required data-testid="stern-task-title" value={title} onChange={e=>setTitle(e.target.value)} placeholder="Task title"/></label>
    <label className="stern-field">Domain<select data-testid="stern-task-domain" value={domain} onChange={e=>setDomain(e.target.value as TaskDomain)}>{TASK_DOMAINS.map(d=><option key={d} value={d}>{TASK_DOMAIN_LABELS[d]}</option>)}</select></label>
    <label className="stern-field">Due<input data-testid="stern-task-due" type={due.includes('T')?'text':'date'} value={due} onChange={e=>setDue(e.target.value)}/></label>
    <label className="stern-field">Linked entity<select data-testid="stern-task-linked" value={linked} onChange={e=>setLinked(e.target.value)}><option value="">{task?'Keep current links':'Link to club, course, or person'}</option><option value="none">No linked entity</option>{data.links.map(l=><option key={`${l.type}:${l.id}`} value={`${l.type}:${l.id}`}>{l.label} · {l.type}</option>)}</select></label>
    <label className="stern-field">Priority<select data-testid="stern-task-priority" value={priority} onChange={e=>setPriority(Number(e.target.value))}><option value="3">Low</option><option value="2">Medium</option><option value="1">High</option></select></label>
    {task&&<label className="stern-field">Notes<textarea data-testid="stern-task-notes" value={notes} onChange={e=>setNotes(e.target.value)}/></label>}
    <Button type="submit" className="stern-btn primary" disabled={busy||!title.trim()} data-testid="stern-task-save">{task?<CheckSquare size={14}/>:<Plus size={14}/>} {task?'Save task':'Add task'}</Button>
    {task&&<><Button className="stern-btn ghost" type="button" data-testid="stern-task-cancel" onClick={cancel}>Cancel</Button><Button className="stern-btn ghost" type="button" disabled={busy} data-testid="stern-task-drop" onClick={()=>void save({action:task.status==='dropped'?'task.reopen':'task.drop',id:task.id}).catch(()=>{})}>{task.status==='dropped'?'Reopen task':'Drop task'}</Button></>}
  </form>;
}
