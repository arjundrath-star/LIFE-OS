import { get } from "@/db";

/** Canonical user-controlled integration switch for a dashboard source. */
export function isConnectionEnabled(service: string, surface = "dashboard"): boolean {
  const row = get<{ enabled:number }>("SELECT enabled FROM connections WHERE service=? AND surface=?",service,surface);
  return row?.enabled === 1;
}
