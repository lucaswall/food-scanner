import { createRequestLogger } from "@/lib/logger";
import { forwardSentryEnvelope, MAX_ENVELOPE_BYTES, readLimitedBody } from "@/lib/sentry-tunnel";

/**
 * Same-origin Sentry tunnel for the browser SDK (`tunnel: "/monitoring"` in instrumentation-client.ts).
 * Public route: forwardSentryEnvelope only accepts envelopes for NEXT_PUBLIC_SENTRY_DSN's project.
 */
export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/monitoring");

  // Fast path; the streaming cap below also covers bodies sent without Content-Length
  if (Number(request.headers.get("content-length")) > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: Uint8Array<ArrayBuffer> | null;
  try {
    body = await readLimitedBody(request.body, MAX_ENVELOPE_BYTES);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!body) {
    log.warn({ action: "sentry_tunnel_rejected", reason: "too_large" }, "sentry tunnel envelope too large");
    return new Response(null, { status: 413 });
  }

  return forwardSentryEnvelope(body, process.env.NEXT_PUBLIC_SENTRY_DSN, log);
}
