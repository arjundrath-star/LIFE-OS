import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"rath-hevy-test-"));
process.env.RATHWORKSPACE_DB=path.join(tmp,"hevy.db");
process.env.RATHWORKSPACE_SECRETS_PATH=path.join(tmp,"secrets.env");
process.env.HEVY_API_KEY="fixture-key-a";
let loaded:Promise<any>|null=null;
function setup(){if(!loaded)loaded=Promise.all([import("@/lib/sources/hevy"),import("@/lib/health/source-state"),import("@/lib/health"),import("@/db")]).then(([hevy,state,health,db])=>({hevy,state,health,db}));return loaded}
test.after(async()=>{const {db}=await setup();try{db.getDb().close()}catch{}fs.rmSync(tmp,{recursive:true,force:true});delete process.env.HEVY_API_KEY;delete process.env.RATHWORKSPACE_SECRETS_PATH});

function json(data:any,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}})}
function user(id="account-a"){return {data:{id,name:`Fixture ${id}`,url:`https://hevy.example/${id}`}}}
function page(key:string,items:any[],pageNumber=1,pageCount=1){return {page:pageNumber,page_count:pageCount,[key]:items}}
function workout(id:string,title:string,weight:number,start="2026-08-10T14:00:00Z",end="2026-08-10T15:00:00Z"){return {id,title,start_time:start,end_time:end,updated_at:end,exercises:[{index:0,exercise_template_id:"bench",title:"Bench Press",notes:"",sets:[{index:0,type:"warmup",weight_kg:40,reps:10},{index:1,type:"normal",weight_kg:weight,reps:8,rpe:8}]}]}}
function enable(db:any,enabled=true){db.getDb().prepare(`INSERT INTO connections(service,surface,enabled,health,state,detail) VALUES ('hevy','dashboard',?,'unknown',?,'fixture') ON CONFLICT(service,surface) DO UPDATE SET enabled=excluded.enabled`).run(enabled?1:0,enabled?"on_broken":"off")}
function reset(db:any){const d=db.getDb();d.exec("DELETE FROM health_workouts; DELETE FROM health_body_measurements; DELETE FROM health_sync_state WHERE source='hevy'; DELETE FROM connections WHERE service='hevy'");process.env.HEVY_API_KEY="fixture-key-a";enable(db,true)}

