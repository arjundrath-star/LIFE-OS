import { VendingIntegrationError } from "./types";

/** Small RFC 4180 parser supporting BOM, quoted commas, escaped quotes, and newlines. */
export function parseCsv(bytes: Buffer): string[][] {
  let value = bytes.toString("utf8");
  if (value.charCodeAt(0) === 0xfeff) value = value.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) {
      if (char === '"') {
        if (value[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && value[index + 1] === "\n") index++;
      row.push(field); field = ""; rows.push(row); row = [];
    } else field += char;
  }
  if (quoted) throw new VendingIntegrationError("INVALID_CSV", "VTM CSV contains an unclosed quoted field");
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((fields) => fields.some((item) => item.trim()));
}

export function canonicalLabel(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}
