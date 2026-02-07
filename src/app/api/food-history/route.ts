import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getFoodLogHistory } from "@/lib/food-log";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const url = new URL(request.url);

    const endDateParam = url.searchParams.get("endDate");
    const endDate = endDateParam && DATE_REGEX.test(endDateParam) ? endDateParam : undefined;

    const lastDateParam = url.searchParams.get("lastDate");
    const lastDate = lastDateParam && DATE_REGEX.test(lastDateParam) ? lastDateParam : null;
    const lastTimeParam = url.searchParams.get("lastTime");
    const lastIdParam = url.searchParams.get("lastId");
    const lastId = lastIdParam ? parseInt(lastIdParam, 10) : NaN;

    const cursor = lastDate && !Number.isNaN(lastId)
      ? { lastDate, lastTime: lastTimeParam || null, lastId }
      : undefined;

    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsedLimit) ? 20 : Math.min(parsedLimit, 50);

    const entries = await getFoodLogHistory(session!.email, { endDate, cursor, limit });

    return successResponse({ entries });
  } catch (error) {
    logger.error(
      {
        action: "get_food_history_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get food log history",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get food log history", 500);
  }
}
