// Local-only browser/API check. Run after gate.sh has built this worktree.
// Uses placeholder auth, the assigned DB copy, and port 3110. Never starts the scheduler.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import puppeteer from "puppeteer-core";
import { encode } from "next-auth/jwt";
import type { RecruitingSnapshot, SternSnapshot } from "@/lib/stern-types";

const origin = "http://127.0.0.1:3110";
const root = process.cwd();
assert.equal(root, "/home/Arjun/stern-build/wt/wp1", "E2E is restricted to WP1");
assert.equal(process.env.RATHWORKSPACE_DB, "/home/Arjun/stern-build/db/wp1.db", "Use the assigned DB copy");
Object.assign(process.env, {
  NODE_ENV: "production", RATHWORKSPACE_SECRETS_PATH: "/dev/null", NEXTAUTH_SECRET: "stern-wp1-local-test-only",
  NEXTAUTH_URL: origin, GOOGLE_ALLOWED_EMAILS: "student@example.com", GOOGLE_CLIENT_ID: "local-placeholder", GOOGLE_CLIENT_SECRET: "local-placeholder",
  STERN_VAULT_WRITE: "0", NEXT_TELEMETRY_DISABLED: "1",
});
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).origin !== origin) throw new Error("E2E blocks external requests");
  return originalFetch(input, init);
}) as typeof fetch;

