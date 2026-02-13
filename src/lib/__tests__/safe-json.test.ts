import { describe, it, expect } from "vitest";
import { safeResponseJson } from "../safe-json";

describe("safeResponseJson", () => {
  it("returns parsed JSON when response has valid JSON body", async () => {
    const mockResponse = new Response(JSON.stringify({ success: true, data: "test" }), {
      headers: { "content-type": "application/json" },
    });

    const result = await safeResponseJson(mockResponse);
    expect(result).toEqual({ success: true, data: "test" });
  });

  it("returns fallback error response when body is HTML starting with <!DOCTYPE", async () => {
    const mockResponse = new Response("<!DOCTYPE html><html><body>Error</body></html>");

    const result = await safeResponseJson(mockResponse);
    expect(result).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Server returned an unexpected response. Please try again.",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns fallback error response when body is HTML starting with <html", async () => {
    const mockResponse = new Response("<html><body>Error page</body></html>");

    const result = await safeResponseJson(mockResponse);
    expect(result).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Server returned an unexpected response. Please try again.",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns fallback error response when JSON.parse() throws for non-JSON content", async () => {
    const mockResponse = new Response("This is plain text, not JSON");

    const result = await safeResponseJson(mockResponse);
    expect(result).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Server returned an unexpected response. Please try again.",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns parsed JSON even when content-type header is missing", async () => {
    const mockResponse = new Response(JSON.stringify({ success: true, value: 42 }));

    const result = await safeResponseJson(mockResponse);
    expect(result).toEqual({ success: true, value: 42 });
  });
});
