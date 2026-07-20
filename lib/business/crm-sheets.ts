import fs from "node:fs";
import path from "node:path";
import { secret } from "@/lib/secrets";

export const CRM_SOURCE_IDS = [
  "pokemon-crm", "pokemon-active", "pokemon-pipeline",
  "portable-pipeline", "portable-active", "misc-leads",
] as const;
export type CrmSourceId = (typeof CRM_SOURCE_IDS)[number];

export type CrmSheetRow = {
  id: string; venue: string; category: string; cityRegion: string; contact: string;
  status: string; lastTouch: string; nextAction: string; notesSummary: string;
  details: Record<string, string>;
};
export type CrmSheetSource = {
  id: CrmSourceId; label: string; editable: boolean; available: boolean;
  freshness: string | null; count: number | null; error: string | null;
};
export type CrmSheetResult = CrmSheetSource & { fields: Array<{ key: keyof CrmSheetRow; label: string }>; rows: CrmSheetRow[]; total: number; limit: number; offset: number };

const CSV_SOURCES: Record<Exclude<CrmSourceId, "pokemon-crm" | "misc-leads">, { label: string; file: string }> = {
  "pokemon-active": { label: "Pokemon Active Leads", file: "/home/Arjun/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Active_Leads.csv" },
  "pokemon-pipeline": { label: "Pokemon Pipeline", file: "/home/Arjun/command-center/Pokemon Machines/pokemon vending/Pokemon_Vending_Lead_Pipeline.csv" },
  "portable-pipeline": { label: "Portable Charging Pipeline", file: "/home/Arjun/command-center/Portable Charging/Leads/RVH_Charging_Lead_Pipeline.csv" },
  "portable-active": { label: "Portable Charging Active Leads", file: "/home/Arjun/command-center/Portable Charging/Leads/Active Leads.csv" },
};
const FIELDS: CrmSheetResult["fields"] = [
  { key: "venue", label: "Venue" }, { key: "category", label: "Category" },
  { key: "cityRegion", label: "City / region" }, { key: "contact", label: "Contact" },
  { key: "status", label: "Status / stage" }, { key: "lastTouch", label: "Last touch" },
  { key: "nextAction", label: "Next action" }, { key: "notesSummary", label: "Notes" },
];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

const first = (r: Record<string, string>, ...keys: string[]) => keys.map(k => r[k]?.trim()).find(Boolean) || "";
const summary = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, 240);
export function normalizeCrmCsv(text: string): CrmSheetRow[] {
  const parsed = parseCsv(text); if (parsed.length < 2) return [];
  const headers = parsed[0].map(h => h.replace(/^\uFEFF/, "").trim());
  return parsed.slice(1).map((cells, index) => {
    const r = Object.fromEntries(headers.map((h, i) => [h, cells[i] || ""]));
    const name = first(r, "Venue", "Name", "Business");
    const person = first(r, "Decision-maker name", "Owner name candidate", "Owner/operator status");
    const role = first(r, "Decision-maker role", "Owner title/role");
    const phone = first(r, "Phone", "Public contact phone", "Owner phone");
    const email = first(r, "Email", "Owner email", "Public contact email");
    const notes = first(r, "Owner notes", "Notes", "Email Enrichment Notes");
    return {
      id: first(r, "Lead ID") || `${index + 1}`,
      venue: name || "Unnamed row", category: first(r, "Category", "Type"),
      cityRegion: [first(r, "City"), first(r, "State"), first(r, "Region")].filter(Boolean).join(" · "),
      contact: [[person, role].filter(Boolean).join(" — "), phone, email].filter(Boolean).join(" · "),
      status: first(r, "Active Outreach Status", "Status", "Status (New)", "Email first status", "Active Lead"),
      lastTouch: [first(r, "Last touch method"), first(r, "Last touch at")].filter(Boolean).join(" · "),
      nextAction: first(r, "Next action", "Suggested first move"), notesSummary: summary(notes),
      details: Object.fromEntries(Object.entries(r).filter(([,v]) => v.trim()).slice(0, 24).map(([k,v]) => [k, summary(v)])),
    };
  }).filter(r => r.venue !== "Unnamed row" || Object.keys(r.details).length);
}

