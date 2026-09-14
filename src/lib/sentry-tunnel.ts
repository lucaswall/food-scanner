import type { Logger } from "@/lib/logger";

/** Upper bound for one tunneled envelope — browser errors, spans and replay segments are far smaller. */
export const MAX_ENVELOPE_BYTES = 10 * 1024 * 1024;

const UPSTREAM_TIMEOUT_MS = 10_000;

/** Response headers the browser SDK uses to back off when Sentry rate-limits the project. */
const FORWARDED_RESPONSE_HEADERS = ["retry-after", "x-sentry-rate-limits"];

interface ParsedDsn {
  host: string;
  projectId: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.split("/").filter(Boolean).pop();
    if (!url.username || !projectId) return null;
    return { host: url.host, projectId, publicKey: url.username };
  } catch {
    return null;
  }
}

/** Reads the `dsn` from the envelope header (first line). Items after it may be binary. */
function readEnvelopeDsn(body: Uint8Array): string | null {
  const newline = body.indexOf(0x0a);
  const headerBytes = newline === -1 ? body : body.subarray(0, newline);
  try {
    const header: unknown = JSON.parse(new TextDecoder().decode(headerBytes));
    if (header && typeof header === "object" && "dsn" in header && typeof header.dsn === "string") {
      return header.dsn;
    }
  } catch {
    // Not a JSON header — rejected below
  }
  return null;
}

/**
 * Forwards a browser Sentry envelope to the ingest endpoint of the configured project.
 * Envelopes addressed to any other host or project are rejected, so the public tunnel can't be
 * used as an open proxy. Served by an app route instead of a Next.js rewrite: Next 16.3's rewrite
 * proxy adds 11 `close` listeners per response and logs MaxListenersExceededWarning (FOO-1180).
 */
export async function forwardSentryEnvelope(
  body: Uint8Array<ArrayBuffer>,
  configuredDsn: string | undefined,
  log: Logger,
): Promise<Response> {
  const target = configuredDsn ? parseDsn(configuredDsn) : null;
  if (!target) {
    return new Response(null, { status: 404 });
  }

  if (body.byteLength > MAX_ENVELOPE_BYTES) {
    log.warn(
      { action: "sentry_tunnel_rejected", reason: "too_large", bytes: body.byteLength },
      "sentry tunnel envelope too large",
    );
    return new Response(null, { status: 413 });
  }

  const envelopeDsn = readEnvelopeDsn(body);
  if (!envelopeDsn) {
    log.warn({ action: "sentry_tunnel_rejected", reason: "invalid_header" }, "sentry tunnel envelope has no valid dsn header");
    return new Response(null, { status: 400 });
  }

  const requested = parseDsn(envelopeDsn);
  if (!requested || requested.host !== target.host || requested.projectId !== target.projectId) {
    log.warn(
      { action: "sentry_tunnel_rejected", reason: "dsn_mismatch", host: requested?.host ?? null },
      "sentry tunnel envelope addressed to another project",
    );
    return new Response(null, { status: 400 });
  }

  // sentry_key marks the request as Sentry traffic, so the server SDK doesn't trace or breadcrumb it
  const query = new URLSearchParams({ sentry_key: target.publicKey, sentry_version: "7" });
  const url = `https://${target.host}/api/${target.projectId}/envelope/?${query}`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-sentry-envelope" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    await upstream.body?.cancel();

    const headers = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return new Response(null, { status: upstream.status, headers });
  } catch (error) {
    log.warn(
      { action: "sentry_tunnel_upstream_error", error: error instanceof Error ? error.message : String(error) },
      "sentry tunnel could not reach Sentry",
    );
    return new Response(null, { status: 502 });
  }
}
