import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getCommonFoods, getRecentFoods } from "@/lib/food-log";

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab");
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(50, parseInt(limitParam, 10) || 10)) : 10;

    if (tab === "recent") {
      const cursorParam = url.searchParams.get("cursor");
      let cursor: { lastDate: string; lastTime: string | null; lastId: number } | undefined;
      if (cursorParam) {
        try {
          cursor = JSON.parse(cursorParam);
        } catch {
          return errorResponse("VALIDATION_ERROR", "Invalid cursor format", 400);
        }
      }

      const result = await getRecentFoods(session!.userId, { limit, cursor });

      logger.debug(
        { action: "get_recent_foods", count: result.foods.length },
        "recent foods retrieved",
      );

      const response = successResponse({ foods: result.foods, nextCursor: result.nextCursor });
      response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
      return response;
    }

    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 8);
    const currentDate = now.toISOString().slice(0, 10);
    const cursorParam = url.searchParams.get("cursor");
    const cursor = cursorParam ? parseFloat(cursorParam) : undefined;

    const result = await getCommonFoods(session!.userId, currentTime, currentDate, { limit, cursor });

    logger.debug(
      { action: "get_common_foods", count: result.foods.length },
      "common foods retrieved",
    );

    const response = successResponse({ foods: result.foods, nextCursor: result.nextCursor });
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=300");
    return response;
  } catch (error) {
    logger.error(
      {
        action: "get_common_foods_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get common foods",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get common foods", 500);
  }
}
