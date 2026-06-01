import { errorResponse } from "@/lib/api-response";

/**
 * Expected, operational Google Health error codes. These represent transient or
 * user-actionable conditions (token expiry, missing scope, rate limiting, timeouts)
 * that are part of normal operation — callers should log them at `warn`, not `error`,
 * to avoid Sentry noise / alert fatigue. Genuine faults (HEALTH_API_ERROR,
 * HEALTH_TOKEN_SAVE_FAILED) and unknown values are NOT in this set and stay at `error`.
 */
const EXPECTED_HEALTH_CODES = new Set([
  "HEALTH_TOKEN_INVALID",
  "HEALTH_SCOPE_MISSING",
  "HEALTH_RATE_LIMIT",
  "HEALTH_RATE_LIMIT_LOW",
  "HEALTH_TIMEOUT",
  "HEALTH_REFRESH_TRANSIENT",
]);

/**
 * True when the thrown value is an expected, operational Google Health condition that
 * should be logged at `warn` rather than `error`. Accepts Error instances or raw values.
 */
export function isExpectedHealthError(error: unknown): boolean {
  const code = error instanceof Error ? error.message : String(error);
  return EXPECTED_HEALTH_CODES.has(code);
}

/**
 * Map a thrown Google Health error code to a typed HTTP Response.
 *
 * Error codes are carried as `Error.message` strings, matching the pattern in
 * `src/lib/google-health.ts` (e.g. `throw new Error("HEALTH_TOKEN_INVALID")`).
 *
 * Mapping:
 *   HEALTH_TOKEN_INVALID     → 401
 *   HEALTH_SCOPE_MISSING     → 403
 *   HEALTH_RATE_LIMIT        → 429
 *   HEALTH_RATE_LIMIT_LOW    → 503
 *   HEALTH_TIMEOUT           → 504
 *   HEALTH_REFRESH_TRANSIENT → 502
 *   HEALTH_TOKEN_SAVE_FAILED → 500
 *   HEALTH_API_ERROR         → 502
 *   anything else            → 500 INTERNAL_ERROR
 *
 * Callers are responsible for logging before invoking this helper.
 */
export function mapHealthError(error: unknown): Response {
  const code = error instanceof Error ? error.message : String(error);

  switch (code) {
    case "HEALTH_TOKEN_INVALID":
      return errorResponse(
        "HEALTH_TOKEN_INVALID",
        "Google Health token is invalid or expired. Please reconnect your account.",
        401,
      );
    case "HEALTH_SCOPE_MISSING":
      return errorResponse(
        "HEALTH_SCOPE_MISSING",
        "Google Health permissions need updating. Please reconnect your account in Settings.",
        403,
      );
    case "HEALTH_RATE_LIMIT":
      return errorResponse(
        "HEALTH_RATE_LIMIT",
        "Google Health API rate limited. Please try again later.",
        429,
      );
    case "HEALTH_RATE_LIMIT_LOW":
      return errorResponse(
        "HEALTH_RATE_LIMIT_LOW",
        "Google Health rate-limit headroom is low. Please try again in a few minutes.",
        503,
      );
    case "HEALTH_TIMEOUT":
      return errorResponse(
        "HEALTH_TIMEOUT",
        "Request to Google Health timed out. Please try again.",
        504,
      );
    case "HEALTH_REFRESH_TRANSIENT":
      return errorResponse(
        "HEALTH_REFRESH_TRANSIENT",
        "Temporary Google Health error. Please try again.",
        502,
      );
    case "HEALTH_TOKEN_SAVE_FAILED":
      return errorResponse(
        "HEALTH_TOKEN_SAVE_FAILED",
        "Failed to save Google Health tokens. Please try again.",
        500,
      );
    case "HEALTH_API_ERROR":
      return errorResponse(
        "HEALTH_API_ERROR",
        "Google Health API error.",
        502,
      );
    default:
      return errorResponse(
        "INTERNAL_ERROR",
        "An unexpected error occurred.",
        500,
      );
  }
}
