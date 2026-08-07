#!/usr/bin/env -S tsx
import { execFileSync } from "node:child_process";
import { getDb } from "@/db";
import { insertSuggestion } from "@/lib/career";

const origin = process.env.CAREER_E2E_ORIGIN || "https://rathworkspace.cloud";
const stamp = Date.now();
const quickTitle = `Career E2E quick add ${stamp}`;
const suggestionTitle = `Career E2E accepted suggestion ${stamp}`;
const dedupe = `e2e:${stamp}`;
const db = getDb();
let browser: import("puppeteer-core").Browser|null = null;

function cleanup(){
  const tx=db.transaction(()=>{
    db.prepare("DELETE FROM career_suggestions WHERE dedupe_key=?").run(dedupe);
    db.prepare("DELETE FROM endeavors WHERE title IN (?,?)").run(quickTitle,suggestionTitle);
  });
  tx.immediate();
}

async function main(){
  cleanup();
  insertSuggestion({dedupeKey:dedupe,type:"new_endeavor",proposed:{title:suggestionTitle,organization:"Internal verification",category:"work",kind:"application",status:"researching",primary_url:`${origin}/career`,notes:"Transient authenticated E2E verification row."},evidenceType:"manual",evidenceUrl:`${origin}/career`,subject:"Authenticated Career acceptance verification",excerpt:"Transient internal verification evidence; removed after the test."});
  const suggestion = db.prepare("SELECT id FROM career_suggestions WHERE dedupe_key=?").get(dedupe) as any;
  const cookie = execFileSync("node_modules/.bin/tsx",["scripts/pokemon-ops-mint-session.ts"],{encoding:"utf8",env:process.env}).trim();
  const puppeteer = await import("puppeteer-core");
  browser = await puppeteer.launch({executablePath:process.env.E2E_CHROMIUM||"/usr/bin/chromium",headless:true,args:["--no-sandbox"]});
  const page = await browser.newPage();
  await page.setViewport({width:1600,height:1100});
  await page.setCookie({name:"__Secure-next-auth.session-token",value:cookie,url:origin,httpOnly:true,secure:true,sameSite:"Lax"});
  const response = await page.goto(`${origin}/career`,{waitUntil:"networkidle0",timeout:60000});
  if(!response?.ok())throw new Error(`career page returned ${response?.status()}`);
  await page.waitForSelector("[data-testid='career-table']");
  const rows = await page.$$eval("[data-testid='career-row']",(nodes)=>nodes.length);
  if(rows<38)throw new Error(`expected at least 38 seeded rows, saw ${rows}`);
  await page.waitForFunction(()=>document.body.innerText.includes("tracked · open"),{timeout:30000});

  await page.type("[data-testid='career-quick-title']",quickTitle);
  await Promise.all([page.waitForResponse((r)=>r.url().includes("/api/career")&&r.request().method()==="POST"&&r.ok()),page.click("[data-testid='career-quick-add']")]);
  await page.waitForSelector("button[aria-label='Close']");
  await page.click("button[aria-label='Close']");
  await page.click("[data-testid='career-view-board']");
  await page.waitForSelector("[data-testid='career-board'] [data-testid='career-board-card']");
  const cards=await page.$$eval("[data-testid='career-board-card']",(nodes)=>nodes.length);
  await page.click("[data-testid='career-view-timeline']");
  await page.waitForSelector("[data-testid='career-timeline']");
  await page.click("[data-testid='career-suggestions-toggle']");
  await page.waitForSelector(`[data-testid='accept-suggestion-${suggestion.id}']`);
  await Promise.all([page.waitForResponse((r)=>r.url().includes("/api/career")&&r.request().method()==="POST"&&r.ok()),page.click(`[data-testid='accept-suggestion-${suggestion.id}']`)]);
  const accepted=db.prepare("SELECT id FROM endeavors WHERE title=? AND source='discovery'").get(suggestionTitle) as any;
  if(!accepted)throw new Error("suggestion acceptance did not create discovery endeavor");
  const shot=`/tmp/career-e2e-${stamp}.png`;
  await page.screenshot({path:shot,fullPage:true});
  console.log(JSON.stringify({origin,authenticated:true,seededRows:rows,boardCards:cards,table:true,board:true,timeline:true,quickAdd:true,suggestionAccepted:true,websocket:"open",screenshot:shot}));
}

main().finally(async()=>{if(browser)await browser.close();cleanup();}).catch((error)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1});
