import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
import fixtures from './fixtures/stern/emails.json';
import trustFixture from './fixtures/stern/trust.json';
import type { EmailClassification, SternEmailMessage, VerificationResult } from '@/lib/stern-types';
const tmp=fs.mkdtempSync(path.join(process.cwd(),'.stern-trust-test-'));
process.env.RATHWORKSPACE_DB=path.join(tmp,'test.db');
process.env.STERN_VAULT_WRITE='0';process.env.STERN_LLM_MODE='fixture';process.env.STERN_VERIFIER_MODE='fixture';
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Network forbidden');};
let db:ReturnType<typeof import('@/db')['getDb']>;
let people:typeof import('@/lib/stern/people'),audit:typeof import('@/lib/stern/audit'),scan:typeof import('@/lib/stern/gmail-scan'),sourceMod:typeof import('@/lib/stern/automation-source'),policy:typeof import('@/lib/stern/apply'),verify:typeof import('@/lib/stern/verify');
const q=(sql:string,...args:unknown[])=>db.prepare(sql).get(...args) as any;
const all=(sql:string,...args:unknown[])=>db.prepare(sql).all(...args) as any[];
function load<T>(file:string,stubs:Record<string,unknown>):T {
 const filename=path.resolve(file),require=createRequire(filename),mod={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports','__filename','__dirname',code)((id:string)=>id in stubs?stubs[id]:require(id),mod,mod.exports,filename,path.dirname(filename));return mod.exports as T;
}
test.before(async()=>{
 db=(await import('@/db')).getDb(); people=await import('@/lib/stern/people');audit=await import('@/lib/stern/audit');scan=await import('@/lib/stern/gmail-scan');sourceMod=await import('@/lib/stern/automation-source');policy=await import('@/lib/stern/apply');verify=await import('@/lib/stern/verify');
});
test.beforeEach(()=>{
 db.transaction(()=>{
 for(const table of ['stern_verifications','stern_audit_log','stern_suggestions','stern_reminders','stern_drafts','stern_calendar_events','stern_email_messages','stern_scan_state','stern_tasks','coffee_chats','people','stern_processes','google_accounts','kv','connections']) db.prepare(`DELETE FROM ${table}`).run();
 db.prepare("INSERT INTO stern_processes(id,slug,name) VALUES (1,'fixture','Fixture')").run();
 for(const [id,name,short] of [[1,fixtures[0].expected.club,'EEG'],[2,'Finance Society','FS']]) db.prepare('INSERT INTO stern_clubs(id,process_id,name,short_name,slug) VALUES (?,1,?,?,?)').run(id,name,short,short);
 for(const email of ['netid@stern.nyu.edu','netid@nyu.edu']) db.prepare("INSERT INTO google_accounts(email,enabled,added_at) VALUES (?,1,'2026-09-01T16:00:00Z')").run(email);
 for(const service of ['stern-google-stern','stern-google-nyu']) db.prepare("INSERT INTO connections(service,surface,enabled) VALUES (?,'dashboard',1)").run(service);
 }).immediate();
});
test.after(()=>{db.close();globalThis.fetch=originalFetch;fs.rmSync(tmp,{recursive:true,force:true});});

test('New York time parser: offsets, naive ISO, numeric and natural dates, DST and invalid input',async()=>{
 const {parseEventTime}=await import('@/lib/stern/time');const ref=trustFixture.reference;
 for(const value of ['2026-09-09T11:00:00','2026-09-09 11:00','tomorrow at 11am','September 9 at 11 AM']) assert.equal(Date.parse(parseEventTime(value,ref)!.iso),Date.parse('2026-09-09T15:00:00Z'),value);
 assert.equal(parseEventTime('Wed 9/9 3pm',ref)?.iso,'2026-09-09T19:00:00.000Z');
 assert.equal(parseEventTime('2026-09-09T11:00:00-04:00',ref)?.confidence,1);
 assert.equal(parseEventTime('2026-12-09 11:00',ref)?.iso,'2026-12-09T16:00:00.000Z');
 for(const value of ['whenever works','2026-02-30 11:00','2026-03-08 02:30','Wed 9/9 25pm']) assert.equal(parseEventTime(value,ref),null,value);
});
test('Roster plus email capture resolves by normalized name despite different organization text and promotes',()=>{
 const first=people.createPerson({display_name:'Casey Example',org:'EEG',roster:1,source:'import'}).person;
 const result=people.createPerson({display_name:'CASEY  Example.',org:'Entrepreneurship club recruiting',email:'casey@example.com',source:'auto_email'});
 assert.equal(result.created,false);assert.equal(result.person.id,first.id);assert.equal(result.person.roster,0);assert.equal(q('SELECT COUNT(*) n FROM people WHERE archived=0').n,1);
});
test('Ambiguous legacy roster rows choose affiliation club and create audited review; different emails stay separate',()=>{
 const first=people.createPerson({name:'Jamie Example',org:'EEG',source:'import',roster:1}).person;
 // Legacy duplicate: createPerson now prevents a second name-only row on all capture paths.
 const second=Number(db.prepare("INSERT INTO people(display_name,email,dedupe_key,roster,org) VALUES ('Jamie Example','','name:legacy:finance',1,'Finance')").run().lastInsertRowid);
 people.addAffiliation(first.id,{club_id:1});people.addAffiliation(second,{club_id:2});
 const result=people.createPerson({name:'Jamie Example',email:'jamie@example.com',club_or_org:'FS',source:'auto_email'});
 assert.equal(result.person.id,second);const suggestion=q("SELECT * FROM stern_suggestions WHERE suggestion_type='person_merge_review'");
 assert.deepEqual(JSON.parse(suggestion.proposed_data).candidates,[first.id,second]);assert.ok(q("SELECT id FROM stern_audit_log WHERE entity_type='suggestion' AND entity_id=?",suggestion.id));
 const distinct=people.createPerson({name:'Jamie Example',email:'another@example.com'}).person;
 // Remaining name-only row resolves first; once both carry emails, sweep cannot merge them.
 assert.equal(distinct.id,first.id);assert.equal(people.sweepDuplicates().merged,0);
 assert.equal(people.createPerson({name:'Jamie Example',email:'third@example.com'}).created,true);
});
test('Duplicate sweep preserves email survivor, affiliations, audit and undo',()=>{
 const keep=people.createPerson({name:'Taylor Example',email:'taylor@example.com'}).person;
 const drop=Number(db.prepare("INSERT INTO people(display_name,dedupe_key) VALUES ('Taylor Example','name:legacy:taylor')").run().lastInsertRowid);
 people.addAffiliation(drop,{club_id:1});const result=people.sweepDuplicates();assert.equal(result.merged,1);assert.equal(q('SELECT archived FROM people WHERE id=?',drop).archived,1);
 assert.equal(q('SELECT person_id FROM people_affiliations').person_id,keep.id);audit.undoBatch(result.batchId);assert.equal(q('SELECT archived FROM people WHERE id=?',drop).archived,0);assert.equal(q('SELECT person_id FROM people_affiliations').person_id,drop);
});
async function feed(ids:string[]) {
 const base=sourceMod.automationSource();return scan.runSternEmailScan({dryRun:true,source:{...base,list:async(account)=>fixtures.filter(f=>f.account===account&&ids.includes(f.id)).map(f=>f.id)}});
}
test('Every automatically applied fixture message is verified exactly once; repeat scan does not reverify',async()=>{
 await feed(['fx-001','fx-003']);
 assert.equal(q('SELECT COUNT(*) n FROM stern_verifications').n,2);assert.equal(q("SELECT COUNT(*) n FROM stern_email_messages WHERE verified='agree'").n,2);
 const dossier=verify.verificationDossier(q('SELECT batch_id FROM stern_verifications ORDER BY id LIMIT 1').batch_id);
 assert.ok(dossier.effects.length);assert.ok(dossier.messages.length);assert.ok(dossier.people.length);assert.ok(dossier.chats.length);
 await feed(['fx-001','fx-003']);assert.equal(q('SELECT COUNT(*) n FROM stern_verifications').n,2);
});
test('Scheduling without a parseable time remains visible; hot scans scope account/thread, confirm and clear phase',async()=>{
 await feed(['fx-001']);
 const message=q("SELECT * FROM stern_email_messages WHERE gmail_message_id='fx-001'") as SternEmailMessage;
 const cls={...fixtures[0].expected,category:'scheduling_confirmed',confirmed_time:'when you are free',confidence:.99} as EmailClassification;
 await policy.applyClassification(message,cls,{dryRun:true});
 let chat=q('SELECT * FROM coffee_chats');assert.ok(chat.scheduling_since);assert.ok(chat.hot_until);assert.equal(chat.state,'requested');
 assert.equal((await import('@/lib/stern-types')).coffeeChatPhase(chat),'scheduling');
 assert.match((await import('@/lib/stern/overview')).needsYou()[0].title,/Scheduling in progress/);
 assert.ok(q("SELECT * FROM stern_suggestions WHERE suggestion_type='time_parse_review'"));
 const base=sourceMod.automationSource(),calls:unknown[]=[];const now=new Date();
 db.prepare("UPDATE coffee_chats SET last_thread_check_at=''").run();
 await scan.runSternHotThreads({now,dryRun:true,source:{...base,list:async(account,_since,options)=>{calls.push([account,options?.threadId]);return ['fx-003'];}}});
 assert.deepEqual(calls,[[message.gmail_account,message.gmail_thread_id]]);
 chat=q('SELECT * FROM coffee_chats');assert.equal(chat.state,'scheduled');assert.equal(chat.scheduling_since,'');assert.equal(chat.hot_until,'');assert.equal(chat.last_thread_check_at,now.toISOString());
});
test('Hot scans do not wait for full scans and respect the five minute check window',async()=>{
 await feed(['fx-001']);const now=new Date();db.prepare("UPDATE coffee_chats SET scheduling_since=?,hot_until=?,last_thread_check_at=?").run(now.toISOString(),new Date(+now+30*60000).toISOString(),now.toISOString());
 let release!:()=>void,announce!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>announce=r);const base=sourceMod.automationSource();
 const full=scan.runSternEmailScan({source:{...base,list:async()=>{announce();await held;return [];}}});await started;
 try {
 assert.equal((await scan.runSternHotThreads({source:base,now,dryRun:true})).checked,0);
 db.prepare("UPDATE coffee_chats SET last_thread_check_at=''").run();
 const hot=await scan.runSternHotThreads({source:{...base,list:async()=>[]},now,dryRun:true});assert.equal(hot.checked,1);
 } finally {release();await full;}
});
test('person.merge API completes while a fixture full scan is blocked',async()=>{
 const keep=people.createPerson({name:'Merge One'}).person,drop=people.createPerson({name:'Merge Two'}).person;
 let release!:()=>void,announce!:()=>void;const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>announce=r);const base=sourceMod.automationSource();
 const full=scan.runSternEmailScan({source:{...base,list:async()=>{announce();await held;return [];}}});await started;
 try {
 const route=load<{POST:(r:Request)=>Promise<Response>}>('app/api/stern/network/route.ts',{'@/lib/guard':{requireUser:async()=>({email:'owner@example.com'})},'@/lib/stern/snapshot':{broadcastStern:()=>({})}});
 const response=await Promise.race([route.POST(new Request('http://localhost:3190/api/stern/network',{method:'POST',body:JSON.stringify({action:'person.merge',keepId:keep.id,dropId:drop.id})})),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Mutation waited for scanner')),1000))]);
 assert.equal(response.status,200);assert.equal(q('SELECT archived FROM people WHERE id=?',drop.id).archived,1);
 } finally {release();await full;}
});
for(const [verdict,confidence,issues,rolledBack,flagged] of [
 ['agree',.95,[],false,false],['agree',.9,[{field:'confirmed_time',problem:'Ambiguous',suggested_value:'"tomorrow at 11am"'}],false,true],
 ['unsure',.6,[],false,true],['disagree',.79,[],false,true],['disagree',.9,[{field:'confirmed_time',problem:'Wrong time',suggested_value:'"tomorrow at 11am"'}],true,true],
] as const) test(`Verifier policy ${verdict}/${confidence}/${issues.length}`,async()=>{
 const batchId=audit.newBatchId('policy');const person=people.createPerson({name:'Policy Example'},{batchId,source:'auto_email',gmailAccount:'netid@stern.nyu.edu',gmailMessageId:'policy'}).person;
 db.prepare("INSERT INTO stern_email_messages(gmail_account,gmail_message_id,classification,applied) VALUES ('netid@stern.nyu.edu','policy',?,'auto_applied')").run(JSON.stringify(fixtures[0].expected));
 const result=await verify.verifyBatch(batchId,{fixtureResult:{verdict,confidence,issues:[...issues]} as VerificationResult});
 assert.equal(result.rollback,rolledBack);assert.equal(!!q('SELECT id FROM people WHERE id=?',person.id),!rolledBack);assert.equal(q('SELECT verified FROM stern_email_messages').verified,flagged?'flagged':'agree');
 if(flagged) assert.ok(q('SELECT proposed_data FROM stern_suggestions'));await verify.verifyBatch(batchId);assert.equal(q('SELECT COUNT(*) n FROM stern_verifications').n,1);
});
test('Reauth reminders: day six 09:00 NY, both channels, once/day/account, and reconnect supersedes reminder',async()=>{
 const mod=await import('@/lib/stern/google-reauth');
 assert.equal(mod.queueGoogleReauth('netid@nyu.edu',new Date('2026-09-07T12:59Z')),false);
 assert.equal(mod.queueGoogleReauth('netid@nyu.edu',new Date('2026-09-07T13:00Z')),true);
 assert.equal(mod.queueGoogleReauth('netid@nyu.edu',new Date('2026-09-07T14:00Z'),true),false);
 assert.equal(mod.queueGoogleReauth('netid@stern.nyu.edu',new Date('2026-09-07T14:00Z'),true),true);
 assert.equal(q('SELECT channel FROM stern_reminders').channel,'both');assert.match(q('SELECT message FROM stern_reminders').message,/set=stern&login_hint=netid%40nyu.edu/);
 assert.equal(mod.googleExpiryDays('netid@nyu.edu',new Date('2026-09-07T16:00Z')),1);
 mod.recordGoogleConsent('netid@nyu.edu',new Date('2026-09-07T16:00Z'));assert.equal(mod.googleExpiryDays('netid@nyu.edu',new Date('2026-09-07T16:00Z')),7);
});

test('Verifier disagreement offers original and corrected one-tap replay without reverifying manual acceptance',async()=>{
 await feed(['fx-001','fx-003']);
 const latest=q("SELECT * FROM stern_verifications WHERE gmail_message_id='fx-003'");
 // Replace the fixture verdict to exercise the actual policy against the existing applied batch.
 db.prepare('DELETE FROM stern_verifications WHERE id=?').run(latest.id);
 const rejection=await verify.verifyBatch(latest.batch_id,{fixtureResult:trustFixture.disagreement as VerificationResult});
 assert.equal(rejection.rollback,true);
 const suggestion=q("SELECT * FROM stern_suggestions WHERE suggestion_type='verification_correction'");
 const payload=JSON.parse(suggestion.proposed_data);assert.ok(payload.auditEffects.length);assert.ok(payload.classification);assert.ok(payload.issues.length);
 const before=q('SELECT COUNT(*) n FROM stern_verifications').n;
 await policy.acceptSuggestion(suggestion.id,{dryRun:true,correction:true});
 assert.equal(Date.parse(q('SELECT scheduled_at FROM coffee_chats').scheduled_at),Date.parse('2026-09-09T11:00:00-04:00'));
 assert.equal(q('SELECT COUNT(*) n FROM stern_verifications').n,before);
});
test('Verifier cannot delete a newly created person after a concurrent manual edit',async()=>{
 const batchId=audit.newBatchId();const p=people.createPerson({name:'Concurrent Example'},{source:'auto_email',batchId}).person;
 people.updatePerson(p.id,{notes:'Keep my manual edit'});
 const result=await verify.verifyBatch(batchId,{fixtureResult:trustFixture.disagreement as VerificationResult});
 assert.equal(result.rollback,false);assert.equal(people.getPerson(p.id).notes,'Keep my manual edit');assert.match(result.verification.issues,/conflicts/);
});
test('Manual scheduling and interviews parse naive and natural times; invalid raw values become audited suggestions',async()=>{
 const coffee=await import('@/lib/stern/coffee'),recruiting=await import('@/lib/stern/recruiting');
 const p=people.createPerson({name:'Schedule Example'}).person,chat=coffee.createCoffeeChat(p.id,1);
 coffee.transition(chat,'requested');coffee.transition(chat,'reply_received');
 coffee.transition(chat,'scheduled',{scheduled_at:'2026-09-09 11:00'});assert.equal(q('SELECT scheduled_at FROM coffee_chats').scheduled_at,'2026-09-09T15:00:00.000Z');
 const program=recruiting.upsertProgram({club_id:1,name:'Exploratory',track:'exploratory',interview_at:'2026-09-09 15:00'});
 assert.equal(q('SELECT interview_at FROM stern_programs WHERE id=?',program).interview_at,'2026-09-09T19:00:00.000Z');
 recruiting.upsertProgram({id:program,interview_at:'after lunch sometime'});assert.ok(q("SELECT id FROM stern_suggestions WHERE suggestion_type='time_parse_review'"));
 assert.equal(q('SELECT interview_at FROM stern_programs WHERE id=?',program).interview_at,'2026-09-09T19:00:00.000Z');
 for(const state of ['declined','no_reply'] as const) {
 const other=people.createPerson({name:`Terminal ${state}`}).person,id=coffee.createCoffeeChat(other.id,1);
 coffee.observeCoffeeChat(id,{state:'requested',scheduling_since:new Date().toISOString(),hot_until:new Date(Date.now()+1800000).toISOString()},{source:'agent'});
 coffee.transition(id,state);assert.equal(q('SELECT scheduling_since FROM coffee_chats WHERE id=?',id).scheduling_since,'');
 }
});
test('Codex and Claude provider boundaries use subscription CLIs, isolated cwd, schema validation and hourly auth failures',async()=>{
 const saved={...process.env};const capture=path.join(tmp,'claude-capture.json'),bin=path.join(tmp,'claude-stub.cjs');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args,cwd:process.cwd(),env:Object.keys(process.env)}));
