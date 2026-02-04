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

  it("logs at info level with status code", () => {
    successResponse({ foo: "bar" });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200 }),
      expect.any(String),
    );
  });

  it("logs with custom status code", () => {
    successResponse({ created: true }, 201);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ status: 201 }),
      expect.any(String),
    );
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

  it("logs at warn level for 4xx errors", () => {
    errorResponse("AUTH_MISSING_SESSION", "Not authenticated", 401);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        errorCode: "AUTH_MISSING_SESSION",
        errorMessage: "Not authenticated",
      }),
      expect.any(String),
    );
  });

  it("logs at error level for 5xx errors", () => {
    errorResponse("CLAUDE_API_ERROR", "Internal error", 500);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        errorCode: "CLAUDE_API_ERROR",
        errorMessage: "Internal error",
      }),
      expect.any(String),
    );
  });

  it("does not include details in log output", () => {
    errorResponse("VALIDATION_ERROR", "Bad input", 400, {
      secret: "token123",
    });
    const logCall = vi.mocked(logger.warn).mock.calls[0];
    const logData = logCall[0] as Record<string, unknown>;
    expect(logData).not.toHaveProperty("details");
    expect(logData).not.toHaveProperty("secret");
  });
});
