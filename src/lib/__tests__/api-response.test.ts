import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

import { successResponse, errorResponse, conditionalResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("successResponse", () => {
  it("returns success true with data and timestamp", async () => {
    const response = successResponse({ status: "ok" });
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.data).toEqual({ status: "ok" });
    expect(typeof body.timestamp).toBe("number");
  });

  it("defaults to 200 status", () => {
    const response = successResponse({ foo: "bar" });
    expect(response.status).toBe(200);
  });

  it("accepts custom status code", () => {
    const response = successResponse({ created: true }, 201);
    expect(response.status).toBe(201);
  });
});

describe("errorResponse", () => {
  it("returns success false with error code and message", async () => {
    const response = errorResponse(
      "AUTH_MISSING_SESSION",
      "Not authenticated",
      401,
    );
    const body = await response.json();

    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
    expect(body.error.message).toBe("Not authenticated");
    expect(typeof body.timestamp).toBe("number");
  });

  it("uses the provided HTTP status", () => {
    const response = errorResponse("VALIDATION_ERROR", "Invalid input", 400);
    expect(response.status).toBe(400);
  });

  it("does not auto-log for 4xx errors (route handlers own logging)", () => {
    errorResponse("AUTH_MISSING_SESSION", "Not authenticated", 401);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not auto-log for 5xx errors (route handlers own logging)", () => {
    errorResponse("CLAUDE_API_ERROR", "Internal error", 500);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("conditionalResponse", () => {
  function makeRequest(ifNoneMatch?: string): Request {
    const headers: HeadersInit = ifNoneMatch ? { "If-None-Match": ifNoneMatch } : {};
    return new Request("http://localhost:3000/api/v1/test", { headers });
  }

  it("returns 200 with JSON body when no If-None-Match header", async () => {
    const request = makeRequest();
    const response = await conditionalResponse(request, { foo: "bar" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ foo: "bar" });
    expect(typeof body.timestamp).toBe("number");
  });

  it("sets ETag header on 200 responses", async () => {
    const request = makeRequest();
    const response = await conditionalResponse(request, { x: 1 });
    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("sets Cache-Control: private, no-cache on 200 responses", async () => {
    const request = makeRequest();
    const response = await conditionalResponse(request, { x: 1 });
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("sets Content-Type: application/json on 200 responses", async () => {
    const request = makeRequest();
    const response = await conditionalResponse(request, { x: 1 });
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("returns 304 with no body when If-None-Match matches the ETag", async () => {
    const data = { foo: "bar" };
    const firstResponse = await conditionalResponse(makeRequest(), data);
    const etag = firstResponse.headers.get("ETag")!;

    const secondResponse = await conditionalResponse(makeRequest(etag), data);
    expect(secondResponse.status).toBe(304);
    const body = await secondResponse.text();
    expect(body).toBe("");
  });

  it("sets ETag header on 304 responses", async () => {
    const data = { test: 1 };
    const firstResponse = await conditionalResponse(makeRequest(), data);
    const etag = firstResponse.headers.get("ETag")!;

    const secondResponse = await conditionalResponse(makeRequest(etag), data);
    expect(secondResponse.headers.get("ETag")).toBe(etag);
  });

  it("sets Cache-Control: private, no-cache on 304 responses", async () => {
    const data = { test: 1 };
    const firstResponse = await conditionalResponse(makeRequest(), data);
    const etag = firstResponse.headers.get("ETag")!;

    const secondResponse = await conditionalResponse(makeRequest(etag), data);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("does NOT set Content-Type on 304 responses", async () => {
    const data = { test: 1 };
    const firstResponse = await conditionalResponse(makeRequest(), data);
    const etag = firstResponse.headers.get("ETag")!;

    const secondResponse = await conditionalResponse(makeRequest(etag), data);
    expect(secondResponse.headers.get("Content-Type")).toBeNull();
  });

  it("returns 200 with new ETag when If-None-Match does not match", async () => {
    const request = makeRequest('"nonmatchingetag1234"');
    const response = await conditionalResponse(request, { x: 1 });
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
    expect(response.headers.get("ETag")).not.toBe('"nonmatchingetag1234"');
  });

  it("ETag is based on data only, not on timestamp", async () => {
    const data = { stable: "content" };
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    const resp1 = await conditionalResponse(makeRequest(), data);
    const resp2 = await conditionalResponse(makeRequest(), data);
    expect(resp1.headers.get("ETag")).toBe(resp2.headers.get("ETag"));

    vi.restoreAllMocks();
  });

  it("defaults to status 200", async () => {
    const response = await conditionalResponse(makeRequest(), { ok: true });
    expect(response.status).toBe(200);
  });

  it("accepts custom status code", async () => {
    const response = await conditionalResponse(makeRequest(), { created: true }, 201);
    expect(response.status).toBe(201);
  });
});
