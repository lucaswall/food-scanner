import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getFoodLogHistory } from "@/lib/food-log";

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const url = new URL(request.url);
    const endDate = url.searchParams.get("endDate") || undefined;
    const afterIdParam = url.searchParams.get("afterId");
    const afterId = afterIdParam ? parseInt(afterIdParam, 10) : undefined;
    const limitParam = url.searchParams.get("limit");
    const parsedLimit = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isNaN(parsedLimit) ? 20 : Math.min(parsedLimit, 50);

    const entries = await getFoodLogHistory(session!.email, { endDate, afterId, limit });

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
