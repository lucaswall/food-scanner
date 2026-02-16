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

import { successResponse, errorResponse } from "@/lib/api-response";
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