test("live Swagger shapes are unwrapped and all documented pages use pageSize<=10 and date identities",async()=>{
  const {hevy,db}=await setup();reset(db);const urls:string[]=[];
  const request=async(url:string)=>{urls.push(url);const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts")){const p=Number(u.searchParams.get("page"));return json(page("workouts",[workout(`w${p}`,p===1?"Push":"Pull",80-p)],p,2))}if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[{date:"2026-08-10",weight_kg:88.2,fat_percent:18.5,waist:82}]));return json({},404)};
  const result=await hevy.syncHevy({request,forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-10T12:00:00Z"});
  assert.equal(result.status,"healthy");assert.equal(result.seen,3);assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_workouts WHERE source='hevy' AND deleted_at IS NULL").get() as any).n,2);
  assert.deepEqual(db.getDb().prepare("SELECT source_external_id external_id,measured_at,body_fat_pct,waist_cm FROM health_body_measurements WHERE source='hevy'").get(),{external_id:"2026-08-10",measured_at:"2026-08-10T00:00:00.000Z",body_fat_pct:18.5,waist_cm:82});
  assert.ok(urls.every(url=>!new URL(url).searchParams.has("pageSize")||Number(new URL(url).searchParams.get("pageSize"))<=10));assert.ok(urls.some(url=>new URL(url).pathname.endsWith("/body_measurements")));
  const state=db.getDb().prepare("SELECT account_identity FROM health_sync_state WHERE source='hevy'").get() as any;assert.ok(state.account_identity);assert.notEqual(state.account_identity,"account-a");
});

test("paginated newest-to-oldest workout events apply chronologically so newest nested update wins",async()=>{
  const {hevy,db}=await setup();let eventPages=0;const request=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts/events")){eventPages++;const p=Number(u.searchParams.get("page"));return p===1?json(page("events",[{type:"updated",updated_at:"2026-08-11T12:00:00Z",workout:workout("w1","Newest update",90)}],1,2)):json(page("events",[{type:"deleted",id:"w1",deleted_at:"2026-08-11T11:00:00Z"}],2,2))}if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[{date:"2026-08-10",weight_kg:88}]));return json({},404)};
  const result=await hevy.syncHevy({request,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-11T12:10:00Z"});assert.equal(result.status,"healthy");assert.equal(eventPages,2);
  assert.deepEqual(db.getDb().prepare("SELECT title,deleted_at FROM health_workouts WHERE source='hevy' AND source_external_id='w1'").get(),{title:"Newest update",deleted_at:null});
});

test("malformed user/page/event HTTP 200 payloads cannot write or destructively reconcile",async()=>{
  const {hevy,db}=await setup();const before=db.getDb().prepare("SELECT title,deleted_at FROM health_workouts WHERE source_external_id='w1'").get();
  const malformedPage=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts"))return json({page:1,page_count:1,data:[]});if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  let result=await hevy.syncHevy({request:malformedPage,forceFull:true,baseUrl:"https://fixture.test/v1"});assert.equal(result.status,"broken");assert.equal(result.errorCode,"HEVY_SCHEMA_ERROR");assert.equal(result.detail,"Hevy returned data in an unsupported format");assert.deepEqual(db.getDb().prepare("SELECT title,deleted_at FROM health_workouts WHERE source_external_id='w1'").get(),before);
  result=await hevy.syncHevy({request:async(url:string)=>new URL(url).pathname.endsWith("/user/info")?json({id:"wrong-shape"}):json({},404),forceFull:true,baseUrl:"https://fixture.test/v1"});assert.equal(result.status,"broken");assert.equal(result.errorCode,"HEVY_SCHEMA_ERROR");
  const badEvent=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts/events"))return json(page("events",[{type:"updated",workout:{id:"w1",start_time:"2026-08-10T14:00:00Z"}}]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  result=await hevy.syncHevy({request:badEvent,baseUrl:"https://fixture.test/v1"});assert.equal(result.status,"broken");assert.equal(result.errorCode,"HEVY_SCHEMA_ERROR");
});

test("provider-controlled Hevy markers are absent from errors, DB diagnostics, snapshots, and caller-facing checks",async()=>{
  const {hevy,health,db}=await setup();reset(db);const marker="UPSTREAM-WORKOUT-ID-DO-NOT-LEAK-9f7a";
  const request=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts"))return json(page("workouts",[{id:marker,start_time:"malformed",exercises:[]}]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  const result=await hevy.syncHevy({request,forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-15T01:00:00.000Z"});
  assert.equal(result.status,"broken");assert.equal(result.errorCode,"HEVY_SCHEMA_ERROR");assert.doesNotMatch(JSON.stringify(result),new RegExp(marker));
  assert.deepEqual(db.getDb().prepare("SELECT last_error FROM health_sync_state WHERE source='hevy'").get(),{last_error:"HEVY_SCHEMA_ERROR"});
  for(const snapshot of [health.healthSnapshot("2026-08-15T01:01:00.000Z"),health.privateHealthSnapshot("2026-08-15T01:01:00.000Z")]){const serialized=JSON.stringify(snapshot);assert.doesNotMatch(serialized,new RegExp(marker));assert.equal(snapshot.connections.hevy.lastError,"HEVY_SCHEMA_ERROR");assert.equal(snapshot.connections.hevy.detail,"Hevy returned data in an unsupported format")}
  assert.throws(()=>hevy.normalizeWorkout({id:marker,start_time:"malformed",exercises:[]}),(error:any)=>{assert.equal(error.message,"HEVY_SCHEMA_ERROR");assert.doesNotMatch(error.message,new RegExp(marker));return true});
  const check=await hevy.healthCheck({request:async()=>{throw new Error(marker)},baseUrl:"https://fixture.test/v1",timeoutMs:100});assert.equal(check.ok,false);assert.equal(check.errorCode,"HEVY_HTTP_ERROR");assert.doesNotMatch(JSON.stringify(check),new RegExp(marker));
});

test("request timeout and whole-sync deadline are bounded and leave staged rows uncommitted",async()=>{
  const {hevy,db}=await setup();reset(db);const hanging=async(_url:string,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener("abort",()=>reject(Object.assign(new Error("aborted"),{name:"AbortError"}))));
  let result=await hevy.syncHevy({request:hanging,forceFull:true,baseUrl:"https://fixture.test/v1",timeoutMs:10});assert.equal(result.status,"broken");assert.match(result.detail,/timed out/i);
  const delayed=async(url:string)=>{await new Promise(resolve=>setTimeout(resolve,4));const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout("late","Late",80)]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  result=await hevy.syncHevy({request:delayed,forceFull:true,baseUrl:"https://fixture.test/v1",timeoutMs:100,syncDeadlineMs:7});assert.equal(result.status,"broken");assert.match(result.detail,/deadline|timed out/i);assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_workouts WHERE source='hevy' AND deleted_at IS NULL").get() as any).n,0);
});

test("same-account Hevy lease skips concurrent network work and an expired lease recovers without stale overwrite",async()=>{
  const {hevy,db}=await setup();reset(db);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reached!:()=>void;const atGate=new Promise<void>(resolve=>reached=resolve);
  const oldRequest=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts")){reached();await gate;return json(page("workouts",[workout("race","Older delayed title",70,"2026-08-15T10:00:00Z","2026-08-15T11:00:00Z")]))}if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  const oldRun=hevy.syncHevy({request:oldRequest,forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-15T12:00:00.000Z"});await atGate;
  let blockedCalls=0;const blocked=await hevy.syncHevy({request:async()=>{blockedCalls++;return json({})},forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-15T12:00:01.000Z"});assert.equal(blocked.status,"degraded");assert.equal(blocked.detail,"Hevy sync already in progress");assert.equal(blockedCalls,0);
  db.getDb().prepare("UPDATE health_sync_state SET lease_expires_at=? WHERE source='hevy'").run("2026-08-15T12:30:00.000Z");
  const newer=await hevy.syncHevy({forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>"2026-08-15T13:00:00.000Z",request:async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout("race","Newer committed title",95,"2026-08-15T12:00:00Z","2026-08-15T13:00:00Z")]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)}});assert.equal(newer.status,"healthy");
  release();const older=await oldRun;assert.equal(older.status,"broken");assert.equal(older.errorCode,"HEVY_SESSION_CHANGED");
  assert.deepEqual(db.getDb().prepare("SELECT title,source_updated_at FROM health_workouts WHERE source='hevy' AND source_external_id='race'").get(),{title:"Newer committed title",source_updated_at:"2026-08-15T13:00:00.000Z"});
  assert.deepEqual(db.getDb().prepare("SELECT cursor,last_success_at,lease_token,lease_expires_at FROM health_sync_state WHERE source='hevy'").get(),{cursor:"2026-08-15T13:00:00.000Z",last_success_at:"2026-08-15T13:00:00.000Z",lease_token:null,lease_expires_at:null});
});

