import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(),"rath-career-test-"));
process.env.RATHWORKSPACE_DB = path.join(tmp,"career.db");
let loaded:Promise<{career:typeof import("@/lib/career");getDb:typeof import("@/db")["getDb"]}>|null=null;
function setup(){if(!loaded)loaded=Promise.all([import("@/lib/career"),import("@/db")]).then(([career,db])=>({career,getDb:db.getDb}));return loaded}

test.after(async() => { const {getDb}=await setup();try { getDb().close(); } catch {} fs.rmSync(tmp,{recursive:true,force:true}); });

test("career endeavors validate kind-specific status and append history", async() => {
  const {career}=await setup();
  const created = career.createEndeavor({title:"Test fellowship",organization:"Test Org",category:"work",kind:"application",status:"researching",deadline:"2026-09-01"});
  assert.ok(created.id > 0);
  assert.throws(() => career.createEndeavor({title:"Bad",category:"community",kind:"engagement",status:"submitted"}), /invalid for engagement/);
  career.updateEndeavor(created.id,{status:"drafting"});
  career.addEndeavorEvent(created.id,{summary:"Met the program lead",detail:"Verification note"});
  const item = career.careerSnapshot().endeavors.find((row:any) => row.id === created.id);
  assert.equal(item.status,"drafting");
  assert.deepEqual(item.events.slice(-2).map((event:any)=>event.event_type),["status_change","note"]);
});

test("dismissal persists dedupe suppression and acceptance is review-gated", async() => {
  const {career,getDb}=await setup();
  const db = getDb();
  const target = career.createEndeavor({title:"Pipeline target",category:"klade",kind:"application",status:"submitted"}).id;
  assert.equal(career.insertSuggestion({dedupeKey:"gmail:test:one:interview",type:"status_change",endeavorId:target,proposed:{status:"interviewing"},evidenceType:"gmail",gmailAccount:"arjundrath@gmail.com",gmailMessageId:"one",subject:"Interview invitation"}),true);
  const first = db.prepare("SELECT id FROM career_suggestions WHERE dedupe_key=?").get("gmail:test:one:interview") as any;
  career.reviewSuggestion(first.id,"dismiss");
  assert.equal(career.insertSuggestion({dedupeKey:"gmail:test:one:interview",type:"status_change",endeavorId:target,proposed:{status:"interviewing"},evidenceType:"gmail"}),false);
  assert.equal((db.prepare("SELECT state FROM career_suggestions WHERE id=?").get(first.id) as any).state,"dismissed");

  career.insertSuggestion({dedupeKey:"gmail:test:two:interview",type:"status_change",endeavorId:target,proposed:{status:"interviewing"},evidenceType:"gmail",subject:"Next round interview"});
  const second = db.prepare("SELECT id FROM career_suggestions WHERE dedupe_key=?").get("gmail:test:two:interview") as any;
  career.reviewSuggestion(second.id,"accept");
  assert.equal((db.prepare("SELECT status FROM endeavors WHERE id=?").get(target) as any).status,"interviewing");

  career.insertSuggestion({dedupeKey:"web:test:new",type:"new_endeavor",proposed:{title:"Fetched program",organization:"Evidence Org",category:"community",kind:"application",status:"researching",primary_url:"https://example.com/program"},evidenceType:"web",evidenceUrl:"https://example.com/program"});
  const third = db.prepare("SELECT id FROM career_suggestions WHERE dedupe_key=?").get("web:test:new") as any;
  career.reviewSuggestion(third.id,"accept");
  assert.equal((db.prepare("SELECT source FROM endeavors WHERE dedupe_key='discovery:web:test:new'").get() as any).source,"discovery");
});
