"use client";
import { useCallback, useEffect, useState } from "react";

/** One-shot fetch with a manual refetch. For DB-backed panels that update on mutation. */
export function useApi<T = any>(url: string): { data: T | null; refetch: () => void; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState(0);
  const refetch = useCallback(() => setRequest((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError(null);
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<T>;
      })
      .then(setData)
      .catch((e) => { if (e?.name !== "AbortError") setError(e instanceof Error ? e.message : "Request failed"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, request]);
  return { data, refetch, loading, error };
}

export async function apiPost(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
