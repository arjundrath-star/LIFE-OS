// Isolated WP4 browser journey: real auth/API/WebSocket paths, no scheduler or external requests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import puppeteer from 'puppeteer-core';
import { encode } from 'next-auth/jwt';
import type { TasksSnapshot, ClassesSnapshot, Assignment, SternTask, GradeCategory } from '@/lib/stern-types';

const origin = 'http://127.0.0.1:3140';
assert.equal(process.cwd(), '/home/Arjun/stern-build/wt/wp4');
assert.equal(process.env.RATHWORKSPACE_DB, '/home/Arjun/stern-build/db/wp4.db');
Object.assign(process.env, {
  NODE_ENV: 'production', RATHWORKSPACE_SECRETS_PATH: '/dev/null', NEXTAUTH_SECRET: 'stern-wp4-local-test-only',
  NEXTAUTH_URL: origin, GOOGLE_ALLOWED_EMAILS: 'student@example.com', GOOGLE_CLIENT_ID: 'local-placeholder',
  GOOGLE_CLIENT_SECRET: 'local-placeholder', STERN_VAULT_WRITE: '0', NEXT_TELEMETRY_DISABLED: '1',
});
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (new URL(url).origin !== origin) throw new Error('WP4 E2E blocks external requests');
  return originalFetch(input, init);
}) as typeof fetch;

