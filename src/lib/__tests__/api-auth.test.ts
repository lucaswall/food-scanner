import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockValidateApiKey = vi.fn();
vi.mock("@/lib/api-keys", () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

const { validateApiRequest } = await import("@/lib/api-auth");

describe("validateApiRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns userId for valid Bearer token", async () => {
    mockValidateApiKey.mockResolvedValue({ userId: "user-123" });

    const request = new Request("http://localhost:3000/api/v1/test", {
      headers: { Authorization: "Bearer valid-key-123" },
    });

    const result = await validateApiRequest(request);

    expect(result).toEqual({ userId: "user-123" });
    expect(mockValidateApiKey).toHaveBeenCalledWith("valid-key-123");
  });

  it("returns 401 error when Authorization header is missing", async () => {
    const request = new Request("http://localhost:3000/api/v1/test");

    const result = await validateApiRequest(request);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 error when Authorization header is malformed", async () => {
    const request = new Request("http://localhost:3000/api/v1/test", {
      headers: { Authorization: "InvalidFormat" },
    });

    const result = await validateApiRequest(request);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 error when Bearer token is invalid", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/v1/test", {
      headers: { Authorization: "Bearer invalid-key" },
    });

    const result = await validateApiRequest(request);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 error when Bearer token is revoked", async () => {
    mockValidateApiKey.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/v1/test", {
      headers: { Authorization: "Bearer revoked-key" },
    });

    const result = await validateApiRequest(request);

    expect(result).toBeInstanceOf(Response);
    const response = result as Response;
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });
});
