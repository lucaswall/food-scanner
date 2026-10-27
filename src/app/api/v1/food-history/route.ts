import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getFoodLogHistory } from "@/lib/food-log";
import { parseFoodHistoryParams } from "@/lib/food-history-params";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/food-history");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:food-history:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const { searchParams } = new URL(request.url);
  const parsedParams = parseFoodHistoryParams(searchParams);
  if ("error" in parsedParams) {
    log.warn({ action: "v1_food_history_validation" }, "invalid query parameters");
    return errorResponse("VALIDATION_ERROR", parsedParams.error, 400);
  }
  const { endDate, cursor } = parsedParams;

  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
  const limit = Number.isNaN(parsedLimit) ? 20 : Math.max(1, Math.min(parsedLimit, 50));

  try {
    const entries = await getFoodLogHistory(authResult.userId, { endDate, cursor, limit }, log);

    log.debug(
      { action: "v1_food_history_success", count: entries.length },
      "v1 food history retrieved"
    );

    return conditionalResponse(request, { entries });
  } catch (error) {
    log.error(
      { action: "v1_food_history_error", error: error instanceof Error ? error.message : String(error) },
      "v1 food history failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get food log history", 500);
  }
}
