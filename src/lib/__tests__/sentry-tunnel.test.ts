import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "@/lib/logger";
import { forwardSentryEnvelope, MAX_ENVELOPE_BYTES, readLimitedBody } from "@/lib/sentry-tunnel";

describe("readLimitedBody", () => {
  it("concatenates all chunks when the body fits", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("hello "));
        controller.enqueue(encoder.encode("world"));
        controller.close();
      },
    });

    const body = await readLimitedBody(stream, 11);

    expect(new TextDecoder().decode(body!)).toBe("hello world");
  });

  it("stops reading and cancels the stream once the cap is exceeded", async () => {
    const cancel = vi.fn();
    let pulls = 0;
    // Endless stream: without an early cancel this test would never finish
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(8));
      },
      cancel,
    });

    const body = await readLimitedBody(stream, 20);

    expect(body).toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pulls).toBeLessThanOrEqual(4);
  });

  it("returns an empty body when there is no stream", async () => {
    const body = await readLimitedBody(null, 10);

    expect(body?.byteLength).toBe(0);
  });
});

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function envelope(header: unknown, items = '{"type":"event"}\n{"message":"boom"}'): Uint8Array<ArrayBuffer> {
  const headerLine = typeof header === "string" ? header : JSON.stringify(header);
  return new Uint8Array(new TextEncoder().encode(`${headerLine}\n${items}`));
}

const fetchMock = vi.fn();

describe("forwardSentryEnvelope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the raw envelope to the configured project's ingest endpoint", async () => {
    const body = envelope({ event_id: "e1", dsn: DSN });

    const response = await forwardSentryEnvelope(body, DSN, log);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    // sentry_key marks the request as a Sentry request so the SDK doesn't trace/breadcrumb it
    expect(url).toBe("https://o111.ingest.us.sentry.io/api/222/envelope/?sentry_key=abc123&sentry_version=7");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/x-sentry-envelope" });
    expect(init.body).toBe(body);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("forwards non-UTF-8 payload bytes untouched (compressed replay items)", async () => {
    const header = new TextEncoder().encode(`${JSON.stringify({ dsn: DSN })}\n{"type":"replay_recording","length":4}\n`);
    const binary = new Uint8Array([0x1f, 0x8b, 0xff, 0x00]);
    const body = new Uint8Array(header.length + binary.length);
    body.set(header);
    body.set(binary, header.length);

    await forwardSentryEnvelope(body, DSN, log);

    expect(fetchMock.mock.calls[0][1].body).toBe(body);
  });

  it("passes through upstream status and rate-limit headers so the browser SDK backs off", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "60", "X-Sentry-Rate-Limits": "60:error:organization", "X-Other": "x" },
      }),
    );

    const response = await forwardSentryEnvelope(envelope({ dsn: DSN }), DSN, log);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("X-Sentry-Rate-Limits")).toBe("60:error:organization");
    expect(response.headers.get("X-Other")).toBeNull();
  });

  it("rejects envelopes addressed to a different Sentry host (no open proxy)", async () => {
    const response = await forwardSentryEnvelope(
      envelope({ dsn: "https://abc123@evil.example.com/222" }),
      DSN,
      log,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sentry_tunnel_rejected", reason: "dsn_mismatch" }),
      expect.any(String),
    );
  });

  it("rejects envelopes addressed to a different project", async () => {
    const response = await forwardSentryEnvelope(
      envelope({ dsn: "https://abc123@o111.ingest.us.sentry.io/999" }),
      DSN,
      log,
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["an unparseable header", envelope("not json")],
    ["a header without dsn", envelope({ event_id: "e1" })],
    ["a non-string dsn", envelope({ dsn: 42 })],
    ["an empty body", new Uint8Array()],
  ])("rejects %s", async (_label, body) => {
    const response = await forwardSentryEnvelope(body, DSN, log);

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects envelopes larger than the size cap", async () => {
    const body = new Uint8Array(MAX_ENVELOPE_BYTES + 1);

    const response = await forwardSentryEnvelope(body, DSN, log);

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when no Sentry DSN is configured", async () => {
    const response = await forwardSentryEnvelope(envelope({ dsn: DSN }), undefined, log);

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 and warns when Sentry is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const response = await forwardSentryEnvelope(envelope({ dsn: DSN }), DSN, log);

    expect(response.status).toBe(502);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "sentry_tunnel_upstream_error", error: "fetch failed" }),
      expect.any(String),
    );
  });
});
