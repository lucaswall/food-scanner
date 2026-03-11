import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getCommonFoods, getRecentFoods } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/common-foods");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:common-foods:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  try {
    const url = new URL(request.url);
    const tab = url.searchParams.get("tab");
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Math.max(1, Math.min(50, Number.isNaN(parsedLimit) ? 10 : parsedLimit));

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

      const result = await getRecentFoods(authResult.userId, { limit, cursor }, log);
      return conditionalResponse(request, { foods: result.foods, nextCursor: result.nextCursor });
    }

    // Default tab (foods)
    const clientTime = url.searchParams.get("clientTime");
    const clientDate = url.searchParams.get("clientDate");

    if (clientDate && !isValidDateFormat(clientDate)) {
      return errorResponse("VALIDATION_ERROR", "Invalid clientDate format. Use YYYY-MM-DD", 400);
    }

    if (clientTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(clientTime)) {
      return errorResponse("VALIDATION_ERROR", "Invalid clientTime format. Use HH:MM or HH:MM:SS", 400);
    }

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

    const result = await getCommonFoods(authResult.userId, currentTime, currentDate, { limit, cursor }, log);
    return conditionalResponse(request, { foods: result.foods, nextCursor: result.nextCursor });
  } catch (error) {
    log.error(
      { action: "v1_common_foods_error", error: error instanceof Error ? error.message : String(error) },
      "v1 common foods failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get common foods", 500);
  }
}
