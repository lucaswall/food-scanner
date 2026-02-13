import type { ApiErrorResponse } from "@/types";

/**
 * Safely parse JSON from a Response object, returning a fallback error
 * when the body is HTML or invalid JSON.
 *
 * @param response - The Response object to parse
 * @returns Parsed JSON or an ApiErrorResponse fallback
 */
export async function safeResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();

  // Check if the response is HTML (common proxy error page)
  if (text.trimStart().startsWith("<!DOCTYPE") || text.trimStart().startsWith("<html")) {
    const fallback: ApiErrorResponse = {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Server returned an unexpected response. Please try again.",
      },
      timestamp: Date.now(),
    };
    return fallback;
  }

  // Try to parse as JSON
  try {
    return JSON.parse(text);
  } catch {
    // Return fallback for any non-JSON content
    const fallback: ApiErrorResponse = {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Server returned an unexpected response. Please try again.",
      },
      timestamp: Date.now(),
    };
    return fallback;
  }
}
