// Phase 4 E2E: boots an isolated, production-mode server against a temp DB
// seeded from the fifo-margin-basic golden fixture, drives the real
// /pokemon-ops page with Puppeteer (system Chromium, no bundled browser), and
// asserts the KPI band + lot form + live update all work end to end.
//
// Mirrors scripts/pokemon-ops-smoke.sh's temp-DB / isolated-server / cleanup
// pattern exactly — CRITICAL: NODE_ENV=production (a dev-mode `tsx server.ts`
// boot clobbers .next and crash-loops prod; never boot without it), a free
// non-3000 port, RATHWORKSPACE_DB pointed at the temp copy.
//
// Usage: tsx scripts/pokemon-ops-e2e.ts   (or npm run e2e:pokemon-ops)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.E2E_PORT || 3211);
const BASE = `http://127.0.0.1:${PORT}`;
const FIXTURE_DIR = path.join(REPO_ROOT, "tests/pokemon-ops/fixtures/fifo-margin-basic");
const ARTIFACT_DIR = path.join(REPO_ROOT, "tests/pokemon-ops/artifacts");
const SCREENSHOT_PATH = path.join(ARTIFACT_DIR, "phase4.png");
const CHROMIUM_PATH = process.env.E2E_CHROMIUM || "/usr/bin/chromium";

let failures = 0;
function ok(label: string) {
  console.log(`OK: ${label}`);
}
function fail(label: string, detail?: unknown) {
  failures++;
  console.error(`FAIL: ${label}${detail !== undefined ? ` (${String(detail)})` : ""}`);
}
function assert(label: string, cond: boolean, detail?: unknown) {
  if (cond) ok(label);
  else fail(label, detail);
}

