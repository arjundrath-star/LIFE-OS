'use client';
import { SourceBadge } from '../Page';
import { statusLabel, type Assignment } from '@/lib/stern-types';
import { formatDue } from './format';
export function AssignmentRow({assignment:a,onEdit,selected=false,hovered=false}:{assignment:Pick<Assignment,'id'|'title'|'kind'|'due_at'|'points_earned'|'points_possible'|'source'>;onEdit:()=>void;selected?:boolean;hovered?:boolean}) {
  return <div className="stern-assignment-row" data-component="AssignmentRow" data-testid="stern-assignment-row" data-assignment-id={a.id} data-selected={selected} data-hovered={hovered}>
    <button className="stern-task-title" data-testid={`stern-assignment-edit-${a.id}`} onClick={onEdit}>{a.title}</button>
    <span className="stern-type-chip">{statusLabel(a.kind)}</span><time className="stern-mono">{formatDue(a.due_at)}</time>
    <span className="stern-mono">{a.points_earned!==null?`${a.points_earned} / `:''}{a.points_possible??'Not set'}</span><SourceBadge source={a.source}/>
  </div>;
}
