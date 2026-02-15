import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetcher, ApiError, invalidateFoodCaches } from "@/lib/swr";

// Mock SWR at the top level using vi.hoisted()
const { mockMutate } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
}));

vi.mock("swr", () => ({
  mutate: mockMutate,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockMutate.mockClear();
});

describe("apiFetcher", () => {
  it("returns data on successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ success: true, data: { foods: ["apple"] } }),
    );

    const result = await apiFetcher("/api/common-foods");
    expect(result).toEqual({ foods: ["apple"] });
    expect(fetch).toHaveBeenCalledWith("/api/common-foods");
  });

  it("throws on HTTP error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Unauthorized" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(apiFetcher("/api/test")).rejects.toThrow("Unauthorized");
  });

  it("throws generic message on HTTP error with no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", { status: 500 }),
    );

    await expect(apiFetcher("/api/test")).rejects.toThrow("HTTP 500");
  });

  it("throws on success: false response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: false,
        error: { code: "SOME_ERROR", message: "Something went wrong" },
      }),
    );

    await expect(apiFetcher("/api/test")).rejects.toThrow("Something went wrong");
  });

  it("throws generic message on success: false with no error details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ success: false }),
    );

    await expect(apiFetcher("/api/test")).rejects.toThrow("Failed to load");
  });

  it("throws on network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiFetcher("/api/test")).rejects.toThrow("Failed to fetch");
  });

  // FOO-427: SWR error code preservation
  it("preserves error code from API response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: false,
        error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
      }),
    );

    try {
      await apiFetcher("/api/test");
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("FITBIT_TOKEN_INVALID");
      expect((error as ApiError).message).toBe("Token expired");
    }
  });

  it("preserves error code from HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Credentials not found" },
        }),
        {
          status: 424,
          headers: { "Content-Type": "application/json" },
        }
      ),
    );

    try {
      await apiFetcher("/api/test");
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("FITBIT_CREDENTIALS_MISSING");
      expect((error as ApiError).message).toBe("Credentials not found");
    }
  });

  it("uses UNKNOWN_ERROR code when no code provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        success: false,
        error: { message: "Something went wrong" },
      }),
    );

    try {
      await apiFetcher("/api/test");
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("UNKNOWN_ERROR");
      expect((error as ApiError).message).toBe("Something went wrong");
    }
  });
});

// FOO-498: SWR Cache Invalidation
describe("invalidateFoodCaches", () => {
  it("calls SWR mutate with a matcher function", async () => {
    await invalidateFoodCaches();

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate).toHaveBeenCalledWith(expect.any(Function));
  });

  it("matcher function matches food-related API keys", async () => {
    mockMutate.mockImplementation((fn) => {
      // Extract the matcher function and test it
      const matcherFn = fn as (key: unknown) => boolean;

      // Should match food-related keys
      expect(matcherFn("/api/nutrition-summary")).toBe(true);
      expect(matcherFn("/api/nutrition-summary?date=2024-01-01")).toBe(true);
      expect(matcherFn("/api/food-history")).toBe(true);
      expect(matcherFn("/api/food-history?limit=20")).toBe(true);
      expect(matcherFn("/api/common-foods")).toBe(true);
      expect(matcherFn("/api/fasting")).toBe(true);
      expect(matcherFn("/api/earliest-entry")).toBe(true);
    });

    await invalidateFoodCaches();

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("matcher function does NOT match unrelated API keys", async () => {
    mockMutate.mockImplementation((fn) => {
      const matcherFn = fn as (key: unknown) => boolean;

      // Should NOT match unrelated keys
      expect(matcherFn("/api/settings")).toBe(false);
      expect(matcherFn("/api/auth/user")).toBe(false);
      expect(matcherFn("/api/other")).toBe(false);
    });

    await invalidateFoodCaches();

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("matcher function handles non-string keys", async () => {
    mockMutate.mockImplementation((fn) => {
      const matcherFn = fn as (key: unknown) => boolean;

      // Should return false for non-string keys
      expect(matcherFn(null)).toBe(false);
      expect(matcherFn(undefined)).toBe(false);
      expect(matcherFn(123)).toBe(false);
      expect(matcherFn({})).toBe(false);
    });

    await invalidateFoodCaches();

    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
