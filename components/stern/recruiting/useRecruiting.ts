"use client";
import { useEffect, useState } from "react";
import { useApi, apiPost } from "@/hooks/useApi";
import { useLiveData } from "@/hooks/useLiveData";
import type { RecruitingSnapshot, SternSnapshot } from "@/lib/stern-types";
export type RecruitingMutation = (body: Record<string, unknown>) => Promise<boolean>;
export function useRecruiting() {
  const api = useApi<RecruitingSnapshot>("/api/stern/recruiting");
  const live = useLiveData<SternSnapshot>("stern");
  const [snapshot, setSnapshot] = useState<RecruitingSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [lastBatch, setLastBatch] = useState("");
  const adopt = (next: RecruitingSnapshot) => setSnapshot(previous => previous && previous.updatedAt > next.updatedAt ? previous : next);
  useEffect(() => { if (api.data) adopt(api.data); }, [api.data]);
  useEffect(() => { if (live?.recruiting) adopt(live.recruiting); }, [live]);
  const mutate: RecruitingMutation = async body => {
    setBusy(true); setNotice("");
    try {
      const result = await apiPost("/api/stern/recruiting", body) as { snapshot: SternSnapshot; batchId: string };
      adopt(result.snapshot.recruiting); setLastBatch(body.action === "seed_catalog" ? "" : result.batchId); return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "Update failed"); return false; }
    finally { setBusy(false); }
  };
  const undo = async (batchId = lastBatch) => {
    setBusy(true); setNotice("");
    try {
      const result = await apiPost("/api/stern", { action: "audit.undo", batchId }) as { snapshot: SternSnapshot };
      adopt(result.snapshot.recruiting); setLastBatch("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Undo failed"); }
    finally { setBusy(false); }
  };
  return { snapshot, busy, notice, lastBatch, mutate, undo, loading: api.loading, error: api.error, refetch: api.refetch };
}
