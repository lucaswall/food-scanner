import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { searchFoods } from "@/lib/food-log";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/search-foods");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:search-foods:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q");

  if (!q || q.length < 2) {
    return errorResponse("VALIDATION_ERROR", "Query must be at least 2 characters", 400);
  }

  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam !== null ? parseInt(limitParam, 10) : NaN;
  const limit = isNaN(parsedLimit) ? 10 : Math.max(1, Math.min(50, parsedLimit));

  const keywords = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    return errorResponse("VALIDATION_ERROR", "Query must contain at least one word", 400);
  }

  try {
    const foods = await searchFoods(authResult.userId, keywords, { limit }, log);

    log.debug(
      { action: "v1_search_foods_success", query: q, count: foods.length },
      "v1 search foods retrieved"
    );

    return conditionalResponse(request, { foods });
  } catch (error) {
    log.error(
      { action: "v1_search_foods_error", error: error instanceof Error ? error.message : String(error) },
      "v1 search foods failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to search foods", 500);
  }
}
