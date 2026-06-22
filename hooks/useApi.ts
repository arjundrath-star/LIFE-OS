"use client";
import { useCallback, useEffect, useState } from "react";

/** One-shot fetch with a manual refetch. For DB-backed panels that update on mutation. */
export function useApi<T = any>(url: string): { data: T | null; refetch: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const refetch = useCallback(() => {
    setLoading(true);
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setData(j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [url]);
  useEffect(() => {
    refetch();
  }, [refetch]);
  return { data, refetch, loading };
}

export async function apiPost(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}