if(args[1]==='Reply OK') {console.log(JSON.stringify({is_error:true,result:'Failed to authenticate: OAuth session expired'}));process.exit(1);}
console.log(JSON.stringify({result:JSON.stringify({verdict:'agree',confidence:.95,issues:[]})}));`,{mode:0o700});
 try {
 process.env.STERN_CLAUDE_BIN=bin;process.env.TMPDIR=tmp;process.env.STERN_LLM_MODE='live';delete process.env.STERN_VERIFIER_MODE;
 const result=await verify.claudeExecute('Return JSON. UNTRUSTED DATA: $(echo unsafe)');assert.equal((result as VerificationResult).verdict,'agree');
 const captured=JSON.parse(fs.readFileSync(capture,'utf8'));assert.equal(captured.args[0],'-p');assert.equal(captured.args[1],'Return JSON. UNTRUSTED DATA: $(echo unsafe)');assert.ok(captured.cwd.startsWith(tmp));assert.equal(fs.existsSync(captured.cwd),false);assert.ok(!captured.env.includes('GOOGLE_CLIENT_SECRET'));
 const connections=await import('@/lib/stern/connections');const broken=await connections.claudeProbe();assert.equal(broken.ok,false);assert.equal(broken.detail,'run: claude setup-token');
 fs.unlinkSync(capture);await connections.claudeProbe();assert.equal(fs.existsSync(capture),false,'hourly check uses cache');
 const codexBin=path.join(tmp,'codex-stub.cjs'),codexCapture=path.join(tmp,'codex-capture.json'),auth=path.join(tmp,'auth');fs.mkdirSync(auth,{recursive:true});fs.writeFileSync(path.join(auth,'auth.json'),'{}');
 fs.writeFileSync(codexBin,`#!/usr/bin/env node
