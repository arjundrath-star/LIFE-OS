import { getDb } from '@/db';
import type { SternSearchResult } from '@/lib/stern-types';

/** Literal substring search: SQL metacharacters cannot widen the query. Bounded per domain. */
export function searchStern(input: string): SternSearchResult[] {
  const q=input.trim().slice(0,120);
  if (!q) return [];
  const term=`%${q.replace(/[\\%_]/g,'\\$&')}%`, db=getDb();
  const people=db.prepare(`SELECT id,display_name label,org detail FROM people WHERE archived=0 AND
    (display_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR org LIKE ? ESCAPE '\\') ORDER BY display_name COLLATE NOCASE,id LIMIT 8`).all(term,term,term) as {id:number;label:string;detail:string}[];
  const clubs=db.prepare(`SELECT id,name label,short_name detail FROM stern_clubs WHERE status<>'archived' AND
    (name LIKE ? ESCAPE '\\' OR short_name LIKE ? ESCAPE '\\') ORDER BY interested DESC,name COLLATE NOCASE,id LIMIT 8`).all(term,term) as {id:number;label:string;detail:string}[];
  const tasks=db.prepare(`SELECT id,title label,domain detail FROM stern_tasks WHERE status='open' AND
    title LIKE ? ESCAPE '\\' ORDER BY priority,id LIMIT 8`).all(term) as {id:number;label:string;detail:string}[];
  return [...people.map(p=>({...p,kind:'person' as const,href:`/stern/network?person=${p.id}`})),
    ...clubs.map(c=>({...c,kind:'club' as const,href:`/stern/recruiting/${c.id}`})),
    ...tasks.map(t=>({...t,kind:'task' as const,href:`/stern/tasks?task=${t.id}`}))];
}
