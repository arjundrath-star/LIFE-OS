"use client";
import { useCallback, useEffect, useState } from "react";

/** Fetch with a manual refetch. Cached data is retained, while `succeeded` describes only the latest request. */
export function useApi<T = any>(url: string): { data: T | null; refetch: () => void; loading: boolean; error: string | null; succeeded: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [request, setRequest] = useState(0);
  const refetch = useCallback(() => setRequest((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setSucceeded(false);
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        return r.json() as Promise<T>;
      })
      .then((payload) => { if (!controller.signal.aborted) { setData(payload); setSucceeded(true); } })
      .catch((e) => { if (!controller.signal.aborted && e?.name !== "AbortError") { setSucceeded(false); setError(e instanceof Error ? e.message : "Request failed"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, request]);
  return { data, refetch, loading, error, succeeded };
}

export async function apiPost(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await r.json().catch(() => null);
  if (!r.ok) {
    const message = payload && typeof payload.error === "string"
      ? payload.error
      : `Request failed (${r.status})`;
    throw new Error(message);
  }
  return payload;
}