test("later Hevy run cannot apply older provider updates or regress cursor and success time",async()=>{
  const {hevy,db}=await setup();reset(db);const sync=(now:string,title:string,updatedAt:string)=>hevy.syncHevy({forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>now,request:async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout("monotonic",title,90,"2026-08-15T10:00:00Z",updatedAt)]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)}});
  assert.equal((await sync("2026-08-15T15:00:00.000Z","Newest provider title","2026-08-15T14:00:00Z")).status,"healthy");
  assert.equal((await sync("2026-08-15T13:00:00.000Z","Stale provider title","2026-08-15T12:00:00Z")).status,"healthy");
  assert.deepEqual(db.getDb().prepare("SELECT title,source_updated_at FROM health_workouts WHERE source_external_id='monotonic'").get(),{title:"Newest provider title",source_updated_at:"2026-08-15T14:00:00.000Z"});
  assert.deepEqual(db.getDb().prepare("SELECT cursor,last_success_at FROM health_sync_state WHERE source='hevy'").get(),{cursor:"2026-08-15T15:00:00.000Z",last_success_at:"2026-08-15T15:00:00.000Z"});
});

test("account replacement quarantines prior Hevy rows and resets the cursor without blending",async()=>{
  const {hevy,db}=await setup();reset(db);
  const sync=(account:string,id:string)=>hevy.syncHevy({forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>account==="account-a"?"2026-08-10T12:00:00Z":"2026-08-11T12:00:00Z",request:async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user(account));if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout(id,id,80)]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)}});
  assert.equal((await sync("account-a","old-account-workout")).status,"healthy");process.env.HEVY_API_KEY="fixture-key-b";assert.equal((await sync("account-b","new-account-workout")).status,"healthy");
  assert.ok((db.getDb().prepare("SELECT deleted_at FROM health_workouts WHERE source_external_id='old-account-workout'").get() as any).deleted_at);assert.equal((db.getDb().prepare("SELECT deleted_at FROM health_workouts WHERE source_external_id='new-account-workout'").get() as any).deleted_at,null);
  assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_workouts WHERE source='hevy' AND deleted_at IS NULL").get() as any).n,1);
});

