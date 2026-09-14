import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
  createRequestLogger: vi.fn(() => mockLogger),
}));

const forwardSentryEnvelope = vi.fn();
vi.mock("@/lib/sentry-tunnel", () => ({
  forwardSentryEnvelope,
  MAX_ENVELOPE_BYTES: 10 * 1024 * 1024,
}));

const { POST } = await import("@/app/monitoring/route");

const DSN = "https://abc123@o111.ingest.us.sentry.io/222";

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
    const payload = `${JSON.stringify({ dsn: DSN })}\n{"type":"event"}\n{}`;
    const request = new Request("http://localhost/monitoring", { method: "POST", body: payload });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(forwardSentryEnvelope).toHaveBeenCalledTimes(1);
    const [body, dsn, log] = forwardSentryEnvelope.mock.calls[0];
    expect(new TextDecoder().decode(body)).toBe(payload);
    expect(dsn).toBe(DSN);
    expect(log).toBe(mockLogger);
  });
});
