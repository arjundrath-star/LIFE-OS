'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import type { SternSearchResult } from '@/lib/stern-types';
import { SkeletonRows } from './Page';
export function SternSearch() {
  const [q,setQ]=useState(''),[query,setQuery]=useState(''),[open,setOpen]=useState(false);
  useEffect(()=>{const t=setTimeout(()=>setQuery(q.trim()),180);return()=>clearTimeout(t);},[q]);
  const api=useApi<{results:SternSearchResult[]}>(`/api/stern?q=${encodeURIComponent(query)}`);
  const loading=api.loading||query!==q.trim();
  return <div className="stern-search" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();setOpen(false);}if(e.key==='ArrowDown'){e.preventDefault();e.currentTarget.querySelector<HTMLAnchorElement>('.stern-search-results a')?.focus();}}}>
    <label><SearchIcon aria-hidden="true"/><input type="search" value={q} onChange={e=>{setQ(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} placeholder="Search people, clubs, tasks" aria-label="Search people, clubs, tasks" aria-expanded={open&&!!q.trim()} aria-controls="stern-search-results" data-testid="stern-search"/></label>
    {open&&q.trim()&&<div className="stern-search-results" id="stern-search-results" data-testid="stern-search-results" aria-label="Search results">{loading?<SkeletonRows rows={3}/>:api.error?<p role="alert">Search unavailable. Try again.</p>:!api.data?.results.length?<p>No people, clubs, or open tasks match “{query}”.</p>:api.data.results.map(r=><Link key={`${r.kind}-${r.id}`} href={r.href} data-testid={`stern-search-${r.kind}-${r.id}`} onClick={()=>{setOpen(false);setQ('');}}><strong>{r.label}</strong><small>{r.kind} · {r.detail}</small></Link>)}</div>}
  </div>;
}
