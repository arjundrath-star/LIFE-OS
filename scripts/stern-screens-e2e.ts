#!/usr/bin/env -S tsx
// WP7 screenshot sweep: every Stern screen at 1440x900 and 390 wide against an ISOLATED server.
// Usage (after isolated-server.sh start <wt> <db> 3190 "NEXTAUTH_URL=http://127.0.0.1:3190"):
//   E2E_COOKIE="$(scripts/stern-build/isolated-server.sh cookie)" tsx scripts/stern-screens-e2e.ts \
//     [--origin http://127.0.0.1:3190] [--out docs/plans/stern/reports/screenshots]
// The server must run with NEXTAUTH_URL on plain http so the browser sends the session cookie
// (name next-auth.session-token). Refuses port 3000 and any non-loopback origin. Writes a JSON
// summary next to the PNGs. Exit 1 if any route is not 200 or a page throws.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const origin = arg("--origin", "http://127.0.0.1:3190").replace(/\/$/, "");
const out = arg("--out", path.join(process.cwd(), "docs/plans/stern/reports/screenshots"));
const cookie = process.env.E2E_COOKIE || "";
const cookieName = process.env.E2E_COOKIE_NAME || (origin.startsWith("https://") ? "__Secure-next-auth.session-token" : "next-auth.session-token");
if (!/^https?:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) || /:3000$/.test(origin)) {
  console.error(`refusing origin ${origin}: loopback only, never port 3000`);
  process.exit(2);
}
if (!cookie) {
  console.error("E2E_COOKIE is required (scripts/stern-build/isolated-server.sh cookie)");
  process.exit(2);
}

type Shot = { route: string; viewport: string; status: number | null; file: string; consoleErrors: string[]; pageErrors: string[] };

async function firstId(pathname: string, pick: (json: any) => number | undefined): Promise<number | undefined> {
  try {
    const r = await fetch(`${origin}${pathname}`, { headers: { cookie: `${cookieName}=${cookie}` } });
    if (!r.ok) return undefined;
    return pick(await r.json());
  } catch {
    return undefined;
  }
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const clubId = await firstId("/api/stern/recruiting", (j) => j?.clubs?.[0]?.id ?? j?.catalog?.[0]?.id);
  const courseId = await firstId("/api/stern/classes", (j) => j?.courses?.[0]?.id);
  const routes = [
    "/stern", "/stern/recruiting", clubId ? `/stern/recruiting/${clubId}` : null, "/stern/network", "/stern/network?add=1",
    "/stern/tasks", "/stern/classes", courseId ? `/stern/classes/${courseId}` : null, "/stern/career", "/stern/automation",
    "/stern/automation?components=1",
  ].filter((r): r is string => !!r);
  const viewports = [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }];

  const browser = await puppeteer.launch({ executablePath: process.env.E2E_CHROMIUM || "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const shots: Shot[] = [];
  let failures = 0;
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(90000);
    await page.setCookie({ name: cookieName, value: cookie, url: origin, httpOnly: true, secure: origin.startsWith("https://"), sameSite: "Lax" });
    for (const vp of viewports) {
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      for (const route of routes) {
        const consoleErrors: string[] = [];
        const pageErrors: string[] = [];
        const onConsole = (m: any) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); };
        const onError = (e: any) => pageErrors.push(String(e).slice(0, 200));
        page.on("console", onConsole);
        page.on("pageerror", onError);
        const slug = route.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-$/, "") || "root";
        const file = path.join(out, `${slug}-${vp.name}.png`);
        let status: number | null = null;
        try {
          const res = await page.goto(`${origin}${route}`, { waitUntil: "networkidle2" });
          status = res?.status() ?? null;
          await new Promise((r) => setTimeout(r, 800));
          await page.screenshot({ path: file, fullPage: true });
        } catch (e) {
          pageErrors.push(`navigation: ${String((e as Error).message).slice(0, 200)}`);
        }
        page.off("console", onConsole);
        page.off("pageerror", onError);
        const ok = status === 200 && pageErrors.length === 0;
        if (!ok) failures++;
        shots.push({ route, viewport: vp.name, status, file: path.relative(process.cwd(), file), consoleErrors, pageErrors });
        console.log(`${ok ? "ok " : "FAIL"} ${status ?? "-"} ${vp.name.padEnd(7)} ${route}${consoleErrors.length ? `  console errors: ${consoleErrors.length}` : ""}`);
      }
    }
    // Unauthenticated checks: API 401, page redirects to sign-in.
    const anon = await fetch(`${origin}/api/stern`);
    const anonPage = await fetch(`${origin}/stern`, { redirect: "manual" });
    const authOk = anon.status === 401 && (anonPage.status === 307 || anonPage.status === 302);
    if (!authOk) failures++;
    console.log(`${authOk ? "ok " : "FAIL"} auth gate: api ${anon.status}, page ${anonPage.status}`);
    const summary = { origin, at: new Date().toISOString(), routes: routes.length, shots, authGate: { api: anon.status, page: anonPage.status }, failures };
    fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ shots: shots.length, failures, out: path.relative(process.cwd(), out) }));
  } finally {
    await browser.close();
  }
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e instanceof Error ? e.stack || e.message : e); process.exitCode = 1; });
