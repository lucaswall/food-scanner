import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getCommonFoods } from "@/lib/food-log";

export async function GET() {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const currentTime = new Date().toTimeString().slice(0, 8);
    const foods = await getCommonFoods(session!.userId, currentTime);

    logger.debug(
      { action: "get_common_foods", count: foods.length },
      "common foods retrieved",
    );

    const response = successResponse({ foods });
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
