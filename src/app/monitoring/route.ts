import { createRequestLogger } from "@/lib/logger";
import { forwardSentryEnvelope, MAX_ENVELOPE_BYTES } from "@/lib/sentry-tunnel";

/**
 * Same-origin Sentry tunnel for the browser SDK (`tunnel: "/monitoring"` in instrumentation-client.ts).
 * Public route: forwardSentryEnvelope only accepts envelopes for NEXT_PUBLIC_SENTRY_DSN's project.
 */
export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/monitoring");

  if (Number(request.headers.get("content-length")) > MAX_ENVELOPE_BYTES) {
    return new Response(null, { status: 413 });
  }

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = new Uint8Array(await request.arrayBuffer());
  } catch {
    return new Response(null, { status: 400 });
  }

  return forwardSentryEnvelope(body, process.env.NEXT_PUBLIC_SENTRY_DSN, log);
}
