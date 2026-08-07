import crypto from "node:crypto";
import { getDb, nowIso } from "@/db";
import { recordAgentEvent } from "@/lib/agents";
import { insertSuggestion } from "@/lib/career";
import { gmailSearchMetadata } from "@/lib/sources/google";

const ACTIVE = new Set(["researching","drafting","submitted","interviewing","offer"]);
const exactAccounts = new Set(["arjun@kladeai.com","arjundrath@gmail.com"]);

function stamp() { return new Date().toISOString().replace(/[-:.]/g, "").replace("T", "T").replace("Z", "Z"); }
function norm(value: string) { return value.toLowerCase().replace(/&/g,"and").replace(/[^a-z0-9@.]+/g," ").replace(/\s+/g," ").trim(); }
function approved(email:string) { const e=email.toLowerCase(); return exactAccounts.has(e) || /@(?:[^@]+\.)?nyu\.edu$/.test(e); }
function quoted(value:string) { return value.replace(/["{}]/g," ").trim(); }
function statusFrom(subject:string) {
  const s = norm(subject);
  if (/\b(unfortunately|not selected|rejected|declined|unable to offer|regret to inform)\b/.test(s)) return "rejected";
  if (/\b(interview|next round|schedule (a )?(call|conversation)|meet the team)\b/.test(s)) return "interviewing";
  if (/\b(offer|admitted|selected|congratulations)\b/.test(s)) return "offer";
  if (/\b(application (received|submitted|confirmation)|submission (received|confirmed)|thanks for applying)\b/.test(s)) return "submitted";
  return null;
}
function domain(value:string) {
  try { return new URL(value).hostname.replace(/^www\./,""); } catch { return ""; }
}
function matches(message:{subject:string;from:string}, endeavor:any) {
  const hay = norm(`${message.subject} ${message.from}`);
  const title = norm(endeavor.title);
  const org = norm(endeavor.organization);
  const host = domain(endeavor.primary_url);
  return (title.length >= 5 && hay.includes(title)) || (org.length >= 5 && hay.includes(org)) || (!!host && hay.includes(host));
}

export async function runCareerEmailSync() {
  const runId = `career-email-${stamp()}`;
  recordAgentEvent({ agent:"career-scout", run:runId, kind:"started", status:"running", summary:"Career Gmail status scan started", triggerType:"scheduler", triggerSource:"rathworkspace scheduler" });
  try {
    const db = getDb();
    const accounts = (db.prepare("SELECT email FROM google_accounts WHERE enabled=1 ORDER BY email").all() as any[]).map((r) => String(r.email).toLowerCase()).filter(approved);
    const endeavors = (db.prepare("SELECT id,title,organization,status,primary_url FROM endeavors WHERE kind='application'").all() as any[]).filter((e) => ACTIVE.has(e.status));
    let messages = 0, proposed = 0, accountFailures = 0;
    for (const account of accounts) {
      try {
        const seen = new Map<string,Awaited<ReturnType<typeof gmailSearchMetadata>>[number]>();
        for (let i=0;i<endeavors.length;i+=10) {
          const chunk = endeavors.slice(i,i+10);
          const terms = [...new Set(chunk.flatMap((e) => [e.title,e.organization]).map(quoted).filter((v) => v.length >= 5))].slice(0,18);
          if (!terms.length) continue;
          const query = `newer_than:45d {${terms.map((term) => `subject:"${term}"`).join(" ")}}`;
          for (const message of await gmailSearchMetadata(account, query, 120)) seen.set(message.id,message);
        }
        messages += seen.size;
        for (const message of seen.values()) {
          const next = statusFrom(message.subject);
          if (!next) continue;
          const endeavor = endeavors.find((item) => item.status !== next && matches(message,item));
          if (!endeavor) continue;
          const evidenceUrl = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(account)}#all/${message.threadId}`;
          if (insertSuggestion({
            dedupeKey:`gmail:${account}:${message.id}:${next}`, type:"status_change", endeavorId:endeavor.id, proposed:{status:next}, evidenceType:"gmail",
            evidenceUrl, gmailAccount:account, gmailMessageId:message.id, subject:message.subject, excerpt:`From ${message.from}${message.internalDate ? ` · ${message.internalDate}` : ""}`,
          })) proposed++;
        }
      } catch { accountFailures++; }
    }
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"gmail_scan", status:"running", level:accountFailures?"warn":"info", summary:`Scanned ${accounts.length-accountFailures}/${accounts.length} approved Gmail account(s), ${messages} real message id(s), proposed ${proposed} status change(s)`, detail:JSON.stringify({accounts:accounts.length,accountFailures,messages,proposed}) });
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"completed", status:"completed", level:accountFailures?"warn":"success", summary:`Career Gmail scan complete: ${proposed} suggestion(s), ${accountFailures} account connection issue(s)` });
    return { accounts:accounts.length, accountFailures, messages, proposed };
  } catch (error) {
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"failed", status:"failed", level:"error", summary:`Career Gmail scan failed: ${error instanceof Error ? error.message.slice(0,320) : "unknown error"}` });
    throw error;
  }
}

