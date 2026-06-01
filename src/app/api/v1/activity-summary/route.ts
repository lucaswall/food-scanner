import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getCachedHealthActivitySummary } from "@/lib/health-cache";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/activity-summary");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  // Extract API key from Authorization header for rate limiting
  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:activity-summary:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse(
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please try again later.",
      429
    );
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return errorResponse("VALIDATION_ERROR", "date query parameter is required (YYYY-MM-DD)", 400);
  }

  if (!isValidDateFormat(date)) {
    return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
  }

  try {
    const activitySummary = await getCachedHealthActivitySummary(
      authResult.userId,
      date,
      log,
      "important",
    );

    log.debug(
      {
        action: "v1_activity_summary_success",
        date,
        caloriesOut: activitySummary.caloriesOut,
      },
      "v1 activity summary retrieved"
    );

    return conditionalResponse(request, activitySummary);
  } catch (error) {
    log.error(
      { action: "v1_activity_summary_error", error: error instanceof Error ? error.message : String(error), date },
      "v1 activity summary fetch failed"
    );

    if (error instanceof Error) {
      if (error.message === "HEALTH_TOKEN_INVALID") {
        return errorResponse("HEALTH_TOKEN_INVALID", "Google Health token is invalid or expired", 401);
      }
      if (error.message === "HEALTH_SCOPE_MISSING") {
        return errorResponse("HEALTH_SCOPE_MISSING", "Google Health permissions need updating. Please reconnect your account in Settings.", 403);
      }
      if (error.message === "HEALTH_RATE_LIMIT") {
        return errorResponse("HEALTH_RATE_LIMIT", "Google Health API rate limited. Please try again later.", 429);
      }
      if (error.message === "HEALTH_RATE_LIMIT_LOW") {
        return errorResponse(
          "HEALTH_RATE_LIMIT_LOW",
          "Google Health rate-limit headroom is low. Please try again in a few minutes.",
          503,
        );
      }
      if (error.message === "HEALTH_TIMEOUT") {
        return errorResponse("HEALTH_TIMEOUT", "Request to Google Health timed out. Please try again.", 504);
      }
      if (error.message === "HEALTH_REFRESH_TRANSIENT") {
        return errorResponse("HEALTH_REFRESH_TRANSIENT", "Temporary Google Health error. Please try again.", 502);
      }
      if (error.message === "HEALTH_API_ERROR") {
        return errorResponse("HEALTH_API_ERROR", "Google Health API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch activity summary", 500);
  }
}
