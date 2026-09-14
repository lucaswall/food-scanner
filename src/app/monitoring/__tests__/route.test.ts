import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
  createRequestLogger: vi.fn(() => mockLogger),
}));

const forwardSentryEnvelope = vi.fn();
vi.mock("@/lib/sentry-tunnel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sentry-tunnel")>()),
  forwardSentryEnvelope,
  // Small cap so oversized bodies are cheap to build
  MAX_ENVELOPE_BYTES: 64,
}));

const { POST } = await import("@/app/monitoring/route");

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function streamingRequest(body: ReadableStream<Uint8Array>, headers?: Record<string, string>): Request {
  return new Request("http://localhost/monitoring", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
}

describe("POST /monitoring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    forwardSentryEnvelope.mockResolvedValue(new Response(null, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("forwards the raw request body with the configured DSN and returns the tunnel response", async () => {
    const payload = '{"dsn":"x"}\n{"type":"event"}\n{}';

    const response = await POST(streamingRequest(streamOf(payload.slice(0, 10), payload.slice(10))));

    expect(response.status).toBe(200);
    expect(forwardSentryEnvelope).toHaveBeenCalledTimes(1);
    const [body, dsn, log] = forwardSentryEnvelope.mock.calls[0];
    expect(new TextDecoder().decode(body)).toBe(payload);
    expect(dsn).toBe(DSN);
    expect(log).toBe(mockLogger);
  });

  it("rejects a declared Content-Length over the cap without reading the body", async () => {
    const response = await POST(streamingRequest(streamOf("{}"), { "content-length": "65" }));

    expect(response.status).toBe(413);
    expect(forwardSentryEnvelope).not.toHaveBeenCalled();
  });

  it("rejects an oversized body sent without Content-Length (chunked) while streaming", async () => {
    const response = await POST(streamingRequest(streamOf("x".repeat(40), "x".repeat(40))));

    expect(response.status).toBe(413);
    expect(forwardSentryEnvelope).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body stream fails", async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("client aborted"));
      },
    });

    const response = await POST(streamingRequest(failing));

    expect(response.status).toBe(400);
    expect(forwardSentryEnvelope).not.toHaveBeenCalled();
  });
});
