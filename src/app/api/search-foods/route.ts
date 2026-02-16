import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { searchFoods } from "@/lib/food-log";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/search-foods");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q");

    if (!q || q.length < 2) {
      return errorResponse("VALIDATION_ERROR", "Query must be at least 2 characters", 400);
    }

    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(50, parseInt(limitParam, 10) || 10)) : 10;

    const foods = await searchFoods(session!.userId, q, { limit });

    log.debug(
      { action: "search_foods", query: q, count: foods.length },
      "food search completed",
    );

    const response = successResponse({ foods });
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      {
        action: "search_foods_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to search foods",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to search foods", 500);
  }
}
