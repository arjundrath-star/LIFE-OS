'use client';
import { useState } from 'react';
import { useApi, apiPost } from '@/hooks/useApi';
import { useLiveData } from '@/hooks/useLiveData';
import type { SternSnapshot } from '@/lib/stern-types';
export function useSternArea<K extends 'tasks'|'classes'>(area:K){
  const api=useApi<SternSnapshot[K]>(`/api/stern/${area}`), live=useLiveData<SternSnapshot>('stern');
  const [saved,setSaved]=useState<SternSnapshot[K]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const data=[api.data,live?.[area],saved].filter((v):v is SternSnapshot[K]=>!!v).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
  async function mutate(body:Record<string,unknown>){setBusy(true);setError('');try{const r=await apiPost(`/api/stern/${area}`,body);setSaved(r.snapshot);return r;}catch(e){setError(e instanceof Error?e.message:'Could not save');throw e;}finally{setBusy(false);}}
  return {data,error:error||api.error,busy,mutate};
}
