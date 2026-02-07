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
    const foods = await getCommonFoods(session!.email, currentTime);

    logger.debug(
      { action: "get_common_foods", count: foods.length },
      "common foods retrieved",
    );

    return successResponse({ foods });
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