test("same workout ID and measurement date remain account-scoped across switches and recover when switching back",async()=>{
  const {hevy,db}=await setup();reset(db);
  const sync=async(account:string,title:string,weight:number,day:string)=>hevy.syncHevy({forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>day+"T18:00:00.000Z",request:async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user(account));if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout("shared-workout",title,weight,day+"T14:00:00Z",day+"T15:00:00Z")]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[{date:"2026-08-10",weight_kg:weight}]));return json({},404)}});
  assert.equal((await sync("account-a","Account A workout",80,"2026-08-10")).status,"healthy");
  process.env.HEVY_API_KEY="fixture-key-b";
  assert.equal((await sync("account-b","Account B workout",90,"2026-08-11")).status,"healthy");
  let workouts=db.getDb().prepare("SELECT source_account_identity,source_external_id,external_id,title,deleted_at FROM health_workouts WHERE source='hevy' AND source_external_id='shared-workout' ORDER BY title").all() as any[];
  const bodies=db.getDb().prepare("SELECT source_account_identity,source_external_id,external_id,weight_kg,deleted_at FROM health_body_measurements WHERE source='hevy' AND source_external_id='2026-08-10' ORDER BY weight_kg").all() as any[];
  assert.equal(workouts.length,2);assert.equal(new Set(workouts.map(row=>row.source_account_identity)).size,2);assert.equal(new Set(workouts.map(row=>row.external_id)).size,2);assert.ok(workouts.find(row=>row.title==="Account A workout")?.deleted_at);assert.equal(workouts.find(row=>row.title==="Account B workout")?.deleted_at,null);
  assert.equal(bodies.length,2);assert.equal(new Set(bodies.map(row=>row.source_account_identity)).size,2);assert.equal(new Set(bodies.map(row=>row.external_id)).size,2);assert.ok(bodies.find(row=>row.weight_kg===80)?.deleted_at);assert.equal(bodies.find(row=>row.weight_kg===90)?.deleted_at,null);
  const snapshot=(await import("@/lib/health")).healthSnapshot("2026-08-11T19:00:00.000Z");assert.equal(snapshot.training.liftSessions[0].externalId,"shared-workout");
  process.env.HEVY_API_KEY="fixture-key-a";
  assert.equal((await sync("account-a","Account A restored",82,"2026-08-12")).status,"healthy");
  workouts=db.getDb().prepare("SELECT title,deleted_at FROM health_workouts WHERE source='hevy' AND source_external_id='shared-workout' ORDER BY title").all() as any[];
  assert.equal(workouts.filter(row=>row.deleted_at==null).length,1);assert.equal(workouts.find(row=>row.title==="Account A restored")?.deleted_at,null);assert.ok(workouts.find(row=>row.title==="Account B workout")?.deleted_at);
});

