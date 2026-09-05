// WP6 isolated browser verification. No scheduler; only placeholder browser responses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import puppeteer from 'puppeteer-core';
import { encode } from 'next-auth/jwt';
import type { SternSnapshot, SternAutomationResponse } from '@/lib/stern-types';
const origin='http://127.0.0.1:3160';
const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
assert.ok(process.env.RATHWORKSPACE_DB,'Set an isolated RATHWORKSPACE_DB');
const dbPath=fs.realpathSync(process.env.RATHWORKSPACE_DB!);
for(const forbidden of [path.join(os.homedir(),'rathworkspace'),'/home/Arjun/rathworkspace']) assert.ok(dbPath!==forbidden&&!dbPath.startsWith(`${forbidden}/`),'Refusing production database');
assert.ok(!dbPath.split(path.sep).includes('data'),'Refusing a checkout data directory');
process.chdir(appRoot);
Object.assign(process.env,{NODE_ENV:'development',RATHWORKSPACE_SECRETS_PATH:'/dev/null',NEXTAUTH_SECRET:'wp6-local-test-only',NEXTAUTH_URL:origin,GOOGLE_ALLOWED_EMAILS:'student@stern.nyu.edu',GOOGLE_CLIENT_ID:'placeholder',GOOGLE_CLIENT_SECRET:'placeholder',STERN_LLM_MODE:'fixture',STERN_NOTIFY_DRY_RUN:'1',STERN_VAULT_WRITE:'0',NEXT_TELEMETRY_DISABLED:'1'});
const nativeFetch=globalThis.fetch;
globalThis.fetch=((input:string|URL|Request,init?:RequestInit)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;if(new URL(url).origin!==origin)throw new Error('WP6 blocks external fetch');return nativeFetch(input,init);}) as typeof fetch;
async function main(){
 const {default:next}=await import('next'),{getDb}=await import('@/db'),{sternSnapshot}=await import('@/lib/stern/snapshot');
 const {authorizeWebSocketCookie}=await import('@/lib/ws-auth');
 const app=next({dev:true,hostname:'127.0.0.1',port:3160});await app.prepare();
 const server=createServer(app.getRequestHandler()),wss=new WebSocketServer({noServer:true});
 let fixture:SternSnapshot, mode='normal';
 server.on('upgrade',async(req,socket,head)=>{if(req.url!=='/ws'){app.getUpgradeHandler()(req,socket,head);return;}if(!await authorizeWebSocketCookie(req.headers.cookie)){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>{if(mode==='normal')ws.send(JSON.stringify({channel:'stern',payload:fixture,ts:Date.now()}));});});
 await new Promise<void>(resolve=>server.listen(3160,'127.0.0.1',resolve));
 let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
 try {
  const initial=sternSnapshot(),stamp=new Date().toISOString();
  const counts=Object.fromEntries(Object.keys(initial.counts).map(k=>[k,0])) as SternSnapshot['counts'];
  fixture={...initial,updatedAt:stamp,counts:{...counts,coffeeChatsOwed:3,replyOwed:1,suggestionsPending:1,tasksDueToday:2,deadlines14d:1},
   recruiting:{...initial.recruiting,clubs:[],catalog:[],deadlines:[],windows:[],process:null,counts:{coffeeChatsOwed:0,deadlines14d:0,archived:0,interested:0,applying:0,interviewing:0}},
   network:{...initial.network,recent:[],counts:{...initial.network.counts,total:0,needToReachOut:0,followUpsOwed:0}},
   tasks:{...initial.tasks,tasks:[],dueToday:[],overdue:[],doneToday:[],groups:[],links:[],counts:{open:0,dueToday:0,overdue:0,perDomain:{academic:0,professional:0,campus:0}}},
   classes:{...initial.classes,courses:[],schedule:[],nextMeeting:null,dueSoon:[],standings:[],credits:0},
   automation:{...initial.automation,lastScanAt:stamp,lastCalendarSyncAt:stamp,lastError:'',scanState:[],recentMessages:[],suggestions:[],drafts:[],audit:[],reminders:[],notificationSettings:{'stern.memo_email':'memo@example.com','stern.imessage_target':'','stern.hermes_alias':'stern','stern.quiet_hours_start':'23:00','stern.quiet_hours_end':'07:00','stern.threshold_auto':'0.85','stern.threshold_suggest':'0.6'}},
   needsYouTotal:2,autoAppliedToday:[],needsYou:[{key:'reply-1',kind:'reply',title:'Reply waiting on you · Example Person',at:stamp,href:'/stern/network?person=1',actionLabel:'Open'},{key:'draft-1',kind:'draft',title:'Draft ready to review · Example Contact',at:stamp,href:'/stern/automation#draft-1',actionLabel:'Review'}],
   schedule:[{key:'class-1',title:'STAT-UB 103 · Statistics and Regression',startAt:`${initial.today}T13:30:00Z`,location:'Example classroom',kind:'lecture',href:'/stern/classes',prepHref:''},{key:'chat-1',title:'Coffee chat · Example Person',startAt:`${initial.today}T15:00:00Z`,location:'Example cafe',kind:'coffee_chat',href:'/stern/network',prepHref:'/stern/recruiting/1#prep'}],reminders:{lastMemoAt:`${initial.today}T12:00:00Z`}};
  fixture.recruiting.deadlines=[{id:1,clubId:1,club:'Finance Society',name:'Exploratory application',deadlineAt:initial.today,days:0,status:'open',track:'exploratory'}];
  const audit={entity_label:'Example Person',id:1,entity_type:'person',entity_id:1,action:'update',field:'status',before_value:'reached_out',after_value:'replied',source:'auto_email',confidence:.92,evidence_type:'gmail',gmail_account:'student@example.com',gmail_message_id:'example',evidence_excerpt:'Happy to grab coffee next week.',batch_id:'example-batch',undone_at:'',undo_of:0,created_at:stamp};
  fixture.autoAppliedToday=[audit];fixture.automation.audit=[audit];
  fixture.automation.suggestions=[{id:1,summary:'Mark Example Person as Reply received',created_at:stamp,evidence_type:'gmail',entity_type:'coffee_chat',entity_id:1,suggestion_type:'coffee_chat_state',evidence_subject:'Example scheduling reply',evidence_excerpt:'Tuesday might work; I will confirm.',confidence:.72,state:'pending',proposed_data:'{"state":"reply_received"}',gmail_account:'student@example.com',gmail_message_id:'example'}];
  fixture.automation.drafts=[{id:1,person_id:1,kind:'request',subject:'Coffee chat request',body:'Hello Example Person,\n\nWould you have time for a short conversation next week?',state:'generated',to_email:'contact@example.com',updated_at:stamp}];
  fixture.automation.reminders=[{id:1,rule_key:'reply_owed',entity_type:'coffee_chat',entity_id:1,fire_at:stamp,channel:'imessage',message:JSON.stringify({subject:'Reply waiting',body:'Example Person is waiting for a reply.'}),delivery_status:'pending',sent_at:'',error:'',created_at:stamp},{id:2,rule_key:'memo',entity_type:'',entity_id:0,fire_at:stamp,channel:'email',message:JSON.stringify({subject:'Morning memo',body:'Example dry-run memo.'}),delivery_status:'skipped',sent_at:'',error:'dry-run',created_at:stamp}];
  const automation: SternAutomationResponse={...fixture.automation,updatedAt:stamp,connectHref:'/api/google/connect?set=stern&target=stern&login_hint=student%40stern.nyu.edu',connections:[['stern-google-stern','Stern Gmail','on_healthy'],['stern-google-nyu','NYU Gmail','on_broken'],['career-google-personal','Personal Gmail','off'],['stern-llm-codex','Codex classifier','on_healthy'],['hermes','Hermes','off']].map(([id,label,state])=>({id,label,state,detail:state==='on_broken'?'Google account needs re-auth':state==='off'?'Not connected':'Health checked',account:id.includes('google')?'student@example.com':'',scopes:id.includes('google')?['gmail.readonly','calendar.events']:[],lastScan:stamp,reconnectHref:'#'}))};
  fixture.automation.connections=automation.connections;
  // Schema-shaped placeholders exercise existing detail screens without persisting personal records.
  const blank=(table:string):any=>Object.fromEntries((getDb().prepare(`PRAGMA table_info(${table})`).all() as {name:string;type:string}[]).map(c=>[c.name,c.type==='TEXT'?'':0]));
  const program={...blank('stern_programs'),id:1,club_id:1,name:'Exploratory program',track:'exploratory',status:'open',app_deadline_at:initial.today};
  const person={...blank('people'),id:1,display_name:'Example Person',first_name:'Example',last_name:'Person',email:'contact@example.com',org:'Finance Society',relationship_type:'club_connect',strength:3,status:'replied',sphere:'stern',source:'manual',affiliations:[],touchpoints:[],mergedRecords:[],coffeeChats:[],drafts:[]};
  const club={...blank('stern_clubs'),id:1,process_id:1,name:'Finance Society',short_name:'FS',slug:'example-club',category:'finance',status:'applying',interested:1,priority:1,target_chats:2,programs:[program],checklist:[],checklistDone:0,checklistTotal:0,chatsDone:0,chats:[],people:[],nextDeadline:fixture.recruiting.deadlines[0],prep:[],timeline:[]};
  fixture.recruiting.clubs=[club];fixture.recruiting.catalog=[club];fixture.recruiting.process={id:1,slug:'example',name:'Fall recruiting',kind:'club_recruiting',season:'Fall',status:'active',notes:'',archived_at:''};
  const assignment={...blank('assignments'),id:1,course_id:1,title:'Example problem set',kind:'homework',status:'upcoming',source:'manual',due_at:initial.today,points_earned:null,points_possible:20};
  const course={...blank('courses'),id:1,code:'STAT-UB 103',title:'Statistics and Regression',term:'Fall',credits:4,room:'Example classroom',professor:'Example Professor',meetings:[{id:1,course_id:1,weekday:5,start_time:'09:30',end_time:'10:45',room:'Example classroom',kind:'lecture'}],assignments:[assignment],categories:[],standing:{percentage:null,method:'none',gradedWeight:0,earned:0,possible:0,categories:[]},nextDue:assignment};
  fixture.classes.courses=[course];fixture.classes.credits=4;fixture.classes.schedule=[{...course.meetings[0],date:initial.today,start_at:`${initial.today}T13:30:00Z`,code:course.code,title:course.title}];
  const task={...blank('stern_tasks'),id:1,title:'Example task',domain:'academic',priority:2,status:'open',source:'manual',due_at:initial.today,course_code:course.code,course_id:1,person_name:'',club_name:''};
  fixture.tasks.tasks=[task];fixture.tasks.groups=[{key:'today',title:'Due today',rows:[task]}];fixture.tasks.dueToday=[task];
  const token=await encode({secret:process.env.NEXTAUTH_SECRET!,token:{email:'student@stern.nyu.edu',name:'Example Student'},maxAge:3600});
  // Real auth gate requests, with no source scan or writes.
  assert.equal((await fetch(`${origin}/api/stern?q=test`)).status,401);
  assert.equal((await fetch(`${origin}/stern`,{redirect:'manual'})).status,307);
  const authorized=await fetch(`${origin}/api/stern?q=wp6-no-match`,{headers:{cookie:`next-auth.session-token=${token}`}});assert.equal(authorized.status,200);
  const output=path.join(process.cwd(),'docs/plans/stern/reports/wp6-screenshots');fs.mkdirSync(output,{recursive:true});
  browser=await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-background-networking']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});await page.setCookie({name:'next-auth.session-token',value:token,url:origin,httpOnly:true});
  await page.evaluateOnNewDocument(()=>{document.addEventListener('DOMContentLoaded',()=>{const style=document.createElement('style');style.textContent='nextjs-portal {display:none!important}';document.head.appendChild(style);});});
  await page.setRequestInterception(true);
  let undoConflict=false,automationGets=0;const posts:Record<string,unknown>[]=[];
  page.on('request',req=>{const u=new URL(req.url());if(u.origin!==origin){void req.abort();return;}
   const respond=(body:unknown,status=200)=>void req.respond({status,contentType:'application/json',body:JSON.stringify(body)});
   if(['/api/stern/automation','/api/stern'].includes(u.pathname)&&req.method()==='POST'){const body=JSON.parse(req.postData()||'{}');posts.push(body);if(body.action==='settings.update'&&Number(body.settings['stern.threshold_suggest'])>Number(body.settings['stern.threshold_auto']))return respond({error:'Suggestion threshold must not exceed auto threshold'},400);if(['batch.undo','audit.undo'].includes(body.action)&&undoConflict)return respond({error:'Undo would delete rows from another batch'},409);return respond({...automation,snapshot:{...fixture,updatedAt:new Date().toISOString()},result:['batch.undo','audit.undo'].includes(body.action)?{reverted:0,skipped:1}:body.action==='reminder.send_test'?{delivery_status:'skipped',error:'dry-run'}:{}});}
   if(u.pathname==='/api/stern'&&u.searchParams.has('q'))return respond({results:u.searchParams.get('q')?[{id:1,kind:'person',label:'Example Person',detail:'Example Club',href:'/stern/network?person=1'},{id:1,kind:'task',label:'Example task',detail:'academic',href:'/stern/tasks?task=1'}]:[]});
   if(u.pathname==='/api/stern'){if(mode==='error')return respond({error:'Fixture unavailable'},500);if(mode==='loading'){setTimeout(()=>respond(fixture),1500);return;}return respond(mode==='empty'?{...fixture,counts,needsYou:[],needsYouTotal:0,schedule:[],autoAppliedToday:[],recruiting:{...fixture.recruiting,deadlines:[]},reminders:{lastMemoAt:''}}:fixture);}
   if(u.pathname==='/api/stern/automation'){automationGets++;return respond(automation);}
   if(u.pathname==='/api/stern/recruiting')return respond(fixture.recruiting);
   if(u.pathname==='/api/stern/tasks')return respond(fixture.tasks);
   if(u.pathname==='/api/stern/classes')return respond(u.searchParams.has('course')?course:fixture.classes);
   if(u.pathname==='/api/stern/network')return respond(u.searchParams.has('person')?person:{...fixture.network,people:[person],total:1,page:1,pageSize:50,clubs:[club]});
   if(u.pathname==='/api/career')return respond(JSON.parse(fs.readFileSync('tests/fixtures/stern/wp4-career.json','utf8')));
   if(u.pathname.startsWith('/api/'))return respond({});
   void req.continue();
  });
  const shot=async(name:string)=>{await page.screenshot({path:path.join(output,`${name}.png`),fullPage:true});console.log(`screenshot ${name}.png`);};
  const visit=async(route:string,selector:string)=>{await page.goto(`${origin}${route}`,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector(selector);};
  if (!process.env.WP6_E2E_DETAILS_ONLY) {
  await visit('/stern','[data-testid="stern-overview-memo"]');assert.equal(await page.$eval('[data-testid="stern-overview-stats"]',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),4);assert.equal(await page.$eval('[data-testid="stern-overview-followUpsOwed"]',e=>e.getAttribute('data-tone')),'neutral');assert.equal(await page.$eval('[data-testid="stern-overview-coffeeChatsOwed"]',e=>e.getAttribute('data-tone')),'warn');assert.ok(await page.$eval('.stern-need-row time',e=>e.textContent));await shot('01-overview-desktop');await page.click('[data-testid="stern-audit-undo-1"]');await page.waitForFunction(()=>document.body.textContent?.includes('1 skipped because later changes won'));assert.ok(posts.some(p=>p.action==='audit.undo'));fixture={...fixture,updatedAt:new Date().toISOString(),counts:{...fixture.counts,tasksDueToday:4}};wss.clients.forEach(ws=>ws.send(JSON.stringify({channel:'stern',payload:fixture,ts:Date.now()})));await page.waitForFunction(()=>document.querySelector('[data-testid="stern-overview-tasksDueToday"] strong')?.textContent==='4');fixture.counts.tasksDueToday=2;
  await page.type('[data-testid="stern-search"]','Example');await page.waitForSelector('[data-testid="stern-search-person-1"]');await shot('search');await page.keyboard.press('Escape');assert.ok(page.url().endsWith('/stern'));await page.$eval('[data-testid="stern-search"]',e=>(e as HTMLInputElement).blur());await page.focus('[data-testid="stern-search"]');await page.waitForSelector('[data-testid="stern-search-person-1"]');assert.equal(await page.$eval('[data-testid="stern-search-person-1"]',e=>e.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))),false);await page.click('[data-testid="stern-search-person-1"]');await page.waitForFunction(()=>location.search.includes('person=1'));
  await visit('/stern/automation','[data-testid="stern-connection-hermes"]');assert.equal(await page.$$eval('[data-component="ConnectionCard"]',e=>e.length),5);assert.equal(automationGets,1,'One initial Automation request');
  for(let tick=0;tick<3;tick++)wss.clients.forEach(ws=>ws.send(JSON.stringify({channel:'connections',payload:[{service:'stern-google-stern',surface:'dashboard',state:'on_healthy',detail:'Same state',lastChecked:new Date(Date.now()+tick*30000).toISOString()}],ts:Date.now()})));
  fixture={...fixture,updatedAt:new Date().toISOString(),automation:{...fixture.automation,connections:fixture.automation.connections.map(c=>c.id==='hermes'?{...c,state:'on_broken',detail:'Cached gateway unavailable'}:c)}};
  wss.clients.forEach(ws=>ws.send(JSON.stringify({channel:'stern',payload:fixture,ts:Date.now()})));
  await page.waitForFunction(()=>document.querySelector('[data-testid="stern-connection-hermes"]')?.textContent?.includes('Cached gateway unavailable'));
  assert.equal(automationGets,1,'Connection ticks and live cards must not refetch REST');
  assert.ok(await page.$eval('[data-testid="stern-suggestion-1"]',e=>e.textContent?.includes('Mark Example Person as Reply received')));
  await shot('10-automation');await page.$eval('.stern-main',e=>e.scrollTop=800);await shot('10-automation-reminders');await page.$eval('.stern-main',e=>e.scrollTop=0);
  await page.click('[data-testid="stern-settings-open"]');await page.waitForSelector('[role="dialog"]');await shot('settings');await page.keyboard.press('Escape');await page.waitForSelector('[role="dialog"]',{hidden:true});assert.ok(page.url().includes('/stern/automation'));await page.click('[data-testid="stern-settings-open"]');await page.$eval('[data-testid="stern-setting-threshold_suggest"]',e=>{const input=e as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'0.95');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('[data-testid="stern-settings-save"]');await page.waitForFunction(()=>document.querySelector('[role="dialog"]')?.textContent?.includes('Suggestion threshold must not exceed auto threshold'));await shot('settings-validation');
  await page.$eval('[data-testid="stern-setting-threshold_auto"]',e=>{const input=e as HTMLInputElement;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'0.96');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('[data-testid="stern-settings-save"]');await page.waitForSelector('[role="dialog"]',{hidden:true});assert.ok(posts.some(p=>p.action==='settings.update'&&(p.settings as any)['stern.threshold_auto']==='0.96'));
  await page.click('[data-testid="stern-audit-evidence-1"]');await page.waitForSelector('[role="dialog"]');await shot('evidence');await page.keyboard.press('Escape');
  undoConflict=true;await page.click('[data-testid="stern-audit-undo-1"]');await page.waitForFunction(()=>document.body.textContent?.includes('Undo would delete rows'));undoConflict=false;
  await page.click('[data-testid="stern-audit-undo-1"]');await page.waitForFunction(()=>document.body.textContent?.includes('1 skipped because later changes won'));
  await page.click('[data-testid="stern-scan-now"]');await page.click('[data-testid="stern-calendar-sync-now"]');
  await page.click('[data-testid="stern-reminder-test"]');await page.waitForFunction(()=>document.body.textContent?.includes('Nothing was delivered'));
  await page.click('[data-testid="stern-suggestion-accept-1"]');await page.click('[data-testid="stern-suggestion-dismiss-1"]');await page.click('[data-testid="stern-reminder-snooze-1"]');
  assert.ok(posts.some(p=>p.action==='suggestion.accept'));assert.ok(posts.some(p=>p.action==='suggestion.dismiss'));assert.ok(posts.some(p=>p.action==='reminder.snooze'));
  assert.ok(posts.some(p=>p.action==='scan.now'));assert.ok(posts.some(p=>p.action==='calendar.sync_now'));
  await page.setViewport({width:390,height:844});await visit('/stern','[data-testid="stern-overview-needs"]');
  const positions=await page.evaluate(()=>['stern-overview-stats','stern-overview-needs','stern-overview-schedule'].map(id=>document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect().top));assert.ok(positions[0]<positions[1]&&positions[1]<positions[2]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.$eval('[data-testid="stern-overview-stats"]',e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);await shot('12-overview-phone');
  await page.click('[data-testid="stern-quick-add-button"]');await page.waitForSelector('[role="dialog"]');await shot('11-phone-quick-add');await page.keyboard.press('Escape');
  await page.setViewport({width:1440,height:1000});await visit('/stern/automation?components=1','[data-testid="stern-component-sheet"]');await shot('13-component-sheet');await page.$eval('.stern-main',e=>e.scrollTop=700);await shot('13-component-sheet-statuses');assert.ok(await page.$eval('[data-testid="stern-component-statuses"]',e=>['Academic','Professional','Campus'].every(label=>e.textContent?.includes(label))));assert.equal(await page.$$eval('[data-component="AssignmentRow"]',e=>e.length),4);assert.equal(await page.$$eval('[data-component="PersonRow"]',e=>e.length),3);await page.$eval('.stern-main',e=>e.scrollTop=1400);await shot('13-component-sheet-rows');
  for(const [route,id,name] of [['/stern/recruiting','stern-recruiting-board','02-recruiting'],['/stern/network','stern-network','04-network'],['/stern/tasks','stern-tasks-view','06-tasks'],['/stern/classes','stern-classes','07-classes']] ) {await page.goto(`${origin}${route}`,{waitUntil:'networkidle0',timeout:120000});await page.waitForSelector('[data-testid="stern-shell"]');await shot(name);}
  await visit('/stern/recruiting/1','[data-testid="stern-club-detail-tabs"]');await shot('03-club-detail');
  await visit('/stern/recruiting/1#prep','[data-testid="stern-club-tab-prep"]');assert.equal(await page.$eval('[data-testid="stern-club-tab-prep"]',e=>e.getAttribute('data-state')),'active');
  await visit('/stern/network?person=1','[data-testid="stern-person-contacts"]');await shot('05-person-drawer');await page.keyboard.press('Escape');
  await visit('/stern/classes/1','[data-testid="stern-course-detail"]');await shot('08-course-detail');
  }
  await page.setViewport({width:1440,height:1000});
  await visit('/stern/career','[data-testid="career-table"]');await shot('09-career');await page.click('[data-testid="career-row"] td:nth-child(4)');await page.waitForSelector('[role="dialog"]');
  assert.equal(await page.$eval('[role="dialog"]',e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');await shot('09-career-drawer');await page.keyboard.press('Escape');assert.ok(page.url().includes('/stern/career'));
  if(!process.env.WP6_E2E_DETAILS_ONLY) {
    mode='empty';await visit('/stern','[data-testid="stern-overview-memo"]');await page.waitForFunction(()=>document.body.textContent?.includes('Nothing waiting on you'));await shot('overview-empty');
    mode='error';await visit('/stern','[data-testid="stern-overview-retry"]');await shot('overview-error');
    mode='loading';await page.goto(`${origin}/stern`,{waitUntil:'domcontentloaded'});await page.waitForSelector('[data-testid="stern-skeleton"]');await shot('overview-loading');await page.waitForSelector('[data-testid="stern-overview-memo"]');
  }
  console.log(process.env.WP6_E2E_DETAILS_ONLY?'PASS: Career drawer light theme, Escape, and real auth; external requests blocked':'PASS: all 13 screens, real auth, live update, five cards, search, suggestion/settings/snooze actions, undo errors/skips, dialog Escape, dry-run notice, 4-column desktop / 2-column phone, empty/error/loading states; external requests blocked');
 } finally {await browser?.close();wss.clients.forEach(ws=>ws.terminate());wss.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await app.close();getDb().close();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
