import { NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireUser } from "@/lib/guard";
import { importCarddistroCsv } from "@/lib/pokemon-ops/import-observations";
import { importBulkLotsCsv, importBulkSalesCsv } from "@/lib/pokemon-ops/importers";

export const dynamic = "force-dynamic";

const KINDS = ["carddistro", "observations", "lots", "sales"] as const;

/**
 * CSV upload from the dashboard. multipart/form-data: kind + file. Writes the
 * upload to a throwaway temp dir (original filename preserved so import
 * receipts read cleanly) and calls the SAME importer cores the CLI
 * (scripts/pokemon-ops-import.ts) and Phase 1 seed use — identical idempotency
 * (sha256 file-fingerprint receipt gate), no parallel code path.
 */
export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 });
  }

  const kind = form.get("kind");
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `kind must be one of ${KINDS.join(", ")}` }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokemon-ops-import-"));
  const safeName = path.basename(file.name || `${kind}.csv`) || `${kind}.csv`;
  const tmpPath = path.join(tmpDir, safeName);
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(tmpPath, buf);

    let result: unknown;
    switch (kind) {
      case "carddistro":
      case "observations":
        result = importCarddistroCsv(tmpPath);
        break;
      case "lots":
        result = importBulkLotsCsv(tmpPath);
        break;
      case "sales":
        result = importBulkSalesCsv(tmpPath);
        break;
    }
    return NextResponse.json({ ok: true, kind, result });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "import failed" }, { status: 400 });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}
