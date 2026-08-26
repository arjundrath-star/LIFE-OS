import "./server-only";
import { VTM_MAX_EXPORT_BYTES } from "./vtm";
import { VendingIntegrationError } from "./types";

export const VTM_MULTIPART_OVERHEAD_ALLOWANCE = 64 * 1024;

function tooLarge(): VendingIntegrationError {
  return new VendingIntegrationError("VTM_EXPORT_TOO_LARGE", "VTM export exceeds the 1 MB limit", 413);
}

/**
 * Buffer the multipart envelope with a hard total-request bound before invoking formData().
 * This protects requests that omit or lie about Content-Length as well as declared oversize uploads.
 */
export async function readBoundedVtmMultipartRequest(req: Request): Promise<Request> {
  const requestLimit = VTM_MAX_EXPORT_BYTES + VTM_MULTIPART_OVERHEAD_ALLOWANCE;
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > requestLimit) throw tooLarge();
  }
  if (!req.body) return req;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > requestLimit) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
}