function run(label: string, cmd: string, args: string[], env: NodeJS.ProcessEnv): string {
  console.log(`\n== ${label}: ${cmd} ${args.join(" ")} ==`);
  const res = spawnSync(cmd, args, { cwd: REPO_ROOT, env, encoding: "utf8" });
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit ${res.status ?? "signal " + res.signal})`);
  }
  return res.stdout ?? "";
}

async function waitFor(fn: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

async function main() {
  if (PORT === 3000) throw new Error("refusing to use PORT=3000 (live prod port) — set E2E_PORT");
  if (!fs.existsSync(CHROMIUM_PATH)) {
    throw new Error(`system chromium not found at ${CHROMIUM_PATH} — set E2E_CHROMIUM`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-ops-e2e."));
  const dbPath = path.join(tmpDir, "pokemon-ops-e2e.db");
  const dbEnv = { ...process.env, RATHWORKSPACE_DB: dbPath };

  let serverProc: ReturnType<typeof spawn> | null = null;
  let browser: import("puppeteer-core").Browser | null = null;

  const cleanup = () => {
    if (serverProc && serverProc.pid) {
      // tsx server.ts forks a real listening child; kill children first (same
      // pkill -P pattern as pokemon-ops-smoke.sh), then the wrapper itself.
      try {
        spawnSync("pkill", ["-P", String(serverProc.pid)]);
      } catch {
        /* best effort */
      }
      try {
        process.kill(serverProc.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(1);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(1);
  });

  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

    console.log(`== temp db: ${dbPath} ==`);
    run("migrate", "npm", ["run", "migrate"], dbEnv);

    console.log("\n== load golden fixture: fifo-margin-basic ==");
    const fixtureOut = path.join(tmpDir, "fixture-result.json");
    run(
      "load fixture",
      "node_modules/.bin/tsx",
      ["tests/pokemon-ops/run-fixture.ts", FIXTURE_DIR, fixtureOut],
      dbEnv
    );
    const expected = JSON.parse(
      fs.readFileSync(path.join(FIXTURE_DIR, "expected.json"), "utf8")
    );
    const expectedTotalInvestedCents: number = expected.queries.total_invested;
    console.log(`fixture-derived total_invested_cents = ${expectedTotalInvestedCents}`);

    console.log(`\n== boot isolated production server on port ${PORT} ==`);
    serverProc = spawn(
      "node_modules/.bin/tsx",
      ["server.ts"],
      {
        cwd: REPO_ROOT,
        env: { ...dbEnv, NODE_ENV: "production", PORT: String(PORT) },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const serverLog: string[] = [];
    serverProc.stdout?.on("data", (d) => serverLog.push(d.toString()));
    serverProc.stderr?.on("data", (d) => serverLog.push(d.toString()));

    await waitFor(
      async () => {
        try {
          const r = await fetch(`${BASE}/api/auth/providers`);
          return r.status === 200;
        } catch {
          return false;
        }
      },
      60000,
      `server ready on ${BASE}`
    ).catch((e) => {
      console.error("---- server log ----");
      console.error(serverLog.join(""));
      throw e;
    });
    ok(`server ready on ${BASE}`);

    console.log("\n== minting session cookie ==");
    const cookieValue = run("mint session", "node_modules/.bin/tsx", ["scripts/pokemon-ops-mint-session.ts"], process.env).trim();
    if (!cookieValue) throw new Error("empty session cookie");
    ok("session cookie minted");

    console.log("\n== launching puppeteer (system chromium) ==");
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.launch({
      executablePath: CHROMIUM_PATH,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1200 });
    page.on("console", (msg) => console.log(`[browser console] ${msg.type()}: ${msg.text()}`));
    page.on("pageerror", (err) => console.log(`[browser pageerror] ${err}`));
    page.on("requestfailed", (req) => console.log(`[browser requestfailed] ${req.url()} ${req.failure()?.errorText}`));

    // Cookie method: try CDP page.setCookie first (Chrome treats localhost as a
    // secure context, so a `secure: true` __Secure- cookie is accepted there);
    // fall back to a raw Cookie header (bypasses the browser's cookie jar/name
    // rules entirely) if the middleware still redirects to /signin.
    let cookieMethod = "page.setCookie";
    await page.setCookie({
      name: "__Secure-next-auth.session-token",
      value: cookieValue,
      url: BASE,
      secure: true,
      httpOnly: true,
      path: "/",
    });

    let resp = await page.goto(`${BASE}/pokemon-ops`, { waitUntil: "networkidle0", timeout: 30000 });
    if (!resp || !resp.ok() || page.url().includes("/signin")) {
      cookieMethod = "setExtraHTTPHeaders (Cookie header fallback)";
      await page.setExtraHTTPHeaders({
        Cookie: `__Secure-next-auth.session-token=${cookieValue}`,
      });
      resp = await page.goto(`${BASE}/pokemon-ops`, { waitUntil: "networkidle0", timeout: 30000 });
    }
    assert(
      "navigated to /pokemon-ops authed (no /signin redirect)",
      !!resp && resp.ok() && !page.url().includes("/signin"),
      page.url()
    );
    console.log(`cookie method that worked: ${cookieMethod}`);

    await page.waitForSelector('[data-testid="general-inventory-summary"]', { timeout: 15000 });
    await page.evaluate(() => { const button=Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent?.trim()==="Machine Inventory") as HTMLButtonElement|null;if(!button)throw new Error("Machine Inventory tab not found");button.click(); });
    await page.waitForSelector('[data-testid="kpi-total-invested"]', { timeout: 15000 });

    const expectedInitial = `$${(expectedTotalInvestedCents / 100).toFixed(2)}`;
    await waitFor(
      async () => {
        const text = await page.$eval('[data-testid="kpi-total-invested"]', (el) => el.textContent || "");
        return text.includes(expectedInitial);
      },
      10000,
      `KPI total-invested shows ${expectedInitial}`
    );
    ok(`KPI band shows fixture-derived total invested (${expectedInitial})`);

    // ---- fill + submit the lot form for the existing "Alpha" product ----
    const addedUsd = "51.23";
    const addedCents = Math.round(Number(addedUsd) * 100);
    const newTotalCents = expectedTotalInvestedCents + addedCents;
    const expectedNewTotal = `$${(newTotalCents / 100).toFixed(2)}`;

    await page.evaluate(() => { const button=Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent?.trim()==="Record Activity") as HTMLButtonElement|null;if(!button)throw new Error("Record Activity tab not found");button.click(); });
    await page.waitForSelector('[data-testid="lot-form-product"]', { timeout: 10000 });
    const alphaValue = await page.$eval('[data-testid="lot-form-product"]', (el) => {
      const select = el as HTMLSelectElement;
      const opt = Array.from(select.options).find((o) => o.textContent?.trim() === "Alpha");
      return opt ? opt.value : null;
    });
    assert("found Alpha option in lot form product select", !!alphaValue, alphaValue);
    if (alphaValue) await page.select('[data-testid="lot-form-product"]', alphaValue);

    await setInputValue(page, '[data-testid="lot-form-total-cost"]', addedUsd);
    await setInputValue(page, '[data-testid="lot-form-notes"]', "e2e phase-4 lot");

    // House trap: page.click() on a wide row/container hits a child element,
    // not the intended target. Select the exact button and click it via
    // page.evaluate(el => el.click()) rather than a coordinate-based click.
    await page.evaluate(() => {
      const btn = document.getElementById("lot-form-submit") as HTMLButtonElement | null;
      if (!btn) throw new Error("lot-form-submit button not found");
      btn.click();
    });

    await page.evaluate(() => { const button=Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent?.trim()==="Machine Inventory") as HTMLButtonElement|null;if(!button)throw new Error("Machine Inventory tab not found");button.click(); });
    await waitFor(
      async () => {
        const text = await page.$eval('[data-testid="kpi-total-invested"]', (el) => el.textContent || "");
        return text.includes(expectedNewTotal);
      },
      15000,
      `KPI total-invested increases to ${expectedNewTotal} after lot submit`
    );
    ok(`total invested increased by the entered amount (now ${expectedNewTotal})`);

    await page.evaluate(() => { const button=Array.from(document.querySelectorAll('[role="tab"]')).find(el=>el.textContent?.trim()==="Purchase Lots") as HTMLButtonElement|null;if(!button)throw new Error("Purchase Lots tab not found");button.click(); });
    await waitFor(
      async () => {
        const el = await page.$('[data-testid="recent-lots"]');
        if (!el) return false;
        const text = await page.evaluate((n) => n.textContent || "", el);
        return text.includes(`$${addedUsd}`);
      },
      10000,
      "new lot appears in the recent-lots list"
    );
    ok("new lot appears in the UI (recent-lots list)");

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
    const stat = fs.statSync(SCREENSHOT_PATH);
    assert(`screenshot written (${SCREENSHOT_PATH}, ${stat.size} bytes)`, stat.size > 0);
  } finally {
    try {
      await browser?.close();
    } catch {
      /* best effort */
    }
    cleanup();
  }

  console.log(`\n== summary: ${failures} failing checks ==`);
  process.exit(failures > 0 ? 1 : 0);
}

/**
 * React controlled inputs ignore a plain `.value = x` assignment (React's
 * internal value tracker sees no change unless we go through the native
 * setter), so we call the DOM prototype's setter directly, then dispatch
 * input+change — the same trick every React-testing library uses under Puppeteer.
 */
async function setInputValue(page: import("puppeteer-core").Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) throw new Error(`selector not found: ${sel}`);
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      desc!.set!.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});
