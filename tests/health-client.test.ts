import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import Database from "better-sqlite3";
import { LiveStore } from "@/hooks/useLiveData";
import {
  HEALTH_LIVE_MAX_AGE_MS,
  HEALTH_REST_MAX_AGE_MS,
  selectCurrentHealthSnapshot,
} from "@/lib/health/client-freshness";

const nowMs = Date.parse("2026-08-15T00:00:00.000Z");
const snap = (generatedAt: string, marker: string): any => ({
  generatedAt,
  marker,
  connections: { whoop: { status: "healthy", lastSuccessAt: generatedAt }, hevy: { status: "healthy", lastSuccessAt: generatedAt } },
  whoop: { recovery: { value: 75, asOf: generatedAt, freshness: "fresh" } },
  readiness: { available: true, recovery: { value: 75, asOf: generatedAt, freshness: "fresh" }, recommendation: { id: 1, current: true } },
  recommendation: { id: 1, current: true, status: "active", inputsAsOf: generatedAt, expiresAt: "2026-08-16T00:00:00.000Z", provenance: ["whoop"] },
  recommendationHistory: { id: 1, current: true, status: "active", inputsAsOf: generatedAt, expiresAt: "2026-08-16T00:00:00.000Z", provenance: ["whoop"] },
  substances: { marker },
});

test("live transport epochs clear payloads on close and reopen until the current connection sends a message", () => {
  const store = new LiveStore();
  const first = store.beginConnection();
  assert.equal(store.markOpen(first), true);
  assert.equal(store.setForEpoch(first, "health", { generatedAt: "first" }), true);
  assert.deepEqual(store.get("health"), { generatedAt: "first" });

  assert.equal(store.closeConnection(first), true);
  assert.equal(store.get("health"), undefined);
  const second = store.beginConnection();
  assert.equal(store.markOpen(second), true);
  assert.equal(store.get("health"), undefined);
  assert.equal(store.setForEpoch(first, "health", { generatedAt: "stale" }), false);
  assert.equal(store.get("health"), undefined);
  assert.equal(store.setForEpoch(second, "health", { generatedAt: "current" }), true);
  assert.deepEqual(store.get("health"), { generatedAt: "current" });
});

test("cached REST data is rejected when the latest refresh failed", () => {
  const cached = snap(new Date(nowMs - 1_000).toISOString(), "cached");
  const selected = selectCurrentHealthSnapshot({
    live: null,
    rest: cached,
    transport: "closed",
    restRequestSucceeded: false,
    restLoading: false,
    nowMs,
  });
  assert.deepEqual(selected, { snapshot: null, source: null });
});

test("live and REST snapshots age out at their explicit bounds", () => {
  const oldLive = snap(new Date(nowMs - HEALTH_LIVE_MAX_AGE_MS - 1).toISOString(), "old-live");
  const oldRest = snap(new Date(nowMs - HEALTH_REST_MAX_AGE_MS - 1).toISOString(), "old-rest");
  assert.deepEqual(selectCurrentHealthSnapshot({live:oldLive,rest:null,transport:"open",restRequestSucceeded:false,restLoading:false,nowMs}),{snapshot:null,source:null});
  assert.deepEqual(selectCurrentHealthSnapshot({live:null,rest:oldRest,transport:"closed",restRequestSucceeded:true,restLoading:false,nowMs}),{snapshot:null,source:null});
});

test("newest qualifying snapshot wins while an older current REST snapshot only enriches private detail", () => {
  const live = snap(new Date(nowMs - 1_000).toISOString(), "live");
  const olderBase=snap(new Date(nowMs - 2_000).toISOString(), "older-rest");
  const olderRest = {...olderBase,recommendation:{...olderBase.recommendation,action:"private"}};
  let selected = selectCurrentHealthSnapshot({live,rest:olderRest,transport:"open",restRequestSucceeded:true,restLoading:false,nowMs});
  assert.equal(selected.source,"live");
  assert.equal(selected.snapshot?.marker,"live");
  assert.equal((selected.snapshot?.recommendation as any).action,"private");
  assert.deepEqual(selected.snapshot?.substances,{marker:"older-rest"});

  const newerBase=snap(new Date(nowMs).toISOString(), "newer-rest");
  const newerRest = {...newerBase,recommendation:{...newerBase.recommendation,action:"private"}};
  selected = selectCurrentHealthSnapshot({live,rest:newerRest,transport:"open",restRequestSucceeded:true,restLoading:false,nowMs});
  assert.equal(selected.source,"rest");
  assert.equal(selected.snapshot?.marker,"newer-rest");
  assert.equal((selected.snapshot?.recommendation as any).action,"private");
  assert.deepEqual(selected.snapshot?.substances,{marker:"newer-rest"});
});