function htmlText(html:string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&(?:amp|nbsp|quot|#39);/g," ").replace(/\s+/g," ").trim();
}
function titleOf(html:string, fallback:string) {
  const match = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return (match?.[1] || fallback).replace(/\s+/g," ").trim().slice(0,220);
}
function evidenceExcerpt(text:string) {
  const match = /applications? (?:are )?open|apply now|registration (?:is )?open|upcoming events?|deadline/ig.exec(text);
  if (!match) return "";
  return text.slice(Math.max(0,match.index-120), Math.min(text.length,match.index+360));
}
async function fetchPage(url:string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url,{ signal:controller.signal, redirect:"follow", headers:{"user-agent":"rathworkspace-career-scout/1.0 (+private review-only opportunity monitor)"} });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = (await response.text()).slice(0,1_500_000);
    return { html, finalUrl:response.url || url };
  } finally { clearTimeout(timer); }
}

export async function runCareerOpportunityHunter() {
  const runId = `career-hunt-${stamp()}`;
  recordAgentEvent({ agent:"career-scout", run:runId, kind:"started", status:"running", summary:"Career opportunity watchlist scan started", triggerType:"scheduler", triggerSource:"rathworkspace scheduler" });
  try {
    const db = getDb();
    const watch = db.prepare("SELECT label,url,category FROM career_watchlist WHERE enabled=1 ORDER BY id").all() as any[];
    const existing = db.prepare("SELECT title,organization,primary_url FROM endeavors").all() as any[];
    let fetched=0, proposed=0, failed=0;
    for (const item of watch) {
      const alreadyTracked = existing.some((e) => {
        const label=norm(item.label), t=norm(`${e.title} ${e.organization}`);
        return (label.length>=4 && t.includes(label)) || (!!domain(item.url) && domain(e.primary_url) === domain(item.url));
      });
      if (alreadyTracked) continue;
      try {
        const page = await fetchPage(item.url); fetched++;
        const pageTitle = titleOf(page.html,item.label);
        const plain = htmlText(page.html);
        const excerpt = evidenceExcerpt(plain);
        if (!excerpt) continue;
        const hash = crypto.createHash("sha256").update(`${page.finalUrl}\n${pageTitle}`).digest("hex").slice(0,24);
        if (insertSuggestion({
          dedupeKey:`web:${hash}`, type:"new_endeavor", proposed:{ title:pageTitle, organization:item.label, category:item.category, kind:"application", status:"researching", primary_url:page.finalUrl, urls:[page.finalUrl], notes:`Career Scout found an active application, registration, deadline, or upcoming-event signal on the configured watchlist page. Verify details before applying.\n\nEvidence: ${excerpt}` },
          evidenceType:"web", evidenceUrl:page.finalUrl, subject:pageTitle, excerpt,
        })) proposed++;
      } catch { failed++; }
    }
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"research_complete", status:"running", summary:`Fetched ${fetched} untracked watchlist page(s), proposed ${proposed}, ${failed} fetch failure(s)`, detail:JSON.stringify({watchlist:watch.length,fetched,proposed,failed}) });
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"completed", status:"completed", level:"success", summary:`Career opportunity hunt complete: ${proposed} evidence-backed suggestion(s)` });
    return { watchlist:watch.length, fetched, proposed, failed };
  } catch (error) {
    recordAgentEvent({ agent:"career-scout", run:runId, kind:"failed", status:"failed", level:"error", summary:`Career opportunity hunt failed: ${error instanceof Error ? error.message.slice(0,320) : "unknown error"}` });
    throw error;
  }
}
