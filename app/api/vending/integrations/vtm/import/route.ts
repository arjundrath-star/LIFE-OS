import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { importVtmExport, VendingIntegrationError, VTM_MAX_EXPORT_BYTES } from "@/lib/vending-integrations";
import { readBoundedVtmMultipartRequest } from "@/lib/vending-integrations/vtm-upload";

export const dynamic = "force-dynamic";

function tooLarge(): VendingIntegrationError {
  return new VendingIntegrationError("VTM_EXPORT_TOO_LARGE", "VTM export exceeds the 1 MB limit", 413);
}

function integrationError(error: VendingIntegrationError) {
  const serverFailure = error.status >= 500;
  return NextResponse.json(
    serverFailure
      ? { error: "VTM_IMPORT_FAILED", message: "VTM export import failed" }
      : { error: error.code, message: error.message },
    {
      status: serverFailure ? 500 : error.status,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(req: Request) {
  if (!(await requireUser())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let boundedRequest: Request;
  try {
    boundedRequest = await readBoundedVtmMultipartRequest(req);
  } catch (error) {
    if (error instanceof VendingIntegrationError) return integrationError(error);
    return NextResponse.json(
      { error: "VTM_UPLOAD_FAILED", message: "VTM upload could not be read" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }

  let form: FormData;
  try {
    form = await boundedRequest.formData();
  } catch {
    return NextResponse.json(
      { error: "INVALID_MULTIPART", message: "Expected multipart/form-data" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "VTM_FILE_REQUIRED", message: "VTM Order list .xlsx file is required; user-converted CSV is an optional fallback" },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
  if (file.size > VTM_MAX_EXPORT_BYTES) return integrationError(tooLarge());

  try {
    const imported = await importVtmExport(Buffer.from(await file.arrayBuffer()), {
      filename: file.name,
      contentType: file.type,
    });
    return NextResponse.json(
      { ok: true, result: imported },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof VendingIntegrationError) return integrationError(error);
    return NextResponse.json(
      { error: "VTM_IMPORT_FAILED", message: "VTM export import failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