async function main() {
  const { default: next } = await import("next");
  const { getDb } = await import("@/db");
  const { getHub } = await import("@/server/live");
  const { authorizeWebSocketCookie, guardAppWebSocketSession } = await import("@/lib/ws-auth");
  const { insert, meta } = await import("@/lib/stern/recruiting-write");
  const { undoBatch } = await import("@/lib/stern/audit");
  const db = getDb();
  const startAudit = (db.prepare("SELECT COALESCE(MAX(id),0) id FROM stern_audit_log").get() as { id: number }).id;
  const app = next({ dev: false, hostname: "127.0.0.1", port: 3110 });
  await app.prepare();
  const server = createServer(app.getRequestHandler());
  const hub = getHub(); const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (req, socket, head) => {
    const auth = await authorizeWebSocketCookie(req.headers.cookie);
    if (req.url !== "/ws" || !auth) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      if (!hub.addClient(ws, auth)) { ws.close(); return; }
      guardAppWebSocketSession(ws, req.headers.cookie, auth, { authorize: authorizeWebSocketCookie });
      ws.on("close", () => hub.removeClient(ws));
    });
  });
  await new Promise<void>(resolve => server.listen(3110, "127.0.0.1", resolve));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let observer: WebSocket | undefined;
  try {
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { email: "student@example.com", name: "Placeholder Student" }, maxAge: 3600 });
    const cookie = `next-auth.session-token=${token}`;
    const request = async (body?: unknown, auth = true) => fetch(`${origin}/api/stern/recruiting`, { ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }), headers: { "content-type": "application/json", ...(auth ? { cookie } : {}) } });
    assert.equal((await request(undefined,false)).status, 401);
    assert.equal((await request({ action: "seed_catalog" },false)).status, 401);
    assert.equal((await fetch(`${origin}/stern/recruiting`, { redirect: "manual" })).status, 307);
    for (const body of [null, { action: "missing" }, { action: "club.update", clubId: "bad", patch: {} }]) assert.equal((await request(body)).status, 400);
    const post = async (body: unknown) => { const response = await request(body); const result = await response.json() as { snapshot: SternSnapshot; result: number; error?: string }; assert.equal(response.status,200,result.error); return result; };
    let snap = (await post({ action: "seed_catalog" })).snapshot.recruiting;
    assert.equal(snap.catalog.length,32);
    // The assigned fresh copy starts with catalog-only clubs. Avoid hiding another user's board.
    assert.equal(snap.clubs.length,0,"Browser fixture needs an unselected Stern catalog");
    const club = snap.catalog.find(c => c.short_name === "SVS")!;
    let wsMessages = 0;
    observer = new WebSocket("ws://127.0.0.1:3110/ws", { headers: { cookie } });
    observer.on("message", raw => { const payload = JSON.parse(raw.toString()); if (payload.channel === "stern") wsMessages++; });
    await new Promise<void>((resolve,reject) => { observer!.once("open",resolve); observer!.once("error",reject); });
    browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setCookie({ name: "next-auth.session-token", value: token, url: origin, httpOnly: true });
    await page.setRequestInterception(true);
    page.on("request", req => { if (req.url().startsWith(origin) || req.url().startsWith("data:")) void req.continue(); else void req.abort(); });
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    const selector = (id: string) => `[data-testid="${id}"]`;
    const click = async (id: string) => { const s = selector(id); await page.waitForSelector(s,{visible:true}); await page.click(s); };
    const type = async (id: string, value: string) => { await page.$eval(selector(id), el => { const input = el as HTMLInputElement; input.focus(); input.select(); }); await page.keyboard.type(value); };
    const waitText = async (id: string, text: string) => page.waitForFunction((s,t) => document.querySelector(s)?.textContent?.includes(t), {}, selector(id), text);
    await page.goto(`${origin}/stern/recruiting`, { waitUntil: "networkidle0" });
    await page.waitForSelector(selector("stern-recruiting-empty"));
    assert.equal(await page.$eval(selector("stern-club-add"), el => getComputedStyle(el).backgroundColor), "rgb(87, 6, 140)", "Primary action uses NYU violet");
    await click("stern-club-add"); await type("stern-catalog-search","Strategic Venture");
    await click(`stern-catalog-toggle-${club.id}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="stern-club-card"]').length === 1);
    await click("stern-recruiting-dialog-close");
    await click("stern-club-priority-3");
    await page.waitForFunction(s => document.querySelector(s)?.getAttribute("aria-pressed") === "true", {}, selector("stern-club-priority-3"));
    fs.mkdirSync(path.join(root,"shots"),{recursive:true});
    await page.screenshot({ path: path.join(root,"shots/stern-wp1-board.png"),fullPage:true });
    await click(`stern-club-open-${club.id}`);
    await page.waitForSelector(selector("stern-club-detail-tabs"));
    assert.equal(await page.$eval(selector("stern-club-tab-people"), el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", "Inactive tabs stay transparent");
    assert.equal(await page.$$eval('[data-testid="stern-club-detail-tabs"] [role="tab"]', els => els.length),5);
    assert.equal(await page.$$eval('[data-testid="stern-program-card"]', els => els.length),2);
    assert.equal(await page.$$eval('[data-testid="stern-checklist-item"]', els => els.length),7);
    const checklistId = await page.$eval('[data-testid^="stern-checklist-toggle-"]',el => el.getAttribute("data-testid")!);
    await click(checklistId);
    await page.waitForFunction(s => (document.querySelector(s) as HTMLInputElement)?.checked,{},selector(checklistId));
    await click("stern-club-tab-application");
    snap = await (await request()).json() as RecruitingSnapshot;
    const program = snap.clubs[0].programs[0];
    await type(`stern-program-requirements-${program.id}`,"Resume\nShort answer");
    await type(`stern-program-dress-${program.id}`,"Business casual");
    await click(`stern-program-save-${program.id}`);
    await waitText("stern-recruiting-undo","Undo last change");
    await page.select(selector(`stern-program-status-${program.id}`),"open");
    await page.waitForFunction(s => (document.querySelector(s) as HTMLSelectElement)?.value === "open",{},selector(`stern-program-status-${program.id}`));
    assert.equal((await request({ action: "program.set_status", programId: program.id, status: "accepted" })).status,400);
    await click("stern-club-tab-prep");
    await type(`stern-prep-new-question-${program.id}`,"Why this program?");
    await type(`stern-prep-new-answer-${program.id}`,"Placeholder practice answer.");
    await click(`stern-prep-add-${program.id}`);
    await page.waitForSelector('[data-testid^="stern-prep-answer-"]');
    await page.reload({waitUntil:"networkidle0"}); await click("stern-club-tab-prep");
    assert.equal(await page.$eval('[data-testid^="stern-prep-answer-"]',el => (el as HTMLTextAreaElement).value),"Placeholder practice answer.");
    const fixtureMeta = meta();
    const personId = db.transaction(() => { const id = insert("person",{display_name:"Placeholder Officer",email:"officer@example.com"},fixtureMeta); insert("affiliation",{person_id:id,club_id:club.id,is_eboard:1,relevant_for_recruiting:1,role:"Placeholder role"},fixtureMeta); return id; }).immediate();
    const chat = await post({ action: "chat.create", personId, clubId: club.id });
    await click("stern-club-tab-people"); await waitText("stern-club-people-list","Placeholder Officer");
    assert.equal(await page.$eval(selector(`stern-chat-draft-${personId}`),el => (el as HTMLButtonElement).disabled),false,"Merged network route enables the optional draft action");
    await page.select(selector(`stern-chat-state-${chat.result}`),"requested");
    await page.waitForFunction(s => (document.querySelector(s) as HTMLSelectElement)?.value === "requested",{},selector(`stern-chat-state-${chat.result}`));
    await post({action:"chat.transition",chatId:chat.result,state:"reply_received"});
    await page.waitForFunction(s => (document.querySelector(s) as HTMLSelectElement)?.value === "reply_received",{},selector(`stern-chat-state-${chat.result}`));
    await page.select(selector(`stern-chat-state-${chat.result}`),"scheduled");
    await type("stern-chat-scheduled-at","2026-09-08T14:00:00-04:00"); await type("stern-chat-scheduled-location","Campus"); await click("stern-chat-schedule-save");
    await page.waitForSelector(selector("stern-chat-schedule-save"),{hidden:true});
    await page.select(selector(`stern-chat-state-${chat.result}`),"done");
    await page.waitForFunction(s => (document.querySelector(s) as HTMLSelectElement)?.value === "done",{},selector(`stern-chat-state-${chat.result}`));
    await type(`stern-chat-takeaways-${chat.result}`,"Prepare the case discussion."); await click(`stern-chat-save-${chat.result}`);
    await page.waitForFunction(s => !(document.querySelector(s) as HTMLButtonElement)?.disabled,{},selector(`stern-chat-save-${chat.result}`));
    await click("stern-club-tab-prep"); await waitText("stern-prep-quotes","Prepare the case discussion.");
    await click("stern-club-tab-timeline"); await waitText("stern-club-activity-list","Coffee chat: Done");
    // Timeline seed rows are informational, and ordinary undo requires a reviewable confirmation.
    snap = await (await request()).json() as RecruitingSnapshot;
    const seedRow = snap.clubs[0].timeline.find(a => a.source === "seed")!;
    assert.equal(seedRow.batch_id, "");
    assert.equal(await page.$(selector(`stern-activity-undo-${seedRow.id}`)), null);
    await post({ action: "club.update", clubId: club.id, patch: { notes: "Placeholder undo verification" } });
    snap = await (await request()).json() as RecruitingSnapshot;
    const noteRow = snap.clubs[0].timeline.find(a => a.summary === "Club: notes updated" && !a.undone_at)!;
    await click(`stern-activity-undo-${noteRow.id}`);
    await waitText("stern-activity-undo-summary", "club field change");
    assert.equal(((await (await request()).json()) as RecruitingSnapshot).clubs[0].notes, "Placeholder undo verification");
    await click("stern-recruiting-dialog-close");
    assert.equal(((await (await request()).json()) as RecruitingSnapshot).clubs[0].notes, "Placeholder undo verification");
    await click(`stern-activity-undo-${noteRow.id}`); await click("stern-activity-undo-confirm");
    await page.waitForSelector(selector("stern-activity-undo-confirm"), { hidden: true });
    snap = await (await request()).json() as RecruitingSnapshot;
    assert.notEqual(snap.clubs[0].notes, "Placeholder undo verification");
    for (const row of snap.clubs[0].timeline.filter(a => a.source === "undo")) {
      assert.equal(row.batch_id, "");
      assert.equal(await page.$(selector(`stern-activity-undo-${row.id}`)), null);
    }
    const createRow = snap.clubs[0].timeline.find(a => a.summary === "Program added" && !a.undone_at)!;
    await click(`stern-activity-undo-${createRow.id}`);
    await waitText("stern-activity-undo-summary", "Exploratory program");
    await click("stern-activity-undo-confirm");
    await page.waitForFunction(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.includes("undo the newer batches first"));
    assert.equal(((await (await request()).json()) as RecruitingSnapshot).clubs[0].prep.length, 1);
    await click("stern-recruiting-dialog-close");
    for (const key of ["gmail_thread_id", "calendar_event_id"]) assert.equal((await request({ action: "chat.transition", chatId: chat.result, state: "thank_you_sent", meta: { [key]: "spoofed" } })).status, 400);
    await click("stern-club-tab-overview");
    await page.screenshot({path:path.join(root,"shots/stern-wp1-detail.png"),fullPage:true});
    await page.setViewport({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),true,"Detail should fit phone width");
    await page.screenshot({path:path.join(root,"shots/stern-wp1-phone.png"),fullPage:true});
    await click("stern-club-archive"); await click("stern-club-archive-confirm");
    await page.waitForSelector(selector("stern-club-archive-confirm"),{hidden:true});
    await page.waitForFunction(() => document.querySelector('[data-testid="stern-club-detail"] [data-value="archived"]'));
    await click("stern-detail-back"); await click("stern-recruiting-filter-archived");
    await page.waitForSelector('[data-testid="stern-club-card"].archived');
    await click("stern-process-archive"); await click("stern-process-archive-confirm");
    await page.waitForSelector(selector("stern-process-archive-confirm"),{hidden:true});
    await page.waitForFunction(() => (document.querySelector('[data-testid="stern-process-archive"]') as HTMLButtonElement)?.disabled);
    await click("stern-recruiting-undo");
    await page.waitForFunction(() => !(document.querySelector('[data-testid="stern-process-archive"]') as HTMLButtonElement)?.disabled);
    assert.ok(wsMessages >= 10,`Expected mutation broadcasts, got ${wsMessages}`);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({auth:"401 anonymous API, 307 anonymous page, 200 placeholder session",catalog:32,tabs:5,checklist:7,programSaved:true,prepPersisted:true,chatTransitions:true,liveMessages:wsMessages,archiveUndo:true,timelineUndoConfirmed:true,unsafeUndoBlocked:true,provenanceRejected:true,phoneFits:true,browserErrors:0}));
  } finally {
    observer?.close(); await browser?.close();
    for (const client of wss.clients) client.terminate();
    wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); await app.close();
    // Reverse only this test's writes; retain the public seed, and do not touch unrelated rows.
    const batches = db.prepare("SELECT batch_id, MAX(id) last_id FROM stern_audit_log WHERE id > ? AND source <> 'seed' AND action <> 'undo' AND undone_at = '' GROUP BY batch_id ORDER BY last_id DESC").all(startAudit) as {batch_id:string}[];
    for (const batch of batches) undoBatch(batch.batch_id);
    console.log(JSON.stringify({cleanup:"test mutations undone; public catalog retained"}));
    db.close();
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
