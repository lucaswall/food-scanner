import { getSession, validateSession } from "@/lib/session";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getOrComputeDailyGoals,
  mapComputeResultToNutritionGoals,
} from "@/lib/daily-goals";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";
import { isExpectedHealthError, mapHealthError } from "@/lib/health-error-response";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/nutrition-goals");
  const session = await getSession();

  const validationError = validateSession(session, { requireHealth: true });
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const clientDate = searchParams.get("clientDate");

  if (clientDate && !isValidDateFormat(clientDate)) {
    return errorResponse("VALIDATION_ERROR", "Invalid clientDate format. Use YYYY-MM-DD", 400);
  }

  try {
    const date = clientDate ?? getTodayDate();
    const result = await getOrComputeDailyGoals(
      session!.userId,
      date,
      log,
      clientDate ?? undefined,
    );
    const goals = mapComputeResultToNutritionGoals(result);

    log.debug(
      { action: "nutrition_goals_success", status: result.status },
      "nutrition goals retrieved"
    );

    return conditionalResponse(request, goals);
  } catch (error) {
    const logFields = {
      action: "nutrition_goals_error",
      error: error instanceof Error ? error.message : String(error),
    };
    if (isExpectedHealthError(error)) {
      log.warn(logFields, "nutrition goals fetch failed (expected Google Health condition)");
    } else {
      log.error(logFields, "nutrition goals fetch failed");
    }

    // Note: HEALTH_SCOPE_MISSING normally never reaches here — getOrComputeDailyGoals
    // catches it and returns a resolved blocked/scope_mismatch result (HTTP 200).
    return mapHealthError(error);
  }
}
