import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getCommonFoods, getRecentFoods } from "@/lib/food-log";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/common-foods");
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
          const parsed = JSON.parse(cursorParam);
          if (
            typeof parsed !== "object" || parsed === null ||
            typeof parsed.lastDate !== "string" ||
            (parsed.lastTime !== null && typeof parsed.lastTime !== "string") ||
            !Number.isFinite(parsed.lastId)
          ) {
            return errorResponse("VALIDATION_ERROR", "Invalid cursor format", 400);
          }
          cursor = { lastDate: parsed.lastDate, lastTime: parsed.lastTime, lastId: parsed.lastId };
        } catch {
          return errorResponse("VALIDATION_ERROR", "Invalid cursor format", 400);
        }
      }

      const result = await getRecentFoods(session!.userId, { limit, cursor }, log);

      log.debug(
        { action: "get_recent_foods", count: result.foods.length },
        "recent foods retrieved",
      );

      const response = successResponse({ foods: result.foods, nextCursor: result.nextCursor });
      response.headers.set("Cache-Control", "private, no-cache");
      return response;
    }

    // Use client-provided time/date if available, otherwise fall back to server time/date
    const clientTime = url.searchParams.get("clientTime");
    const clientDate = url.searchParams.get("clientDate");
    const now = new Date();
    const currentTime = clientTime || now.toTimeString().slice(0, 8);
    const currentDate = clientDate || now.toISOString().slice(0, 10);
    const cursorParam = url.searchParams.get("cursor");
    let cursor: { score: number; id: number } | undefined;
    if (cursorParam) {
      try {
        const parsed = JSON.parse(cursorParam);
        if (
          typeof parsed !== "object" || parsed === null ||
          !Number.isFinite(parsed.score) || !Number.isFinite(parsed.id)
        ) {
          return errorResponse("VALIDATION_ERROR", "Invalid cursor format", 400);
        }
        cursor = { score: parsed.score, id: parsed.id };
      } catch {
        return errorResponse("VALIDATION_ERROR", "Invalid cursor format", 400);
      }
    }

    const result = await getCommonFoods(session!.userId, currentTime, currentDate, { limit, cursor }, log);

    log.debug(
      { action: "get_common_foods", count: result.foods.length },
      "common foods retrieved",
    );

    const response = successResponse({ foods: result.foods, nextCursor: result.nextCursor });
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      {
        action: "get_common_foods_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get common foods",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get common foods", 500);
  }
}
