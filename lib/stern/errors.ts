// Error type carrying an HTTP status, like CareerError. Every Stern domain module and
// route throws this for client-visible failures; unknown errors become 500 at the route.
export class SternError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SternError";
  }
}

export function badRequest(message: string): SternError {
  return new SternError(400, message);
}
export function notFound(message: string): SternError {
  return new SternError(404, message);
}

/** Normalize any thrown value into { status, message } for a route response. */
export function toErrorResponse(error: unknown, fallback = "Stern request failed"): { status: number; message: string } {
  if (error instanceof SternError) return { status: error.status, message: error.message };
  // Unknown errors can carry file paths or SQL text; log them server-side and answer generically.
  console.error("[stern] unexpected error:", error instanceof Error ? error.stack || error.message : String(error));
  return { status: 500, message: fallback };
}
