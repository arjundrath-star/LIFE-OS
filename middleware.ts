// Gate: every route requires a valid NextAuth session whose email is on the allowlist.
// The allowlist itself is enforced in the signIn callback (lib/auth.ts); this layer
// blocks unauthenticated access and re-checks the email claim on every request.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isHealthApiPath } from "@/lib/connections/access";

const CONFIGURED_EMAILS = [...new Set((process.env.GOOGLE_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean))];
const ALLOWED = CONFIGURED_EMAILS;
const HEALTH_ALLOWED = [...new Set((process.env.HEALTH_ALLOWED_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter((email) => email.length > 0 && ALLOWED.includes(email)))];

// Paths that must stay open for the gate itself to function.
// Tree prefixes match on SEGMENT boundaries only (never bare startsWith, which
// would make any path beginning with the string public — a gate-bypass landmine).
const PUBLIC_PREFIXES = [
  "/signin",
  "/api/auth", // NextAuth endpoints
  "/_next",
];
// Single public files (not trees).
const PUBLIC_EXACT = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/icon.png",
  "/icon.svg",
  "/apple-icon.png",
  "/manifest.json",
  // Public privacy policy — required as the OAuth privacy-policy URL for connected
  // apps (e.g. WHOOP shows it during consent). Static text only, no data exposed.
  "/privacy",
]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_EXACT.has(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))
  ) {
    return NextResponse.next();
  }

  // Behind the TLS-terminating Cloudflare tunnel the origin sees http, but the
  // session cookie is `__Secure-`-prefixed (set because NEXTAUTH_URL is https).
  // Force secureCookie so getToken reads the right cookie name, else the gate loops.
  const useSecure = (process.env.NEXTAUTH_URL || "").startsWith("https://");
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: useSecure,
  });
  const email = (token?.email as string | undefined)?.toLowerCase();
  const appAllowed = !!email && ALLOWED.includes(email);
  const healthPath = isHealthApiPath(pathname);
  const ok = appAllowed && (!healthPath || (!!email && HEALTH_ALLOWED.includes(email)));

  if (!ok) {
    // API routes get a clean 401; pages redirect to the sign-in screen.
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