async function main() {
  const { default: next } = await import('next');
  const { getDb } = await import('@/db');
  const { getHub } = await import('@/server/live');
  const { authorizeWebSocketCookie, guardAppWebSocketSession } = await import('@/lib/ws-auth');
  const { seedSternCourses } = await import('@/scripts/seed-stern-courses');
  const { undoBatch } = await import('@/lib/stern/audit');
  const db = getDb();
  seedSternCourses(); // Public catalog retained, all other test mutations undone below.
  const startAudit = Number(db.prepare('SELECT COALESCE(MAX(id),0) FROM stern_audit_log').pluck().get());
  const app = next({ dev: false, hostname: '127.0.0.1', port: 3140 });
  await app.prepare();
  const server = createServer(app.getRequestHandler()), hub = getHub();
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', async (req, socket, head) => {
    const auth = await authorizeWebSocketCookie(req.headers.cookie);
    if (req.url !== '/ws' || !auth) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => {
      if (!hub.addClient(ws, auth)) { ws.close(); return; }
      guardAppWebSocketSession(ws, req.headers.cookie, auth, { authorize: authorizeWebSocketCookie });
      ws.on('close', () => hub.removeClient(ws));
    });
  });
  await new Promise<void>(resolve => server.listen(3140, '127.0.0.1', resolve));
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  let observer: WebSocket | undefined;
  try {
    const token = await encode({ secret: process.env.NEXTAUTH_SECRET!, token: { email: 'student@example.com', name: 'Placeholder Student' }, maxAge: 3600 });
    const cookie = `next-auth.session-token=${token}`;
    const request = (area: string, body?: unknown, auth = true) => fetch(`${origin}/api/stern/${area}`, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { 'content-type': 'application/json', ...(auth ? { cookie } : {}) },
    });
    const post = async <T>(area: string, body: unknown) => {
      const response = await request(area, body), result = await response.json() as { result: T; batchId: string; error?: string };
      assert.equal(response.status, 200, result.error); return result;
    };
    for (const area of ['tasks', 'classes']) {
      assert.equal((await request(area, undefined, false)).status, 401);
      assert.equal((await request(area, { action: 'invalid' }, false)).status, 401);
      assert.equal((await request(area, null)).status, 400);
      assert.equal((await request(area, { action: 'invalid' })).status, 400);
      assert.equal((await fetch(`${origin}/stern/${area}`, { redirect: 'manual' })).status, 307);
    }
    assert.equal((await request('classes?course=bad')).status, 400);
    assert.equal((await request('classes?course=99999999')).status, 404);
    const classes = await (await request('classes')).json() as ClassesSnapshot;
    assert.equal(classes.courses.length, 4); assert.equal(classes.credits, 16);
    const course = classes.courses.find(c => c.code === 'STAT-UB 103')!;
    const catalogBefore = JSON.stringify(classes.courses.map(c => [c.id, c.title, c.meetings.length]));
    seedSternCourses();
    assert.equal(JSON.stringify((await (await request('classes')).json() as ClassesSnapshot).courses.map(c => [c.id, c.title, c.meetings.length])), catalogBefore);
    let wsMessages = 0;
    observer = new WebSocket('ws://127.0.0.1:3140/ws', { headers: { cookie } });
    observer.on('message', raw => { if (JSON.parse(raw.toString()).channel === 'stern') wsMessages++; });
    await new Promise<void>((resolve, reject) => { observer!.once('open', resolve); observer!.once('error', reject); });
    browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking'] });
    const page = await browser.newPage();
    // A fixed NY Friday exercises the weekday marker even when this runs on a weekend.
    await page.evaluateOnNewDocument(() => {
      const OriginalDate=Date;
      window.Date=new Proxy(OriginalDate,{
        construct(target,args){return Reflect.construct(target,args.length?args:['2026-09-04T18:00:00Z']);},
      });
    });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.setCookie({ name: 'next-auth.session-token', value: token, url: origin, httpOnly: true });
    // Career stays read-only. The existing component gets placeholder data so screenshots
    // cannot contain the copied database's personal career records.
    const careerFixture = JSON.parse(fs.readFileSync('tests/fixtures/stern/wp4-career.json', 'utf8'));
    await page.setRequestInterception(true);
    let failedArea='';
    page.on('request', req => {
      if(failedArea && req.url()===`${origin}/api/stern/${failedArea}`){void req.respond({status:500,contentType:'application/json',body:JSON.stringify({error:'Fixture load failure'})});return;}
      if (req.url() === `${origin}/api/career`) void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(careerFixture) });
      else if (req.url().startsWith(origin) || req.url().startsWith('data:')) void req.continue();
      else void req.abort();
    });
    const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
    const s = (id: string) => `[data-testid="${id}"]`;
    const click = async (id: string) => { await page.waitForSelector(s(id), { visible: true }); await page.click(s(id)); };
    const type = async (id: string, value: string) => { await page.$eval(s(id), el => { (el as HTMLInputElement).focus(); (el as HTMLInputElement).select(); }); await page.keyboard.type(value); };
    const waitText = (id: string, text: string) => page.waitForFunction((selector, text) => document.querySelector(selector)?.textContent?.includes(text), {}, s(id), text);
    const closed = () => page.waitForSelector(s('stern-course-dialog'), { hidden: true });
    for(const area of ['tasks','classes']){
      failedArea=area;
      await page.goto(`${origin}/stern/${area}`,{waitUntil:'networkidle0'});
      await page.waitForSelector(s(`stern-${area}-retry`));
      assert.equal(await page.$(`${s(`stern-${area==='tasks'?'tasks-view':'classes-index'}`)} [aria-busy="true"]`),null,'A failed initial fetch must stop the loading skeleton');
      failedArea='';await click(`stern-${area}-retry`);
      await page.waitForSelector(s(area==='tasks'?'stern-task-composer':'stern-course-card'));
      await page.waitForSelector(s(`stern-${area}-retry`),{hidden:true});
    }
    assert.equal(await page.$eval('.stern-week [aria-current="date"]',el=>el.textContent),'Fri · Sep 4');
    const identityTask=(await post<SternTask>('tasks',{action:'task.create',task:{title:'Placeholder manual identity',source:'imessage',dedupe_key:'fixture:client-key'}})).result;
    assert.equal(identityTask.source,'manual');assert.equal(identityTask.dedupe_key,'');
    const identityAssignment=(await post<Assignment>('classes',{action:'assignment.create',assignment:{course_id:course.id,title:'Placeholder manual identity',source:'auto_email',gmail_message_id:'fixture:client-message'}})).result;
    assert.equal(identityAssignment.source,'manual');assert.equal(identityAssignment.gmail_message_id,'');
    assert.equal((await request('classes',{action:'assignment.create',assignment:{course_id:course.id,title:'Placeholder manual identity',points_possible:30}})).status,409);
    await post('tasks',{action:'task.drop',id:identityTask.id});
    await post('classes',{action:'assignment.remove',id:identityAssignment.id});
    await page.goto(`${origin}/stern/tasks`, { waitUntil: 'networkidle0' });
    await click('stern-tasks-domain-campus');
    await waitText('stern-tasks-group-today','Nothing due today');
    await waitText('stern-tasks-group-none','No undated tasks');
    await click('stern-tasks-group');
    await waitText('stern-tasks-group-all','No open tasks');
    await click('stern-tasks-group');await click('stern-tasks-domain-all');
    await click('stern-tasks-domain-academic');
    await type('stern-task-title', 'Placeholder WP4 task');
    await page.select(s('stern-task-linked'), `course:${course.id}`);
    await click('stern-task-save'); await waitText('stern-tasks-list', 'Placeholder WP4 task');
    let snap = await (await request('tasks')).json() as TasksSnapshot;
    const task = snap.tasks.find(t => t.title === 'Placeholder WP4 task')!;
    assert.equal(task.course_code, 'STAT-UB 103');
    await click(`stern-task-check-${task.id}`);
    await page.waitForFunction(selector => !document.querySelector(selector), {}, `${s('stern-tasks-group-none')} ${s(`stern-task-check-${task.id}`)}`);
    assert.equal(await page.$eval(s('stern-tasks-done'), el => (el as HTMLDetailsElement).open), false);
    await click('stern-tasks-done-toggle'); await waitText('stern-tasks-done-list', task.title);
    await click(`stern-task-check-${task.id}`); await waitText('stern-tasks-group-none', task.title);
    await click(`stern-task-edit-${task.id}`); await type('stern-task-title', 'Placeholder WP4 edited'); await click('stern-task-save');
    await waitText('stern-tasks-list', 'Placeholder WP4 edited');
    await post<SternTask>('tasks', { action: 'task.update', id: task.id, patch: { title: 'Placeholder WP4 live update' } });
    await waitText('stern-tasks-list', 'Placeholder WP4 live update'); // Second writer reaches the open browser.
    await click(`stern-task-edit-${task.id}`); await click('stern-task-drop');
    await click('stern-tasks-history-toggle'); await waitText('stern-tasks-history', 'Placeholder WP4 live update');
    await post('tasks', { action: 'task.reopen', id: task.id });
    await click('stern-tasks-history-toggle'); await waitText('stern-tasks-group-none', 'Placeholder WP4 live update');
    fs.mkdirSync('shots', { recursive: true });
    await click('stern-tasks-done-toggle');
    await page.$eval('.stern-main', el => { el.scrollTop = 0; });
    await page.screenshot({ path: path.resolve('shots/stern-wp4-tasks.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.resolve('shots/stern-wp4-tasks-phone.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/stern/classes`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(s('stern-course-card'));
    assert.equal(await page.$$eval(s('stern-course-card'), els => els.length), 4);
    assert.equal(await page.$$eval('[data-testid^="stern-meeting-"]', els => els.length), 5);
    assert.equal(await page.$$eval('.stern-meeting-block', els => els.every(el => el.getBoundingClientRect().bottom <= el.parentElement!.getBoundingClientRect().bottom)), true, 'Meeting blocks fit the schedule');
    await page.screenshot({ path: path.resolve('shots/stern-wp4-classes.png'), fullPage: true });
    await click(`stern-course-open-${course.id}`); await page.waitForSelector(s('stern-course-tabs'));
    await click('stern-category-add'); await type('stern-category-name', 'Placeholder homework'); await type('stern-category-weight', '20'); await click('stern-category-save'); await closed();
    const category = (await (await request(`classes?course=${course.id}`)).json()).categories.find((c: GradeCategory) => c.name === 'Placeholder homework') as GradeCategory;
    await click('stern-assignment-add'); await type('stern-assignment-title', 'Placeholder problem set');
    await type('stern-assignment-possible', '10'); await page.select(s('stern-assignment-category'), String(category.id));
    await click('stern-assignment-save'); await closed(); await waitText('stern-assignments-list', 'Placeholder problem set');
    const assignment = (await (await request(`classes?course=${course.id}`)).json()).assignments.find((a: Assignment) => a.title === 'Placeholder problem set') as Assignment;
    for (const status of ['in_progress', 'submitted']) await post('classes', { action: 'assignment.set_status', id: assignment.id, status });
    await post('classes', { action: 'assignment.grade', id: assignment.id, points_earned: 8, points_possible: 10 });
    await waitText('stern-gradebook', '80.0%');
    await click(`stern-assignment-edit-${assignment.id}`); await type('stern-assignment-earned', '9'); await click('stern-assignment-save'); await closed(); await waitText('stern-gradebook', '90.0%');
    await click(`stern-category-edit-${category.id}`); await type('stern-category-weight', '25'); await click('stern-category-save'); await closed(); await waitText('stern-gradebook', '25% of weight graded');
    assert.equal((await request('classes', { action: 'category.upsert', category: { course_id: course.id, name: 'Invalid weights', weight_pct: 90 } })).status, 400);
    await click('stern-course-tab-notes'); await type('stern-course-notes', 'Placeholder syllabus curve note'); await click('stern-course-notes-save');
    await page.waitForFunction(selector => !(document.querySelector(selector) as HTMLButtonElement)?.disabled, {}, s('stern-course-notes-save'));
    await click('stern-meeting-add'); await page.select(s('stern-meeting-weekday'), '1'); await type('stern-meeting-room', 'Example 101'); await click('stern-meeting-save'); await closed(); await waitText('stern-course-meetings', 'Example 101');
    const meeting = (await (await request(`classes?course=${course.id}`)).json()).meetings[0];
    await click(`stern-meeting-edit-${meeting.id}`); await click('stern-meeting-remove'); await closed(); await waitText('stern-course-meetings', 'No meetings added');
    await click('stern-course-tab-exams'); await waitText('stern-exams-list', 'No exams added');
    await waitText('stern-exam-add','Add exam');await click('stern-exam-add');
    assert.equal(await page.$eval(s('stern-assignment-kind'),el=>(el as HTMLSelectElement).value),'exam');
    await type('stern-assignment-title','Placeholder exam');await click('stern-assignment-save');await closed();
    await waitText('stern-exams-list','Placeholder exam');
    await click('stern-exam-add');await type('stern-assignment-title','Placeholder exam');await click('stern-assignment-save');
    await waitText('stern-course-dialog','An assignment with this title already exists');
    await click('stern-course-dialog-close');await closed();
    await click('stern-course-tab-grades'); await waitText('stern-gradebook', 'Placeholder syllabus curve note');
    await click('stern-course-tab-assignments');
    await page.screenshot({ path: path.resolve('shots/stern-wp4-course.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.resolve('shots/stern-wp4-course-phone.png'), fullPage: true });
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`${origin}/stern/career`, { waitUntil: 'networkidle0' });
    await waitText('stern-career-view', 'Dormant until club season ends');
    await page.waitForSelector(s('career-row'));
    await page.hover(s('career-suggestions-toggle'));
    assert.equal(await page.$eval(s('career-suggestions-toggle'),el=>getComputedStyle(el).color),'rgb(87, 6, 140)');
    // Click a non-editable cell: inline inputs intentionally stop row propagation.
    await page.click(`${s('career-row')} td:nth-child(4)`);
    await page.waitForSelector('[role="dialog"]', { visible: true });
    await page.waitForFunction(() => { const el = document.querySelector('[role="dialog"]'); return el && getComputedStyle(el).opacity === '1'; });
    const theme = await page.$eval('[role="dialog"]', el => ({
      background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el.querySelector('h2.text-txt-primary')!).color,
      bodyClass: document.body.classList.contains('stern-theme'), portaled: !el.closest('[data-testid="stern-shell"]'),
    }));
    assert.deepEqual(theme, { background: 'rgb(255, 255, 255)', color: 'rgb(20, 20, 31)', bodyClass: true, portaled: true });
    assert.equal(await page.$eval('[role="dialog"] article',el=>getComputedStyle(el,'::before').backgroundColor),'rgb(87, 6, 140)');
    await page.screenshot({ path: path.resolve('shots/stern-wp4-career-drawer.png'), fullPage: true });
    await page.keyboard.press('Escape'); await page.waitForSelector('[role="dialog"]', { hidden: true });
    await page.goto(`${origin}/signin`, { waitUntil: 'networkidle0' });
    assert.equal(await page.evaluate(() => document.body.classList.contains('stern-theme')), false);
    assert.ok(wsMessages >= 15, `Expected mutation broadcasts, got ${wsMessages}`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ auth: '401 APIs / 307 pages / 200 placeholder session', courses: 4, meetings: 5, tasks: 'create/edit/complete/reopen/drop', gradeStanding: '80% -> 90%', dialogs: 'assignments/categories/meetings', liveMessages: wsMessages, phoneFits: true, careerPortal: theme, browserErrors: errors.length, reviewFixes:'load retry / empty copy / Friday marker / exam default / duplicate conflict / manual identity / Career hover and timeline' }));
  } finally {
    observer?.close(); await browser?.close();
    for (const client of wss.clients) client.terminate();
    wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); await app.close();
    const batches = db.prepare("SELECT batch_id,MAX(id) last_id FROM stern_audit_log WHERE id>? AND source<>'seed' AND action<>'undo' AND undone_at='' GROUP BY batch_id ORDER BY last_id DESC").all(startAudit) as { batch_id: string }[];
    for (const batch of batches) undoBatch(batch.batch_id);
    db.close(); console.log(JSON.stringify({ cleanup: 'test mutations undone; public courses retained' }));
  }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