test("render-time currency withholds a 00:05 recommendation at 00:30 without waiting for another broadcast", () => {
  const generatedAt="2026-08-15T00:00:00.000Z";
  const live={...snap(generatedAt,"live"),recommendation:{id:1,current:true,status:"active",inputsAsOf:generatedAt,expiresAt:"2026-08-15T00:05:00.000Z",provenance:["whoop"]},recommendationHistory:{id:1,current:true,status:"active",inputsAsOf:generatedAt,expiresAt:"2026-08-15T00:05:00.000Z",provenance:["whoop"]}};
  const selected=selectCurrentHealthSnapshot({live,rest:null,transport:"open",restRequestSucceeded:false,restLoading:false,nowMs:Date.parse("2026-08-15T00:30:00.000Z")});
  assert.equal(selected.source,"live");
  assert.equal(selected.snapshot?.recommendation,null);
  assert.equal(selected.snapshot?.readiness?.recommendation,null);
  assert.equal(selected.snapshot?.recommendationHistory?.current,false);
  assert.equal(selected.snapshot?.recommendationHistory?.warning,"expired");
});

test("newer authenticated REST revokes older live readiness and recommendation without contradictory history", () => {
  const now=Date.parse("2026-08-15T00:01:00.000Z");
  const live=snap("2026-08-15T00:00:00.000Z","live");
  const rest={...snap("2026-08-15T00:00:30.000Z","rest"),readiness:{available:false,recovery:{value:75,asOf:"2026-08-15T00:00:00.000Z",freshness:"fresh"},recommendation:null},recommendation:null,recommendationHistory:{id:1,current:false,warning:"revoked",status:"active",inputsAsOf:"2026-08-15T00:00:00.000Z",expiresAt:"2026-08-16T00:00:00.000Z",provenance:["whoop"]}};
  const selected=selectCurrentHealthSnapshot({live,rest,transport:"open",restRequestSucceeded:true,restLoading:false,nowMs:now});
  assert.equal(selected.source,"rest");
  assert.equal(selected.snapshot?.marker,"rest");
  assert.equal(selected.snapshot?.readiness?.available,false);
  assert.equal(selected.snapshot?.recommendation,null);
  assert.equal(selected.snapshot?.readiness?.recommendation,null);
  assert.equal(selected.snapshot?.recommendationHistory?.current,false);
  assert.notEqual(selected.snapshot?.recommendationHistory?.warning,null);
});

test("render-time currency re-ages WHOOP and Hevy source health before keeping recommendations current", () => {
  const renderAt=Date.parse("2026-08-15T00:30:00.000Z");
  const generatedAt="2026-08-15T00:00:00.000Z";
  const base=snap(generatedAt,"source-boundary");
  const whoopStale={
    ...base,
    connections:{...base.connections,whoop:{status:"healthy",lastSuccessAt:"2026-08-13T12:01:00.000Z"}},
    whoop:{recovery:{value:75,asOf:"2026-08-13T12:01:00.000Z",freshness:"fresh"}},
    readiness:{...base.readiness,recovery:{value:75,asOf:"2026-08-13T12:01:00.000Z",freshness:"fresh"}},
  };
  let selected=selectCurrentHealthSnapshot({live:whoopStale,rest:null,transport:"open",restRequestSucceeded:false,restLoading:false,nowMs:renderAt});
  assert.equal(selected.snapshot?.connections?.whoop?.status,"stale");
  assert.equal(selected.snapshot?.readiness?.available,false);
  assert.equal(selected.snapshot?.recommendation,null);
  assert.equal(selected.snapshot?.recommendationHistory?.current,false);
  assert.match(selected.snapshot?.recommendationHistory?.warning,/WHOOP evidence is stale/);

  const hevyBase=snap(generatedAt,"hevy-boundary");
  const hevyStale={
    ...hevyBase,
    connections:{...hevyBase.connections,hevy:{status:"healthy",lastSuccessAt:"2026-08-14T18:29:59.000Z"}},
    recommendation:{...hevyBase.recommendation,provenance:["hevy"]},
    recommendationHistory:{...hevyBase.recommendationHistory,provenance:["hevy"]},
  };
  selected=selectCurrentHealthSnapshot({live:hevyStale,rest:null,transport:"open",restRequestSucceeded:false,restLoading:false,nowMs:renderAt});
  assert.equal(selected.snapshot?.connections?.hevy?.status,"stale");
  assert.equal(selected.snapshot?.recommendation,null);
  assert.equal(selected.snapshot?.recommendationHistory?.current,false);
  assert.match(selected.snapshot?.recommendationHistory?.warning,/Hevy evidence is stale/);
});

test("migration 0023 replaces legacy WHOOP text while preserving only allowlisted fixed codes", () => {
  const database = new Database(":memory:");
  database.exec("CREATE TABLE whoop_tokens(user_id INTEGER PRIMARY KEY,last_error TEXT,auth_error TEXT)");
  database.prepare("INSERT INTO whoop_tokens VALUES (1,?,?)").run("raw upstream API body","raw OAuth error_description");
  database.prepare("INSERT INTO whoop_tokens VALUES (2,?,?)").run("WHOOP_DATA_PARTIAL_SYNC","WHOOP_AUTH_REFRESH_FAILED");
  database.exec(fs.readFileSync("db/migrations/0023_health_release_hardening.sql","utf8"));
  assert.deepEqual(database.prepare("SELECT user_id,last_error,auth_error FROM whoop_tokens ORDER BY user_id").all(),[
    {user_id:1,last_error:"WHOOP_DATA_SYNC_FAILED",auth_error:"WHOOP_AUTH_FAILED"},
    {user_id:2,last_error:"WHOOP_DATA_PARTIAL_SYNC",auth_error:"WHOOP_AUTH_REFRESH_FAILED"},
  ]);
  database.close();
});
