import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { mapHealthError } from "@/lib/health-error-response";
import { createRequestLogger } from "@/lib/logger";
import { getCachedHealthActivitySummary } from "@/lib/health-cache";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const ZONE_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

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

  // Optional zoneOffset aligns the daily rollup window with the caller's civil day
  // (matches the meal-write timezone handling, FOO-1134). Omitted → UTC civil day.
  const zoneOffsetParam = searchParams.get("zoneOffset");
  if (zoneOffsetParam !== null && !ZONE_OFFSET_RE.test(zoneOffsetParam)) {
    return errorResponse("VALIDATION_ERROR", "Invalid zoneOffset format. Use ±HH:MM (e.g., -03:00, +05:30)", 400);
  }

  try {
    const activitySummary = await getCachedHealthActivitySummary(
      authResult.userId,
      date,
      log,
      "important",
      zoneOffsetParam,
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

    return mapHealthError(error);
  }
}
