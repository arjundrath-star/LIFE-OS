// Local-only UI verification. Start Next (without the scheduler) on 127.0.0.1:3120
// with HOSTNAME=127.0.0.1 and a runtime-generated NEXTAUTH_SECRET. Never run against production or a real vault.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
const origin = "http://127.0.0.1:3120";
const artifactDir = path.join(process.cwd(), ".stern-network-e2e");
const secret = process.env.NEXTAUTH_SECRET;
async function main() {
  assert.ok(secret, "NEXTAUTH_SECRET must match the isolated loopback server");
  assert.equal(process.env.RATHWORKSPACE_DB, "/home/Arjun/stern-build/db/wp2.db", "Use the assigned WP2 DB");
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.setDefaultTimeout(60000);
  await page.setRequestInterception(true);
  let tasksMissing = false;
  let networkGets = 0;
  page.on("request", request => {
    if (request.url().includes("/api/stern/network") && request.method() === "GET") networkGets++;
    if (tasksMissing && request.url().includes("/api/stern/tasks")) { void request.respond({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) }); return; } if (request.url().startsWith(origin) || request.url().startsWith("data:")) void request.continue(); else void request.abort(); });
  // Drive the real LiveProvider with deterministic local snapshots, without starting a scheduler.
  await page.evaluateOnNewDocument(() => {
    class LocalSocket {
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      close() {}
      constructor() {
        (window as any).__sternPush = (payload: unknown) => this.onmessage?.({ data: JSON.stringify({ channel: "stern", payload }) });
        setTimeout(() => this.onopen?.(), 0);
      }
    }
    (window as any).WebSocket = LocalSocket;
  });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  const batches: string[] = [];
  page.on("response", async response => {
    if (response.url().includes("/api/stern/network") && response.request().method() === "POST" && response.ok()) {
      const value = await response.json().catch(() => null); if (value?.batchId) batches.push(value.batchId);
    }
  });
  try {
    const anonymous = await page.goto(`${origin}/api/stern/network`); assert.equal(anonymous?.status(), 401);
    const token = await encode({ secret, token: { email: "fixture@example.test", name: "Fixture User" }, maxAge: 3600 });
    await browser.setCookie({ name: "next-auth.session-token", value: token, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax", secure: false });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/stern/network`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="stern-network-table"]');
    await page.click('[data-testid="stern-quick-add-button"]');
    await page.waitForSelector('[data-testid="stern-quick-add"]');
    await page.type('[data-testid="stern-quick-add-name"]', "Browser Example Student");
    await page.type('[data-testid="stern-quick-add-org"]', "Example Browser Club");
    await page.type('[data-testid="stern-quick-add-role"]', "Member");
    await page.type('[data-testid="stern-quick-add-email"]', "browser.student@example.test");
    await page.click('[data-testid="stern-quick-add-eboard"]');
    await Promise.all([page.waitForResponse(r => r.url().includes("/api/stern/network") && r.request().method() === "POST"), page.click('[data-testid="stern-quick-add-save"]')]);
    await page.waitForSelector('[data-testid="stern-quick-add"]', { hidden: true });
    await page.waitForFunction(() => document.querySelector('[data-testid="stern-network-table"]')?.textContent?.includes("Browser Example Student"));
    const personId = await page.$eval('[data-testid="stern-network-row"]', el => el.getAttribute("data-person-id"));
    assert.ok(personId);
    await page.click('[data-testid="stern-network-add"]');
    await page.type('[data-testid="stern-quick-add-name"]', "Browser Example Student");
    await page.type('[data-testid="stern-quick-add-email"]', "browser.student@example.test");
    await page.click('[data-testid="stern-quick-add-relationship-mentor"]');
    await page.click('[data-testid="stern-quick-add-reach-out"]');
    await page.click('[data-testid="stern-quick-add-save"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="stern-quick-add-notice"]')?.textContent?.includes("Matched existing person"));
    await page.click('[data-testid="stern-quick-add-matched-person"]');
    await page.waitForSelector('[data-testid="stern-person-notes"]');
    assert.match(page.url(), /person=/);
    assert.equal(await page.$eval('[data-testid="stern-person-status"]', el => (el as HTMLSelectElement).value), "need_to_reach_out");
    const liveSnapshot = await page.evaluate(async () => (await fetch("/api/stern")).json());
    await page.evaluate(snapshot => (window as any).__sternPush(snapshot), liveSnapshot);
    await page.waitForNetworkIdle();
    const idleGets = networkGets;
    for (let i = 0; i < 3; i++) await page.evaluate(({ snapshot, tick }) => (window as any).__sternPush({ ...snapshot, updatedAt: `fixture-tick-${tick}` }), { snapshot: liveSnapshot, tick: i });
    await page.waitForNetworkIdle();
    assert.equal(networkGets, idleGets, "idle/unrelated Stern snapshots must not refetch table or drawer");
    await page.evaluate(snapshot => (window as any).__sternPush({ ...snapshot, network: { ...snapshot.network, version: "fixture-external-change" } }), liveSnapshot);
    await page.waitForNetworkIdle();
    assert.equal(networkGets, idleGets + 2, "changed network snapshot refreshes table and drawer once");
    const drawerWidth = await page.$eval('[data-testid="stern-person-drawer"]', el => el.getBoundingClientRect().width); assert.equal(drawerWidth, 440);
    for (const section of ["contacts", "affiliations", "coffee-chats", "drafts", "touchpoints"]) assert.ok(await page.$(`[data-testid="stern-person-${section}"]`));
    await page.type('[data-testid="stern-person-notes"]', "Browser fixture note autosaved.");
    await page.waitForFunction(() => document.querySelector('[data-testid="stern-person-drawer"]')?.textContent?.includes("Saved"));
    await page.click('[data-testid="stern-person-upgrade-friend"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="stern-person-upgrade-friend"]'));
    await page.click('[data-testid="stern-strength-4"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="stern-strength-4"]')?.getAttribute("aria-checked") === "true");
    await page.screenshot({ path: path.join(artifactDir, "desktop-drawer.png") });
    await page.keyboard.press("Escape");
    await page.waitForSelector('[data-testid="stern-person-drawer"]', { hidden: true });
    assert.equal(new URL(page.url()).searchParams.has("person"), false);
    await page.click('[data-testid="stern-network-relationship-friend"]');
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="stern-network-row"]').length === 1);
    await page.screenshot({ path: path.join(artifactDir, "desktop-network.png") });
    await page.goto(`${origin}/stern/network?person=${personId}`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="stern-person-notes"]');
    assert.equal(await page.$eval('[data-testid="stern-person-notes"]', el => (el as HTMLTextAreaElement).value), "Browser fixture note autosaved.");
    await page.keyboard.press("Escape");
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.goto(`${origin}/stern/network?add=1`, { waitUntil: "networkidle2" });
    await page.waitForSelector('[data-testid="stern-quick-add"]');
    const rect = await page.$eval('[data-testid="stern-quick-add"]', el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width, bottom: r.bottom }; });
    assert.equal(rect.width, 390); assert.equal(rect.x, 0); assert.ok(rect.bottom <= 845);
    await page.waitForSelector('[data-testid="stern-quick-add-club"]');
    await page.screenshot({ path: path.join(artifactDir, "phone-quick-add.png") });
    await page.setViewport({ width: 390, height: 520, isMobile: true, hasTouch: true });
    await page.waitForFunction(() => (document.querySelector('[data-testid="stern-quick-add-save"]')?.getBoundingClientRect().bottom || 1000) <= 520);
    tasksMissing = true;
    await page.click('[data-testid="stern-quick-add-task"]');
    await page.waitForSelector('[data-testid="stern-quick-add-tasks-unavailable"]');
    assert.equal(await page.$eval('[data-testid="stern-quick-add-save"]', el => (el as HTMLButtonElement).disabled), true);
    await page.click('[data-testid="stern-quick-add-note"]');
    await page.select('[data-testid="stern-quick-add-person-select"]', String(personId));
    await page.type('[data-testid="stern-quick-add-note-summary"]', "Example quick note");
    await page.click('[data-testid="stern-quick-add-save"]');
    await page.waitForSelector('[data-testid="stern-quick-add"]', { hidden: true });
    await page.waitForFunction(() => !new URL(window.location.href).searchParams.has("add"));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ anonymousStatus: 401, duplicateCaptureNotice: true, unchangedLiveGets: 0, changedLiveGets: 2, desktopTable: true, drawerWidth, deepLink: true, escape: true, notesAutosave: true, relationshipAndStrength: true, phoneSheet: rect, task404Fallback: true, quickNote: true, keyboardViewportSaveVisible: true, browserErrors: errors.length }));
  } finally {
    // Undo only this journey's mutation batches, in reverse order, through the gated audit API.
    for (const batchId of batches.reverse()) {
      await page.evaluate(async batch => { const r = await fetch("/api/stern", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "audit.undo", batchId: batch }) }); if (!r.ok) throw new Error(`cleanup failed ${r.status}`); }, batchId);
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