test("Hevy health verification is cached for thirty minutes but force and credential changes bypass it",async()=>{
  const {hevy,db}=await setup();reset(db);let calls=0;const request=async()=>{calls++;return json(user())};
  hevy.invalidateHealthCheckCache();
  assert.equal((await hevy.healthCheck({request,baseUrl:"https://fixture.test/v1",nowMs:0})).ok,true);
  assert.equal((await hevy.healthCheck({request,baseUrl:"https://fixture.test/v1",nowMs:29*60_000})).ok,true);assert.equal(calls,1);
  assert.equal((await hevy.healthCheck({request,baseUrl:"https://fixture.test/v1",nowMs:29*60_000,force:true})).ok,true);assert.equal(calls,2);
  process.env.HEVY_API_KEY="fixture-key-c";
  assert.equal((await hevy.healthCheck({request,baseUrl:"https://fixture.test/v1",nowMs:29*60_000})).ok,true);assert.equal(calls,3);
  assert.equal((await hevy.healthCheck({request,baseUrl:"https://fixture.test/v1",nowMs:60*60_000})).ok,true);assert.equal(calls,4);
});

test("Hevy credential replacement immediately quarantines only Hevy data and invalidates current account truth",async()=>{
  const {hevy,health,db}=await setup();reset(db);const syncedAt="2026-08-15T12:00:00.000Z";
  const request=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user("credential-account"));if(u.pathname.endsWith("/workouts"))return json(page("workouts",[workout("credential-workout","Credential workout",80,"2026-08-15T10:00:00Z","2026-08-15T11:00:00Z")]));if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[{date:"2026-08-15",weight_kg:88}]));return json({},404)};
  assert.equal((await hevy.syncHevy({request,forceFull:true,baseUrl:"https://fixture.test/v1",now:()=>syncedAt})).status,"healthy");
  const database=db.getDb();database.prepare("INSERT INTO health_workouts(idempotency_key,source,external_id,title,started_at) VALUES ('manual:credential-fixture','manual','manual-credential-fixture','Manual workout','2026-08-15T09:00:00Z')").run();database.prepare("INSERT INTO health_body_measurements(idempotency_key,measured_at,weight_kg,source,external_id) VALUES ('whoop:credential-fixture','2026-08-15T09:00:00Z',77,'whoop','whoop-credential-fixture')").run();
  const recommendation=health.logRecommendation({idempotencyKey:"rec:credential-replacement",category:"training",action:"Old Hevy action",rationale:"Old account data",inputsAsOf:syncedAt,provenance:["Hevy workout"],expiresAt:"2026-08-16T12:00:00.000Z"});
  const before=database.prepare("SELECT account_identity,generation,last_success_at FROM health_sync_state WHERE source='hevy'").get() as any;assert.ok(before.account_identity);assert.equal(health.dashboardHealthSnapshot("2026-08-15T12:05:00.000Z").recommendation.action,"Old Hevy action");
  const {setApiKey}=await import("@/lib/connections");let checks=0;const definition={id:"hevy",label:"Hevy",surfaces:["dashboard"],reconnect:"api_key",defaultEnabled:false,configured:()=>true,check:async(options?:{force?:boolean})=>{checks++;assert.equal(options?.force,true);return {ok:true,detail:"fixture credential verified"}}} as any;
  await setApiKey("hevy","HEVY_API_KEY"," fixture-key-a ",{definitions:[definition]});
  const same=database.prepare("SELECT account_identity,generation,last_success_at FROM health_sync_state WHERE source='hevy'").get() as any;assert.deepEqual(same,before);assert.equal((database.prepare("SELECT deleted_at FROM health_workouts WHERE source_external_id='credential-workout'").get() as any).deleted_at,null);
  await setApiKey("hevy","HEVY_API_KEY","fixture-key-b",{definitions:[definition]});
  const replaced=database.prepare("SELECT account_identity,generation,cursor,last_attempt_at,last_success_at,last_error,records_seen,records_changed,lease_token,lease_expires_at FROM health_sync_state WHERE source='hevy'").get() as any;
  assert.equal(replaced.account_identity,null);assert.equal(replaced.generation,before.generation+1);for(const field of ["cursor","last_attempt_at","last_success_at","last_error","lease_token","lease_expires_at"])assert.equal(replaced[field],null);assert.equal(replaced.records_seen,0);assert.equal(replaced.records_changed,0);
  assert.ok((database.prepare("SELECT deleted_at FROM health_workouts WHERE source_external_id='credential-workout'").get() as any).deleted_at);assert.ok((database.prepare("SELECT deleted_at FROM health_body_measurements WHERE source='hevy' AND source_external_id='2026-08-15'").get() as any).deleted_at);
  assert.equal((database.prepare("SELECT deleted_at FROM health_workouts WHERE external_id='manual-credential-fixture'").get() as any).deleted_at,null);assert.equal((database.prepare("SELECT deleted_at FROM health_body_measurements WHERE external_id='whoop-credential-fixture'").get() as any).deleted_at,null);
  const snapshot=health.dashboardHealthSnapshot("2026-08-15T12:06:00.000Z");assert.equal(snapshot.connections.hevy.status,"disconnected");assert.equal(snapshot.connections.hevy.lastSuccessAt,null);assert.equal(snapshot.training.liftSessions.some((row:any)=>row.externalId==="credential-workout"),false);assert.equal(snapshot.recommendation,null);assert.equal(snapshot.recommendationHistory.id,recommendation.id);assert.match(snapshot.recommendationHistory.warning,/Hevy evidence is disconnected/);assert.equal(checks,2);
});

