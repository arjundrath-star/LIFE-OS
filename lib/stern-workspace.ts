// Stern workspace routing contract (mirrors lib/business-workspace.ts). Client-safe.
import { STERN_ROUTES } from "@/lib/stern-types";
export { STERN_ROUTES } from "@/lib/stern-types";

export const STERN_HOME = "/stern";

/** Legacy dashboard routes folded into the Stern tab (PLAN.md: /school deleted, /career absorbed). */
export const LEGACY_STERN_REDIRECTS = {
  "/school": "/stern",
  "/career": "/stern/career",
} as const;

export function isSternPath(pathname: string): boolean {
  return pathname === STERN_HOME || pathname.startsWith(STERN_HOME + "/");
}

/** The active Stern route for a pathname: exact for Overview, segment-prefix for the rest. */
export function activeSternRoute(pathname: string) {
  return STERN_ROUTES.find((route) =>
    route.href === STERN_HOME ? pathname === STERN_HOME : pathname === route.href || pathname.startsWith(route.href + "/")
  );
}

export function sternPageTitle(pathname: string): string {
  return activeSternRoute(pathname)?.label ?? "Stern";
}
