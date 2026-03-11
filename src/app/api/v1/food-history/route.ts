import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getFoodLogHistory } from "@/lib/food-log";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}:\d{2}$/;

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
  const endDateParam = searchParams.get("endDate");
  const endDate = endDateParam && DATE_REGEX.test(endDateParam) ? endDateParam : undefined;

  const lastDateParam = searchParams.get("lastDate");
  const lastDate = lastDateParam && DATE_REGEX.test(lastDateParam) ? lastDateParam : null;
  const lastTimeParam = searchParams.get("lastTime");
  const lastTime = lastTimeParam && TIME_REGEX.test(lastTimeParam) ? lastTimeParam : null;
  const lastIdParam = searchParams.get("lastId");
  const lastId = lastIdParam ? parseInt(lastIdParam, 10) : NaN;

  const cursor = lastDate && !Number.isNaN(lastId)
    ? { lastDate, lastTime: lastTime || null, lastId }
    : undefined;

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