function csvSource(id: keyof typeof CSV_SOURCES): CrmSheetSource {
  const def = CSV_SOURCES[id];
  try { const st = fs.statSync(def.file); return { id, label: def.label, editable: false, available: true, freshness: st.mtime.toISOString(), count: normalizeCrmCsv(fs.readFileSync(def.file, "utf8")).length, error: null }; }
  catch { return { id, label: def.label, editable: false, available: false, freshness: null, count: null, error: "Source file is unavailable on the server." }; }
}

async function googleRows(): Promise<{ rows: CrmSheetRow[]; freshness: string | null }> {
  const cache = secret("MISC_LEADS_CACHE_PATH");
  const sheetId = secret("GOOGLE_SHEETS_MISC_LEADS_SPREADSHEET_ID") || secret("GOOGLE_SHEETS_CRM_SPREADSHEET_ID");
  const range = secret("GOOGLE_SHEETS_MISC_LEADS_RANGE") || "Miscellaneous Leads!A1:Z1000";
  if (sheetId) {
    try {
      const tokenPath = "/home/Arjun/.hermes/google_token.json";
      const tokenJson = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const token = tokenJson.access_token || tokenJson.token;
      if (token) {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;
        const res = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal }); clearTimeout(timer);
        if (res.ok) { const body = await res.json() as { values?: string[][] }; return { rows: normalizeCrmCsv((body.values || []).map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")), freshness: new Date().toISOString() }; }
      }
    } catch { /* cache fallback below */ }
  }
  if (cache) { const resolved = path.resolve(cache); const st = fs.statSync(resolved); return { rows: normalizeCrmCsv(fs.readFileSync(resolved, "utf8")), freshness: st.mtime.toISOString() }; }
  throw new Error(sheetId ? "Google Sheet authorization is unavailable or expired; reconnect Google or configure the cache." : "Configure a Miscellaneous Leads spreadsheet ID or server cache path.");
}

export async function listCrmSources(): Promise<CrmSheetSource[]> {
  const csv = Object.keys(CSV_SOURCES).map(id => csvSource(id as keyof typeof CSV_SOURCES));
  let misc: CrmSheetSource = { id: "misc-leads", label: "Miscellaneous Leads", editable: false, available: false, freshness: null, count: null, error: "Integration not checked." };
  try { const data = await googleRows(); misc = { ...misc, available: true, freshness: data.freshness, count: data.rows.length, error: null }; } catch (e) { misc.error = e instanceof Error ? e.message : "Google Sheet unavailable."; }
  return [{ id: "pokemon-crm", label: "Pokemon CRM", editable: true, available: true, freshness: null, count: null, error: null }, ...csv, misc];
}

export async function readCrmSource(id: CrmSourceId, limit = 200, offset = 0): Promise<CrmSheetResult> {
  if (id === "pokemon-crm") return { id, label: "Pokemon CRM", editable: true, available: true, freshness: null, count: null, error: null, fields: FIELDS, rows: [], total: 0, limit, offset };
  try {
    let rows: CrmSheetRow[]; let freshness: string | null;
    if (id === "misc-leads") ({ rows, freshness } = await googleRows());
    else { const def = CSV_SOURCES[id]; const st = fs.statSync(def.file); freshness = st.mtime.toISOString(); rows = normalizeCrmCsv(fs.readFileSync(def.file, "utf8")); }
    return { id, label: id === "misc-leads" ? "Miscellaneous Leads" : CSV_SOURCES[id as keyof typeof CSV_SOURCES].label, editable: false, available: true, freshness, count: rows.length, error: null, fields: FIELDS, rows: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  } catch (e) { const label = id === "misc-leads" ? "Miscellaneous Leads" : CSV_SOURCES[id as keyof typeof CSV_SOURCES].label; return { id, label, editable: false, available: false, freshness: null, count: null, error: e instanceof Error ? e.message : "Source unavailable.", fields: FIELDS, rows: [], total: 0, limit, offset }; }
}