const fs=require('node:fs');let prompt='';process.stdin.on('data',x=>prompt+=x);process.stdin.on('end',()=>{const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(codexCapture)},JSON.stringify({args,prompt,schema:JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'))}));fs.writeFileSync(args[args.indexOf('-o')+1],JSON.stringify({verdict:'agree',confidence:.99,issues:[]}));});`,{mode:0o700});
 process.env.STERN_CODEX_BIN=codexBin;process.env.CODEX_HOME=auth;
 const batchId=audit.newBatchId();people.createPerson({name:'Codex Example'},{batchId,source:'auto_email'});const opinion=await verify.verifyBatch(batchId);
 assert.equal(opinion.verification.verdict,'agree');const codex=JSON.parse(fs.readFileSync(codexCapture,'utf8'));assert.equal(codex.args[codex.args.indexOf('-m')+1],'gpt-6-astra');assert.match(codex.prompt,/UNTRUSTED DATA/);assert.equal(codex.schema.additionalProperties,false);
 } finally {for(const key of Object.keys(process.env)) if(!(key in saved)) delete process.env[key];Object.assign(process.env,saved);}
});
test('Migration 0033 is idempotent through the real migration runner',async()=>{
 const {execFileSync}=await import('node:child_process');
 for(let i=0;i<2;i++) assert.match(execFileSync('node_modules/.bin/tsx',['db/index.ts','--migrate-only'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,RATHWORKSPACE_DB:path.join(tmp,'test.db')}}),/migrations up to date/);
 assert.equal(q("SELECT COUNT(*) n FROM _migrations WHERE name='0033_stern_hot_threads.sql'").n,1);
 for(const column of ['scheduling_since','hot_until','last_thread_check_at','gmail_account']) {const info=all('PRAGMA table_info(coffee_chats)').find(c=>c.name===column);assert.equal(info.notnull,1);assert.equal(info.dflt_value,"''");}
});
