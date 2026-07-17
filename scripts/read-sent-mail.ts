#!/usr/bin/env -S tsx
// One-off read-only helper: search a connected Google account's Gmail and print
// matching messages (headers + plain-text body). Uses the same encrypted refresh
// tokens as lib/sources/google. Read-only scope; never writes anything.
//
// Usage: tsx scripts/read-sent-mail.ts <account-email> '<gmail-query>' [max]
import { requireSecret } from "@/lib/secrets";
import { decrypt } from "@/lib/crypto";
import { get } from "@/db";

const [account, query, maxStr] = process.argv.slice(2);
if (!account || !query) {
  console.error("usage: read-sent-mail.ts <account-email> '<gmail-query>' [max]");
  process.exit(2);
}
const max = Number(maxStr || 5);

async function accessToken(email: string): Promise<string> {
  const row = get<any>("SELECT refresh_token_enc FROM google_accounts WHERE email=?", email);
  if (!row?.refresh_token_enc) throw new Error(`no refresh token for ${email}`);
  const refresh = decrypt(row.refresh_token_enc);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireSecret("GOOGLE_CLIENT_ID"),
      client_secret: requireSecret("GOOGLE_CLIENT_SECRET"),
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gapi(token: string, url: string): Promise<any> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`gapi ${res.status} ${url}`);
  return res.json();
}

function b64(s: string): string {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function textParts(part: any, out: string[]): void {
  if (part?.mimeType === "text/plain" && part?.body?.data) out.push(b64(part.body.data));
  for (const p of part?.parts ?? []) textParts(p, out);
}

function attachments(part: any, out: string[]): void {
  if (part?.filename) out.push(`${part.filename} (${part.mimeType}, ${part.body?.size}b, id=${part.body?.attachmentId ?? ""})`);
  for (const p of part?.parts ?? []) attachments(p, out);
}

async function main(): Promise<void> {
  const token = await accessToken(account.toLowerCase());
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  const list = await gapi(token, `${base}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`);
  for (const m of list.messages ?? []) {
    const full = await gapi(token, `${base}/messages/${m.id}?format=full`);
    const h = Object.fromEntries(full.payload.headers.map((x: any) => [x.name.toLowerCase(), x.value]));
    console.log(`==== id=${m.id}`);
    for (const k of ["from", "to", "cc", "date", "subject"]) if (h[k]) console.log(`${k}: ${h[k]}`);
    const bodies: string[] = [];
    textParts(full.payload, bodies);
    console.log("---- body ----");
    console.log(bodies.join("\n") || "(no text/plain body)");
    const atts: string[] = [];
    attachments(full.payload, atts);
    if (atts.length) console.log("---- attachments ----\n" + atts.join("\n"));
  }
  if (!list.messages?.length) console.log(`no matches for query: ${query}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
