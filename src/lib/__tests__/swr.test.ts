import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetcher } from "@/lib/swr";

beforeEach(() => {
  vi.restoreAllMocks();
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
});
