import fs from "node:fs";
import os from "node:os";
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

// CSV exports live outside the repo on the server. CRM_DATA_DIR sets the root
// (default: <repo>/data/crm); each source can also be pointed at an exact file
// with its own env var, which wins over the root + documented filename.
const CRM_DATA_DIR = process.env.CRM_DATA_DIR || path.join(process.cwd(), "data", "crm");
const csvFile = (envVar: string, filename: string) =>
  process.env[envVar] || path.join(CRM_DATA_DIR, filename);
const CSV_SOURCES: Record<Exclude<CrmSourceId, "pokemon-crm" | "misc-leads">, { label: string; file: string }> = {
  "pokemon-active": { label: "Pokemon Active Leads", file: csvFile("CRM_CSV_POKEMON_ACTIVE", "pokemon-active-leads.csv") },
  "pokemon-pipeline": { label: "Pokemon Pipeline", file: csvFile("CRM_CSV_POKEMON_PIPELINE", "pokemon-lead-pipeline.csv") },
  "portable-pipeline": { label: "Portable Charging Pipeline", file: csvFile("CRM_CSV_PORTABLE_PIPELINE", "portable-lead-pipeline.csv") },
  "portable-active": { label: "Portable Charging Active Leads", file: csvFile("CRM_CSV_PORTABLE_ACTIVE", "portable-active-leads.csv") },
};
const FIELDS: CrmSheetResult["fields"] = [
  { key: "venue", label: "Venue" }, { key: "category", label: "Category" },
  { key: "cityRegion", label: "City / region" }, { key: "contact", label: "Contact" },
  { key: "status", label: "Status / stage" }, { key: "lastTouch", label: "Last touch" },
  { key: "nextAction", label: "Next action" }, { key: "notesSummary", label: "Notes" },
];

type GoogleToken = { access_token?:string; token?:string; refresh_token?:string; expiry?:string; expiry_date?:number; token_uri?:string; client_id?:string };
type GoogleClientConfig = { installed?:Record<string,unknown>; web?:Record<string,unknown> };
export async function freshGoogleAccessToken(token: GoogleToken, clientConfig: GoogleClientConfig, now = Date.now(), request: typeof fetch = fetch): Promise<string> {
  const current = token.access_token || token.token || "";
  const expiry = token.expiry_date || (token.expiry ? Date.parse(token.expiry) : 0);
  if (current && expiry > now + 60_000) return current;
  const client = (clientConfig.installed || clientConfig.web || {}) as {client_id?:string;client_secret?:string;token_uri?:string};
  const clientId = token.client_id || client.client_id;
  const tokenUri = token.token_uri || client.token_uri || "https://oauth2.googleapis.com/token";
  if (!token.refresh_token || !clientId || !client.client_secret) throw new Error("Google refresh credentials are incomplete.");
  const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),5000);
  try {
    const res = await request(tokenUri,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:client.client_secret,refresh_token:token.refresh_token,grant_type:"refresh_token"}),signal:controller.signal});
    if(!res.ok) throw new Error(`Google token refresh failed (${res.status}).`);
    const body=await res.json() as {access_token?:string}; if(!body.access_token) throw new Error("Google token refresh returned no access token."); return body.access_token;
  } finally { clearTimeout(timer); }
}

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
    const name = first(r, "Venue", "Name", "Business", "Normalized Venue Name", "Raw Venue Name");
    const person = first(r, "Decision-maker name", "Owner name candidate", "Owner/operator status", "Owner / Contact Known?");
    const role = first(r, "Decision-maker role", "Owner title/role");
    const phone = first(r, "Phone", "Public contact phone", "Owner phone");
    const email = first(r, "Email", "Owner email", "Public contact email");
    const notes = [
      first(r, "Owner notes", "Notes", "Email Enrichment Notes", "Fit Hypothesis"),
      first(r, "Why It Caught Attention"),
      first(r, "Processing Notes"),
    ].filter(Boolean).join(" · ");
    return {
      id: first(r, "Lead ID", "Capture ID") || `${index + 1}`,
      venue: name || "Unnamed row", category: first(r, "Category", "Type", "Business Type", "Product Lane Guess"),
      cityRegion: [first(r, "City"), first(r, "State"), first(r, "Region", "Neighborhood / Area", "Route Cluster")].filter(Boolean).join(" · "),
      contact: [[person, role].filter(Boolean).join(" — "), phone, email].filter(Boolean).join(" · "),
      status: first(r, "Active Outreach Status", "Status", "Status (New)", "Email first status", "Active Lead", "Inbox Status", "Route Decision"),
      lastTouch: [first(r, "Last touch method", "Captured By / Source"), first(r, "Last touch at", "Captured Date")].filter(Boolean).join(" · "),
      nextAction: first(r, "Next action", "Suggested first move", "Next Tiny Action", "Verification Needed"), notesSummary: summary(notes),
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
  const range = secret("GOOGLE_SHEETS_MISC_LEADS_RANGE") || "Inbox!A1:Z1000";
  if (sheetId) {
    try {
      // Credential files stay outside the repo; override the defaults via env.
      const credDir = path.join(os.homedir(), ".config", "rathworkspace");
      const tokenPath = process.env.GOOGLE_SHEETS_TOKEN_PATH || path.join(credDir, "google_token.json");
      const clientPath = process.env.GOOGLE_SHEETS_CLIENT_PATH || path.join(credDir, "google_client_secret.json");
      const tokenJson = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const clientJson = JSON.parse(fs.readFileSync(clientPath, "utf8"));
      const token = await freshGoogleAccessToken(tokenJson, clientJson);
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

export function filterCrmRows(rows: CrmSheetRow[], query = ""): CrmSheetRow[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return rows;
  return rows.filter((row) => [row.venue,row.category,row.cityRegion,row.contact,row.status,row.lastTouch,row.nextAction,row.notesSummary,...Object.values(row.details)].join(" ").toLocaleLowerCase().includes(q));
}

export async function readCrmSource(id: CrmSourceId, limit = 100, offset = 0, query = ""): Promise<CrmSheetResult> {
  if (id === "pokemon-crm") return { id, label: "Pokemon CRM", editable: true, available: true, freshness: null, count: null, error: null, fields: FIELDS, rows: [], total: 0, limit, offset };
  try {
    let rows: CrmSheetRow[]; let freshness: string | null;
    if (id === "misc-leads") ({ rows, freshness } = await googleRows());
    else { const def = CSV_SOURCES[id]; const st = fs.statSync(def.file); freshness = st.mtime.toISOString(); rows = normalizeCrmCsv(fs.readFileSync(def.file, "utf8")); }
    const filtered = filterCrmRows(rows, query);
    return { id, label: id === "misc-leads" ? "Miscellaneous Leads" : CSV_SOURCES[id as keyof typeof CSV_SOURCES].label, editable: false, available: true, freshness, count: rows.length, error: null, fields: FIELDS, rows: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
  } catch (e) { const label = id === "misc-leads" ? "Miscellaneous Leads" : CSV_SOURCES[id as keyof typeof CSV_SOURCES].label; return { id, label, editable: false, available: false, freshness: null, count: null, error: e instanceof Error ? e.message : "Source unavailable.", fields: FIELDS, rows: [], total: 0, limit, offset }; }
}