test("disable and key replacement during an in-flight sync invalidate staged work",async()=>{
  const {hevy,state,db}=await setup();reset(db);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);let reached!:()=>void;const reachedGate=new Promise<void>(resolve=>reached=resolve);
  const request=async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts")){reached();await gate;return json(page("workouts",[workout("raced","Raced",80)]))}if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)};
  const inFlight=hevy.syncHevy({request,forceFull:true,baseUrl:"https://fixture.test/v1"});await reachedGate;const {setEnabled}=await import("@/lib/connections");setEnabled("hevy","dashboard",false);release();const disabled=await inFlight;assert.equal(disabled.status,"broken");assert.match(disabled.detail,/changed during sync/i);assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_workouts WHERE source_external_id='raced'").get() as any).n,0);
  reset(db);let releaseKey!:()=>void;const keyGate=new Promise<void>(resolve=>releaseKey=resolve);let reachedKey!:()=>void;const atKeyGate=new Promise<void>(resolve=>reachedKey=resolve);const keyed=hevy.syncHevy({forceFull:true,baseUrl:"https://fixture.test/v1",request:async(url:string)=>{const u=new URL(url);if(u.pathname.endsWith("/user/info"))return json(user());if(u.pathname.endsWith("/workouts")){reachedKey();await keyGate;return json(page("workouts",[workout("key-raced","Key raced",80)]))}if(u.pathname.endsWith("/body_measurements"))return json(page("body_measurements",[]));return json({},404)}});await atKeyGate;process.env.HEVY_API_KEY="fixture-key-replaced";db.getDb().transaction(()=>state.bumpSourceGeneration(db.getDb(),"hevy"))();releaseKey();const replaced=await keyed;assert.equal(replaced.status,"broken");assert.match(replaced.detail,/changed during sync/i);assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_workouts WHERE source_external_id='key-raced'").get() as any).n,0);
});

test("off switch makes no requests and bounded pagination rejects excessive page counts",async()=>{
  const {hevy,db}=await setup();reset(db);enable(db,false);let calls=0;const result=await hevy.syncHevy({request:async()=>{calls++;return json({})},forceFull:true,baseUrl:"https://fixture.test/v1"});assert.equal(result.status,"disconnected");assert.equal(calls,0);
  const client=new hevy.HevyClient("fixture",async(url:string)=>{const p=Number(new URL(url).searchParams.get("page"));return json(page("workouts",[],p,3))},"https://fixture.test/v1",100,1000);await assert.rejects(()=>hevy.fetchPaginated(client,"/workouts","workouts",{maxPages:2}),/HEVY_PAGINATION_ERROR/);
});