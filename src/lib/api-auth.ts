import { createHash } from "crypto";
import { errorResponse } from "@/lib/api-response";
import { validateApiKey } from "@/lib/api-keys";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

// One aggregate bucket per presented key across all /api/v1 routes, checked BEFORE the
// key lookup so floods (valid, revoked or garbage keys) never reach the database.
const V1_KEY_RATE_LIMIT_MAX = 150;
const V1_KEY_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function validateApiRequest(
  request: Request,
): Promise<{ userId: string } | Response> {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    logger.warn({ action: "api_auth_missing_header" }, "missing Authorization header");
    return errorResponse("AUTH_MISSING_SESSION", "Not authenticated", 401);
  }

  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) {
    logger.warn({ action: "api_auth_malformed_header" }, "malformed Authorization header");
    return errorResponse("AUTH_MISSING_SESSION", "Invalid Authorization header format", 401);
  }

  const rawKey = match[1];

  const { allowed } = checkRateLimit(
    `v1:all:${hashForRateLimit(rawKey)}`,
    V1_KEY_RATE_LIMIT_MAX,
    V1_KEY_RATE_LIMIT_WINDOW_MS,
  );
  if (!allowed) {
    logger.warn({ action: "api_auth_rate_limited" }, "API key rate limit exceeded");
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const result = await validateApiKey(rawKey);

  if (!result) {
    logger.warn({ action: "api_auth_invalid_key" }, "invalid or revoked API key");
    return errorResponse("AUTH_MISSING_SESSION", "Invalid API key", 401);
  }

  return { userId: result.userId };
}

/** Hash an API key for use as a rate-limit store key (avoids logging raw keys). */
export function hashForRateLimit(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}
