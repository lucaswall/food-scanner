import { describe, it, expect } from "vitest";
import { successResponse, errorResponse } from "@/lib/api-response";

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
});

describe("errorResponse", () => {
  it("returns success false with error code and message", async () => {
    const response = errorResponse("AUTH_MISSING_SESSION", "Not authenticated", 401);
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
});
