import { errorResponse } from "@/lib/api-response";
import { validateApiKey } from "@/lib/api-keys";
import { logger } from "@/lib/logger";

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
  const result = await validateApiKey(rawKey);

  if (!result) {
    logger.warn({ action: "api_auth_invalid_key" }, "invalid or revoked API key");
    return errorResponse("AUTH_MISSING_SESSION", "Invalid API key", 401);
  }

  return { userId: result.userId };
}
