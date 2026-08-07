#!/usr/bin/env -S tsx
import fs from "node:fs";
import path from "node:path";
import { getDb, nowIso } from "@/db";

const ROOT = process.env.CAREER_SEED_ROOT || "/home/Arjun/.openclaw/workspace/applications/fall-2026";
const PROGRAMS = path.join(ROOT, "programs.json");
const DRAFTS = path.join(ROOT, "drafts");

type Program = {
  name: string;
  display_name?: string;
  track: "individual" | "klade" | "nyu";
  deadline?: string;
  deadline_display?: string;
  url?: string;
  fit_note?: string;
  notes?: string;
  status?: string;
};

function norm(value: string) {
  return value.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

function draftPrograms(): string[] {
  if (!fs.existsSync(DRAFTS)) return [];
  return fs.readdirSync(DRAFTS).filter((f) => f.endsWith(".md")).flatMap((file) => {
    const head = fs.readFileSync(path.join(DRAFTS, file), "utf8").slice(0, 2000);
    const match = head.match(/^program:\s*(.+)$/m);
    return match ? [norm(match[1].trim())] : [];
  });
}

function hasDraft(name: string, drafts: string[]) {
  const n = norm(name);
  return drafts.some((d) => d === n || d.includes(n) || n.includes(d) || (n.includes("dorm room fund") && d.includes("dorm room fund")));
}

function deadline(value?: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function folderUrl(track: Program["track"]) {
  const ids = {
    klade: "1egz5NOTpgLwb1-hypHnZMjVYxnMdMrY4",
    individual: "1XZeXe7NOAQ-E5XhdYZP22fZ_wfcFgHgI",
    nyu: "1hbRM2IuVmn0T502fWftOzNh4vko8QOo0",
  };
  return `https://drive.google.com/drive/folders/${ids[track]}`;
}

function main() {
  if (!fs.existsSync(PROGRAMS)) throw new Error(`career seed source missing: ${PROGRAMS}`);
  const parsed = JSON.parse(fs.readFileSync(PROGRAMS, "utf8"));
  const programs = parsed.programs as Program[];
  if (!Array.isArray(programs) || programs.length !== 38) throw new Error(`expected 38 programs, found ${programs?.length ?? "invalid"}`);
  const drafts = draftPrograms();
  const db = getDb();
  const ts = nowIso();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO endeavors
      (dedupe_key,title,organization,category,kind,status,deadline,primary_url,urls_json,notes,source,created_at,updated_at)
    VALUES
      (@dedupe_key,@title,@organization,@category,'application',@status,@deadline,@primary_url,@urls_json,@notes,'seed',@ts,@ts)
  `);
  const insertEvent = db.prepare(`
    INSERT INTO endeavor_events (endeavor_id,event_type,summary,detail,source,occurred_at)
    SELECT id,'created','Imported from Fall 2026 application sprint',@detail,'seed',@ts
      FROM endeavors WHERE dedupe_key=@dedupe_key
       AND NOT EXISTS (SELECT 1 FROM endeavor_events WHERE endeavor_id=endeavors.id AND source='seed' AND event_type='created')
  `);
  const tx = db.transaction(() => {
    for (const p of programs) {
      const category = p.track === "klade" ? "klade" : p.track === "nyu" ? "community" : "work";
      const drafted = hasDraft(p.name, drafts);
      const links = [p.url || "", ...(drafted ? [folderUrl(p.track)] : [])].filter(Boolean);
      const row = {
        dedupe_key: `fall-2026:${p.track}:${norm(p.name).replaceAll(" ", "-")}`,
        title: p.display_name || p.name,
        organization: (p.display_name || p.name).split(/[:–—-]/)[0].trim(),
        category,
        status: drafted ? "drafting" : "researching",
        deadline: deadline(p.deadline),
        primary_url: p.url || "",
        urls_json: JSON.stringify(links),
        notes: [p.fit_note, p.notes, p.deadline_display && !deadline(p.deadline) ? `Deadline: ${p.deadline_display}` : ""].filter(Boolean).join("\n\n"),
        ts,
      };
      insert.run(row);
      insertEvent.run({ dedupe_key: row.dedupe_key, detail: `Track ${p.track}; draft ${drafted ? "available" : "not yet available"}`, ts });
    }

    const submitted = ["Y Combinator", "Endless Frontier Labs", "South Park Commons"];
    for (const title of submitted) {
      const key = `submitted-klade:${norm(title).replaceAll(" ", "-")}`;
      insert.run({ dedupe_key:key, title, organization:title, category:"klade", status:"submitted", deadline:"", primary_url:"", urls_json:"[]", notes:"Already submitted before the Career tab import.", ts });
      insertEvent.run({ dedupe_key:key, detail:"Imported as already submitted", ts });
    }

    const engagements = [
      { key:"engagement:klade", title:"Klade", org:"Klade", category:"klade", status:"active", notes:"Founder and company operating context." },
      { key:"engagement:summer-2026-internship", title:"Summer 2026 internship", org:"", category:"work", status:"ended", notes:"Ended around late August 2026. Rename with the exact employer." },
      { key:"engagement:nyu-stern-sophomore", title:"NYU Stern sophomore", org:"New York University", category:"community", status:"active", notes:"Non-academic community and professional context beginning September 2026. Coursework remains in School." },
    ];
    const addEngagement = db.prepare(`INSERT OR IGNORE INTO endeavors
      (dedupe_key,title,organization,category,kind,status,notes,source,created_at,updated_at)
      VALUES (@key,@title,@org,@category,'engagement',@status,@notes,'seed',@ts,@ts)`);
    for (const item of engagements) {
      addEngagement.run({ ...item, ts });
      insertEvent.run({ dedupe_key:item.key, detail:"Seed engagement", ts });
    }
  });
  tx.immediate();

  const counts = db.prepare(`SELECT COUNT(*) total, SUM(kind='application') applications, SUM(kind='engagement') engagements, SUM(status='drafting') drafting, SUM(status='submitted') submitted FROM endeavors`).get();
  process.stdout.write(JSON.stringify({ sourcePrograms: programs.length, draftFiles: drafts.length, counts }) + "\n");
}

main();
