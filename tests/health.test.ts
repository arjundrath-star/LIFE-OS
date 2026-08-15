import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"rath-health-test-"));
process.env.RATHWORKSPACE_DB=path.join(tmp,"health.db");
let loaded:Promise<any>|null=null;
function setup(){if(!loaded)loaded=Promise.all([import("@/lib/health"),import("@/db")]).then(([health,db])=>({health,db}));return loaded}
test.after(async()=>{const {db}=await setup();try{db.getDb().close()}catch{}fs.rmSync(tmp,{recursive:true,force:true})});

function cli(payload:any){return new Promise<any>((resolve,reject)=>{const child=spawn(path.join(process.cwd(),"node_modules/.bin/tsx"),["scripts/health-log.ts","meal","--json",JSON.stringify(payload)],{cwd:process.cwd(),env:{...process.env,RATHWORKSPACE_DB:process.env.RATHWORKSPACE_DB!}});let stdout="",stderr="";child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);child.on("exit",code=>code===0?resolve(JSON.parse(stdout)):reject(new Error(stderr||stdout)));});}

test("health migrations create normalized tables, safety columns, and clean foreign keys",async()=>{
  const {db}=await setup();const database=db.getDb();
  const tables=(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'health_%' ORDER BY name").all() as any[]).map(row=>row.name);
  assert.deepEqual(tables,["health_body_measurements","health_checkins","health_meals","health_recommendations","health_substance_events","health_sync_state","health_whoop_daily_archive","health_workout_exercises","health_workout_sets","health_workouts"]);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  assert.ok((database.prepare("PRAGMA table_info(health_meals)").all() as any[]).some(row=>row.name==="payload_hash"));
  assert.ok((database.prepare("PRAGMA table_info(health_body_measurements)").all() as any[]).some(row=>row.name==="supersedes_id"));
  assert.ok((database.prepare("PRAGMA table_info(health_body_measurements)").all() as any[]).some(row=>row.name==="observation_at_known"));
  const syncColumns=new Set((database.prepare("PRAGMA table_info(health_sync_state)").all() as any[]).map(row=>row.name));
  for(const column of ["account_identity","lease_token","lease_expires_at","run_version"])assert.ok(syncColumns.has(column));
  const workoutColumns=new Set((database.prepare("PRAGMA table_info(health_workouts)").all() as any[]).map(row=>row.name));
  const bodyColumns=new Set((database.prepare("PRAGMA table_info(health_body_measurements)").all() as any[]).map(row=>row.name));
  for(const column of ["source_updated_at","source_run_version"]){assert.ok(workoutColumns.has(column));assert.ok(bodyColumns.has(column))}
  for(const column of ["source_account_identity","source_external_id"]){assert.ok(workoutColumns.has(column));assert.ok(bodyColumns.has(column))}
  assert.ok((database.prepare("PRAGMA table_info(whoop_tokens)").all() as any[]).some(row=>row.name==="auth_error"));
  assert.equal((database.prepare("SELECT COUNT(*) n FROM _migrations WHERE name='0026_health_legacy_whoop_quarantine.sql'").get() as any).n,1);
});

test("0026 quarantines recoverable active legacy WHOOP rows on a through-0025 upgrade and replays idempotently",()=>{
  const migrationDb=new Database(":memory:");
  try{
    const migrationDir=path.join(process.cwd(),"db/migrations");
    const through0025=fs.readdirSync(migrationDir).filter(name=>name.endsWith(".sql")&&name<"0026_").sort();
    for(const name of through0025)migrationDb.exec(fs.readFileSync(path.join(migrationDir,name),"utf8"));
    const workoutInsert=migrationDb.prepare(`INSERT INTO health_workouts(idempotency_key,source,external_id,source_account_identity,source_external_id,title,started_at,source_payload,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    workoutInsert.run("upgrade:legacy-whoop-workout","whoop","shared-provider-workout",null,null,"Legacy WHOOP workout","2026-08-01T10:00:00Z",'{"recoverable":"workout"}',"2026-08-01T11:00:00Z","2026-08-01T11:00:00Z",null);
    workoutInsert.run("upgrade:scoped-whoop-workout","whoop","scoped-storage-id","account-a","shared-provider-workout","Scoped WHOOP workout","2026-08-02T10:00:00Z",'{"scoped":true}',"2026-08-02T11:00:00Z","2026-08-02T11:00:00Z",null);
    workoutInsert.run("upgrade:manual-workout","manual","manual-workout",null,null,"Manual workout","2026-08-03T10:00:00Z",null,"2026-08-03T11:00:00Z","2026-08-03T11:00:00Z",null);
    const bodyInsert=migrationDb.prepare(`INSERT INTO health_body_measurements(idempotency_key,measured_at,weight_kg,source,external_id,source_account_identity,source_external_id,source_payload,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    bodyInsert.run("upgrade:legacy-whoop-body","2026-08-01T10:00:00Z",81,"whoop","current",null,null,'{"recoverable":"body"}',"2026-08-01T11:00:00Z","2026-08-01T11:00:00Z",null);
    bodyInsert.run("upgrade:scoped-whoop-body","2026-08-02T10:00:00Z",82,"whoop","scoped-body-storage","account-a","current",'{"scoped":true}',"2026-08-02T11:00:00Z","2026-08-02T11:00:00Z",null);
    bodyInsert.run("upgrade:manual-body","2026-08-03T10:00:00Z",83,"manual","manual-body",null,null,null,"2026-08-03T11:00:00Z","2026-08-03T11:00:00Z",null);
    const migration=fs.readFileSync(path.join(migrationDir,"0026_health_legacy_whoop_quarantine.sql"),"utf8");
    migrationDb.exec(migration);
    const legacyWorkout=migrationDb.prepare("SELECT source_account_identity,source_external_id,source_payload,deleted_at,updated_at FROM health_workouts WHERE idempotency_key='upgrade:legacy-whoop-workout'").get() as any;
    const legacyBody=migrationDb.prepare("SELECT source_account_identity,source_external_id,source_payload,deleted_at,updated_at FROM health_body_measurements WHERE idempotency_key='upgrade:legacy-whoop-body'").get() as any;
    assert.equal(legacyWorkout.source_account_identity,"legacy-unscoped");assert.equal(legacyWorkout.source_external_id,"shared-provider-workout");assert.equal(legacyWorkout.source_payload,'{"recoverable":"workout"}');assert.ok(legacyWorkout.deleted_at);
    assert.equal(legacyBody.source_account_identity,"legacy-unscoped");assert.equal(legacyBody.source_external_id,"current");assert.equal(legacyBody.source_payload,'{"recoverable":"body"}');assert.ok(legacyBody.deleted_at);
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,deleted_at,updated_at FROM health_workouts WHERE idempotency_key='upgrade:scoped-whoop-workout'").get(),{source_account_identity:"account-a",source_external_id:"shared-provider-workout",deleted_at:null,updated_at:"2026-08-02T11:00:00Z"});
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,deleted_at,updated_at FROM health_body_measurements WHERE idempotency_key='upgrade:scoped-whoop-body'").get(),{source_account_identity:"account-a",source_external_id:"current",deleted_at:null,updated_at:"2026-08-02T11:00:00Z"});
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,deleted_at,updated_at FROM health_workouts WHERE idempotency_key='upgrade:manual-workout'").get(),{source_account_identity:null,source_external_id:null,deleted_at:null,updated_at:"2026-08-03T11:00:00Z"});
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,deleted_at,updated_at FROM health_body_measurements WHERE idempotency_key='upgrade:manual-body'").get(),{source_account_identity:null,source_external_id:null,deleted_at:null,updated_at:"2026-08-03T11:00:00Z"});
    migrationDb.exec(migration);
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,source_payload,deleted_at,updated_at FROM health_workouts WHERE idempotency_key='upgrade:legacy-whoop-workout'").get(),legacyWorkout);
    assert.deepEqual(migrationDb.prepare("SELECT source_account_identity,source_external_id,source_payload,deleted_at,updated_at FROM health_body_measurements WHERE idempotency_key='upgrade:legacy-whoop-body'").get(),legacyBody);
  }finally{migrationDb.close()}
});

test("idempotency keys replay only identical payloads, reject collisions and overlong keys",async()=>{
  const {health}=await setup();const payload={idempotencyKey:"meal:one",mealAt:"2026-08-14T12:00:00Z",mealType:"lunch",description:"rice bowl",caloriesLow:600,caloriesHigh:800,caloriesSelected:700,proteinLowG:30,proteinHighG:45,proteinSelectedG:38,confidence:"medium"};
  const original=health.logMeal(payload);assert.deepEqual(health.logMeal(payload),{id:original.id,created:false});
  assert.throws(()=>health.logMeal({...payload,description:"different payload"}),/already used with a different payload/);
  assert.throws(()=>health.logMeal({...payload,idempotencyKey:"x".repeat(241)}),/240 characters or fewer/);
});

test("concurrent CLI writes converge to one row and one replay",async()=>{
  const payload={idempotencyKey:"meal:concurrent",mealAt:"2026-08-14T16:00:00Z",mealType:"snack",description:"concurrent fixture",caloriesLow:100,caloriesHigh:120};
  const outputs=await Promise.all([cli(payload),cli(payload)]);assert.deepEqual(outputs.map(row=>row.created).sort(),[false,true]);
  const {db}=await setup();assert.equal((db.getDb().prepare("SELECT COUNT(*) n FROM health_meals WHERE idempotency_key='meal:concurrent'").get() as any).n,1);
});

test("strict temporal validation rejects impossible dates, offsetless times, and date-only values",async()=>{
  const {health}=await setup();assert.throws(()=>health.dayKey("2026-02-31"),/YYYY-MM-DD/);assert.throws(()=>health.isoDateTime("2026-08-14T12:00:00","at"),/explicit timezone/);assert.throws(()=>health.isoDateTime("2026-08-14","at"),/explicit timezone/);assert.equal(health.isoDateTime("2026-08-14T08:00:00-04:00","at"),"2026-08-14T12:00:00.000Z");
});

test("meal, check-in, body, and substance corrections preserve lineage and active-state truth",async()=>{
  const {health,db}=await setup();
  const meal=health.logMeal({idempotencyKey:"meal:lineage",mealAt:"2026-08-14T12:00:00Z",description:"first"});const correctedMeal=health.logMeal({idempotencyKey:"meal:lineage:2",mealAt:"2026-08-14T12:00:00Z",description:"corrected",supersedesId:meal.id});
  const body=health.logBodyMeasurement({idempotencyKey:"body:lineage",measuredAt:"2026-08-14T12:00:00Z",weightKg:90});const correctedBody=health.logBodyMeasurement({idempotencyKey:"body:lineage:2",measuredAt:"2026-08-14T12:05:00Z",weightKg:89.5,supersedesId:body.id});
  const substance=health.logSubstance({idempotencyKey:"sub:lineage",occurredAt:"2026-08-13T22:00:00Z",substance:"alcohol",standardDrinks:2});const correctedSubstance=health.logSubstance({idempotencyKey:"sub:lineage:2",occurredAt:"2026-08-13T22:00:00Z",substance:"alcohol",standardDrinks:1,supersedesId:substance.id});
  assert.deepEqual(db.getDb().prepare("SELECT id,status,supersedes_id FROM health_meals WHERE id IN (?,?) ORDER BY id").all(meal.id,correctedMeal.id),[{id:meal.id,status:"superseded",supersedes_id:null},{id:correctedMeal.id,status:"active",supersedes_id:meal.id}]);
  assert.deepEqual(db.getDb().prepare("SELECT id,status,supersedes_id FROM health_body_measurements WHERE id IN (?,?) ORDER BY id").all(body.id,correctedBody.id),[{id:body.id,status:"superseded",supersedes_id:null},{id:correctedBody.id,status:"active",supersedes_id:body.id}]);
  assert.deepEqual(db.getDb().prepare("SELECT id,status,supersedes_id FROM health_substance_events WHERE id IN (?,?) ORDER BY id").all(substance.id,correctedSubstance.id),[{id:substance.id,status:"superseded",supersedes_id:null},{id:correctedSubstance.id,status:"active",supersedes_id:substance.id}]);
  assert.throws(()=>health.logBodyMeasurement({idempotencyKey:"body:lineage:3",measuredAt:"2026-08-14T12:10:00Z",weightKg:89,supersedesId:body.id}),/not active/);
});

test("check-ins preserve unknown versus explicit false",async()=>{
  const {health,db}=await setup();const unknown=health.logCheckin({idempotencyKey:"checkin:unknown",effectiveAt:"2026-08-14T08:00:00Z",trainingCompleted:null,nutritionAdherent:null});const explicitNoPayload={idempotencyKey:"checkin:no",effectiveAt:"2026-08-14T20:00:00Z",trainingCompleted:false,nutritionAdherent:false,proteinTargetMet:true,stepsTargetMet:false,trainingIntent:"easy bench"};const explicitNo=health.logCheckin(explicitNoPayload);assert.equal(health.logCheckin(explicitNoPayload).created,false);
  assert.deepEqual(db.getDb().prepare("SELECT id,training_completed,nutrition_adherent,protein_target_met,steps_target_met FROM health_checkins WHERE id IN (?,?) ORDER BY id").all(unknown.id,explicitNo.id),[{id:unknown.id,training_completed:null,nutrition_adherent:null,protein_target_met:null,steps_target_met:null},{id:explicitNo.id,training_completed:0,nutrition_adherent:0,protein_target_met:1,steps_target_met:0}]);
});

test("public snapshot minimizes substance details while private CLI snapshot retains them",async()=>{
  const {health}=await setup();health.logSubstance({idempotencyKey:"sub:private",occurredAt:"2026-08-14T21:00:00Z",substance:"cannabis",thcMg:5,context:"private fixture"});
  const publicSnap=health.healthSnapshot("2026-08-14T22:00:00Z"),privateSnap=health.privateHealthSnapshot("2026-08-14T22:00:00Z");
  assert.equal(publicSnap.substances.eventCount>=1,true);assert.equal("events" in publicSnap.substances,false);assert.equal(privateSnap.substances.events.some((row:any)=>row.context==="private fixture"),true);
});

test("dashboard projection keeps trainer fields but removes raw substance events at the browser boundary",async()=>{
  const {health}=await setup();health.logCheckin({idempotencyKey:"checkin:dashboard-projection",effectiveAt:"2026-08-14T21:15:00Z",energy:4,notes:"PRIVATE_CHECKIN_MARKER"});health.logSubstance({idempotencyKey:"sub:dashboard-projection",occurredAt:"2026-08-14T21:20:00Z",substance:"alcohol",amount:2,unit:"oz",context:"RAW_SUBSTANCE_CONTEXT_MARKER"});const rec=health.logRecommendation({idempotencyKey:"rec:dashboard-projection",category:"general",action:"DASHBOARD_ACTION_MARKER",rationale:"DASHBOARD_RATIONALE_MARKER",inputsAsOf:"2026-08-14T21:30:00Z",provenance:["DASHBOARD_PROVENANCE_MARKER"],expiresAt:"2026-08-15T21:30:00Z"});
  const dashboard=health.dashboardHealthSnapshot("2026-08-14T22:00:00Z"),privateSnap=health.privateHealthSnapshot("2026-08-14T22:00:00Z"),serialized=JSON.stringify(dashboard);
  assert.equal(privateSnap.substances.events.some((row:any)=>row.context==="RAW_SUBSTANCE_CONTEXT_MARKER"),true);assert.equal("events" in dashboard.substances,false);assert.doesNotMatch(serialized,/RAW_SUBSTANCE_CONTEXT_MARKER/);assert.equal(dashboard.substances.eventCount>=1,true);assert.equal(dashboard.recommendation.id,rec.id);assert.equal(dashboard.recommendation.action,"DASHBOARD_ACTION_MARKER");assert.equal(dashboard.recommendation.rationale,"DASHBOARD_RATIONALE_MARKER");assert.deepEqual(dashboard.recommendation.provenance,["DASHBOARD_PROVENANCE_MARKER"]);assert.equal(dashboard.checkin.notes,"PRIVATE_CHECKIN_MARKER");
});

test("public recommendation projection omits arbitrary action, rationale, and provenance everywhere",async()=>{
  const {health,db}=await setup();const rec=health.logRecommendation({idempotencyKey:"rec:private-projection",category:"training",action:"PRIVATE_ACTION_MARKER",rationale:"PRIVATE_RATIONALE_MARKER",inputsAsOf:"2026-08-14T21:30:00Z",provenance:["PRIVATE_PROVENANCE_MARKER"],expiresAt:"2026-08-15T21:30:00Z"});
  const publicSnap=health.healthSnapshot("2026-08-14T22:00:00Z"),privateSnap=health.privateHealthSnapshot("2026-08-14T22:00:00Z"),serialized=JSON.stringify(publicSnap);
  assert.doesNotMatch(serialized,/PRIVATE_ACTION_MARKER|PRIVATE_RATIONALE_MARKER|PRIVATE_PROVENANCE_MARKER/);assert.equal("action" in publicSnap.recommendation,false);assert.equal("rationale" in publicSnap.readiness.recommendation,false);assert.equal("provenance" in publicSnap.recommendationHistory,false);assert.equal(privateSnap.recommendation.action,"PRIVATE_ACTION_MARKER");assert.deepEqual(privateSnap.recommendation.provenance,["PRIVATE_PROVENANCE_MARKER"]);assert.equal(publicSnap.recommendation.current,true);assert.equal(publicSnap.recommendation.category,"training");assert.equal(typeof publicSnap.recommendation.inputAgeHours,"number");
  db.getDb().prepare("UPDATE health_recommendations SET status='dismissed' WHERE id=?").run(rec.id);
});

test("alcohol standardized amount stays unknown when any conversion is unavailable",async()=>{
  const {health}=await setup();health.logSubstance({idempotencyKey:"sub:alcohol-raw-only",occurredAt:"2026-08-14T20:00:00Z",substance:"alcohol",amount:12,unit:"oz"});const snap=health.healthSnapshot("2026-08-14T22:00:00Z");assert.equal(snap.substances.standardizedAmountKnown,false);assert.equal(snap.substances.knownStandardDrinks,null);
});

test("snapshot read boundary excludes unscoped and non-current imports while preserving manual rows",async()=>{
  const {health,db}=await setup();const database=db.getDb();database.exec("DELETE FROM health_workout_exercises; DELETE FROM health_workouts; DELETE FROM health_sync_state WHERE source IN ('whoop','hevy')");
  database.prepare("INSERT INTO health_sync_state(source,account_identity,updated_at) VALUES (?,?,?)").run("whoop","current-whoop-account","2026-08-20T12:00:00Z");database.prepare("INSERT INTO health_sync_state(source,account_identity,updated_at) VALUES (?,?,?)").run("hevy","current-hevy-account","2026-08-20T12:00:00Z");
  const workout=database.prepare(`INSERT INTO health_workouts(idempotency_key,source,external_id,source_account_identity,source_external_id,title,started_at) VALUES (?,?,?,?,?,?,?)`);
  workout.run("boundary:whoop-current","whoop","whoop-current-storage","current-whoop-account","whoop-current","Current WHOOP Running","2026-08-20T10:00:00Z");workout.run("boundary:whoop-unscoped","whoop","whoop-unscoped",null,null,"UNSCOPED_WHOOP_WORKOUT","2026-08-20T09:00:00Z");workout.run("boundary:whoop-wrong","whoop","whoop-wrong","wrong-whoop-account","whoop-wrong","WRONG_WHOOP_WORKOUT","2026-08-20T08:00:00Z");
  workout.run("boundary:hevy-current","hevy","hevy-current-storage","current-hevy-account","hevy-current","Current Hevy strength","2026-08-20T07:00:00Z");workout.run("boundary:hevy-unscoped","hevy","hevy-unscoped",null,null,"UNSCOPED_HEVY_WORKOUT","2026-08-20T06:00:00Z");workout.run("boundary:hevy-wrong","hevy","hevy-wrong","wrong-hevy-account","hevy-wrong","WRONG_HEVY_WORKOUT","2026-08-20T05:00:00Z");
  const body=database.prepare(`INSERT INTO health_body_measurements(idempotency_key,measured_at,weight_kg,source,external_id,source_account_identity,source_external_id) VALUES (?,?,?,?,?,?,?)`);
  body.run("boundary:manual-body","2026-08-20T12:00:00Z",80,"manual","manual-visible",null,null);body.run("boundary:whoop-current-body","2026-08-20T11:00:00Z",81,"whoop","whoop-current-body-storage","current-whoop-account","current");body.run("boundary:whoop-unscoped-body","2026-08-20T10:00:00Z",82,"whoop","whoop-unscoped-body",null,null);body.run("boundary:hevy-unscoped-body","2026-08-20T09:00:00Z",83,"hevy","hevy-unscoped-body",null,null);body.run("boundary:hevy-wrong-body","2026-08-20T08:00:00Z",84,"hevy","hevy-wrong-body","wrong-hevy-account","wrong");
  const snapshot=health.healthSnapshot("2026-08-20T13:00:00Z"),serialized=JSON.stringify(snapshot);
  assert.equal(snapshot.body.history.some((row:any)=>row.externalId==="manual-visible"&&row.source==="manual"),true);assert.equal(snapshot.body.history.some((row:any)=>row.externalId==="current"&&row.source==="whoop"),true);assert.doesNotMatch(serialized,/UNSCOPED_WHOOP_WORKOUT|UNSCOPED_HEVY_WORKOUT|WRONG_WHOOP_WORKOUT|WRONG_HEVY_WORKOUT|whoop-unscoped-body|hevy-unscoped-body|hevy-wrong-body/);assert.equal(snapshot.training.activities.some((row:any)=>row.externalId==="whoop-current"),true);assert.equal(snapshot.training.liftSessions.some((row:any)=>row.externalId==="hevy-current"),true);
  database.prepare("DELETE FROM health_workouts WHERE idempotency_key LIKE 'boundary:%'").run();database.prepare("DELETE FROM health_body_measurements WHERE idempotency_key LIKE 'boundary:%'").run();
});

test("overlapping Hevy and WHOOP strength records count once while general activity stays separate",async()=>{
  const {health,db}=await setup();const database=db.getDb(),insert=database.prepare(`INSERT INTO health_workouts (idempotency_key,source,external_id,source_account_identity,source_external_id,title,started_at,ended_at,duration_seconds,strain,energy_kj,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),ts="2026-08-14T22:00:00Z";
  const hevy=Number(insert.run("dedupe:hevy","hevy","h1-storage","current-hevy-account","h1","Upper strength","2026-08-14T18:00:00Z","2026-08-14T19:00:00Z",3600,null,null,ts,ts).lastInsertRowid);insert.run("dedupe:whoop","whoop","w1-storage","current-whoop-account","w1","Weightlifting","2026-08-14T18:05:00Z","2026-08-14T19:02:00Z",3420,12,900,ts,ts);insert.run("dedupe:run","whoop","w2-storage","current-whoop-account","w2","Running","2026-08-13T18:00:00Z","2026-08-13T18:30:00Z",1800,8,500,ts,ts);
  const exercise=Number(database.prepare("INSERT INTO health_workout_exercises (workout_id,exercise_order,title) VALUES (?,?,?)").run(hevy,0,"Bench").lastInsertRowid);database.prepare("INSERT INTO health_workout_sets (exercise_id,set_order,set_type,weight_kg,reps,completed) VALUES (?,?,?,?,?,1)").run(exercise,0,"normal",100,5);
  const snap=health.healthSnapshot(ts);assert.equal(snap.training.weekly.frequency,1);assert.equal(snap.training.weekly.volumeKg,500);assert.equal(snap.training.liftSessions.length,1);assert.deepEqual(snap.training.liftSessions[0].observedBy,["hevy","whoop"]);assert.equal(snap.training.activities.length,1);assert.equal(snap.training.activities[0].title,"Running");
});

test("nearby non-overlapping workouts remain distinct, output is globally sorted, and WHOOP detail is unknown",async()=>{
  const {health,db}=await setup();const database=db.getDb();database.exec("DELETE FROM health_workouts");const insert=database.prepare(`INSERT INTO health_workouts (idempotency_key,source,external_id,source_account_identity,source_external_id,title,started_at,ended_at,duration_seconds,strain,energy_kj,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`),ts="2026-08-15T22:00:00Z";
  const hevy=Number(insert.run("dedupe2:hevy","hevy","h2-storage","current-hevy-account","h2","Upper strength","2026-08-15T10:00:00Z","2026-08-15T10:10:00Z",600,null,null,ts,ts).lastInsertRowid);insert.run("dedupe2:whoop-overlap","whoop","w3-storage","current-whoop-account","w3","Weightlifting","2026-08-15T10:01:00Z","2026-08-15T10:11:00Z",600,8,400,ts,ts);insert.run("dedupe2:whoop-distinct","whoop","w4-storage","current-whoop-account","w4","Weightlifting","2026-08-15T10:20:00Z","2026-08-15T10:30:00Z",600,7,350,ts,ts);
  const exercise=Number(database.prepare("INSERT INTO health_workout_exercises (workout_id,exercise_order,title) VALUES (?,?,?)").run(hevy,0,"Bench").lastInsertRowid);database.prepare("INSERT INTO health_workout_sets (exercise_id,set_order,set_type,weight_kg,reps,completed) VALUES (?,?,?,?,?,1)").run(exercise,0,"normal",100,5);
  const snap=health.healthSnapshot(ts);assert.equal(snap.training.liftSessions.length,2);assert.equal(snap.training.weekly.frequency,2);assert.equal(snap.training.liftSessions[0].externalId,"w4");assert.equal(snap.training.liftSessions[0].exercises,null);assert.equal(snap.training.liftSessions[0].sets,null);assert.equal(snap.training.liftSessions[0].volumeKg,null);assert.deepEqual(snap.training.liftSessions[1].observedBy,["hevy","whoop"]);
});

test("readiness and WHOOP connection freshness use aligned thresholds",async()=>{
  const {health,db}=await setup();const database=db.getDb();database.prepare("UPDATE whoop_tokens SET enabled=0").run();database.prepare(`INSERT OR REPLACE INTO whoop_tokens(user_id,email,refresh_token_enc,enabled,last_sync,last_error,auth_error,connected_at) VALUES (99,'aligned@example.com','fixture',1,'2026-08-18T04:00:00Z',NULL,NULL,'2026-08-18T04:00:00Z')`).run();database.prepare("INSERT OR REPLACE INTO whoop_daily(day,recovery,ts,recovery_updated_at) VALUES ('2026-08-18',65,'2026-08-18T04:00:00Z','2026-08-18T04:00:00Z')").run();database.prepare(`INSERT INTO connections(service,surface,enabled,health,state,detail) VALUES ('whoop','dashboard',1,'ok','on','fixture') ON CONFLICT(service,surface) DO UPDATE SET enabled=1`).run();const snap=health.healthSnapshot("2026-08-19T21:00:00Z");assert.equal(snap.connections.whoop.status,"stale");assert.equal(snap.whoop.recovery.freshness,"stale");assert.equal(snap.readiness.available,false);
});

test("stale, expired, or broken-source recommendations are historical rather than current actions",async()=>{
  const {health,db}=await setup();const stale=health.logRecommendation({idempotencyKey:"rec:stale",category:"recovery",action:"Do not show as current",rationale:"fixture",inputsAsOf:"2026-08-10T10:00:00Z",provenance:["WHOOP recovery"],expiresAt:"2026-08-15T10:00:00Z"});let snap=health.healthSnapshot("2026-08-14T22:00:00Z");assert.equal(snap.recommendation,null);assert.equal(snap.recommendationHistory.current,false);assert.match(snap.recommendationHistory.warning,/stale|WHOOP/);
  db.getDb().prepare("UPDATE health_recommendations SET status='dismissed' WHERE id=?").run(stale.id);health.logRecommendation({idempotencyKey:"rec:expired",category:"general",action:"Expired action",rationale:"fixture",inputsAsOf:"2026-08-14T21:00:00Z",provenance:["checkin"],expiresAt:"2026-08-14T21:30:00Z"});snap=health.healthSnapshot("2026-08-14T22:00:00Z");assert.equal(snap.recommendation,null);assert.equal(snap.recommendationHistory.warning,"expired");
});

test("progression remains conservative",async()=>{const {health}=await setup();const complete=(at:string)=>({at,sets:[{reps:8,weightKg:100,rpe:7.5,rir:null,targetMin:6,targetMax:8}]});assert.equal(health.progressionDecision([complete("2026-08-13T12:00:00Z"),complete("2026-08-10T12:00:00Z")],"2026-08-14T12:00:00Z").status,"increase");assert.equal(health.progressionDecision([{at:"2026-08-13T12:00:00Z",sets:[{reps:8,weightKg:100,rpe:null,rir:null,targetMin:6,targetMax:8}]},complete("2026-08-10T12:00:00Z")],"2026-08-14T12:00:00Z").status,"review_needed");assert.equal(health.estimatedOneRepMax(100,5),116.7)});

test("scheduler guard always clears after an integration failure",async()=>{const {guarded}=await import("@/server/scheduler");let attempts=0;const task=guarded("fixture",async()=>{attempts++;if(attempts===1)throw new Error("expected fixture failure")});await task();await task();assert.equal(attempts,2)});
