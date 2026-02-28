import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, getActivitySummary } from "@/lib/fitbit";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30; // Fitbit API route
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
    const accessToken = await ensureFreshToken(authResult.userId, log);
    const activitySummary = await getActivitySummary(accessToken, date, log);

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
      if (error.message === "FITBIT_CREDENTIALS_MISSING") {
        return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 424);
      }
      if (error.message === "FITBIT_TOKEN_INVALID") {
        return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
      }
      if (error.message === "FITBIT_SCOPE_MISSING") {
        return errorResponse("FITBIT_SCOPE_MISSING", "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.", 403);
      }
      if (error.message === "FITBIT_API_ERROR") {
        return errorResponse("FITBIT_API_ERROR", "Fitbit API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch activity summary", 500);
  }
}
