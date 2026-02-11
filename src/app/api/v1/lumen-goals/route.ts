import { validateApiRequest } from "@/lib/api-auth";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getLumenGoalsByDate } from "@/lib/lumen";

function isValidDateFormat(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export async function GET(request: Request) {
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return errorResponse("VALIDATION_ERROR", "date query parameter is required (YYYY-MM-DD)", 400);
  }

  if (!isValidDateFormat(date)) {
    return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
  }

  try {
    const goals = await getLumenGoalsByDate(authResult.userId, date);

    logger.info(
      {
        action: "v1_lumen_goals_success",
        date,
        hasGoals: goals !== null,
      },
      "v1 lumen goals retrieved"
    );

    const response = successResponse({ goals });
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), date },
      "v1 lumen goals fetch failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to fetch lumen goals", 500);
  }
}
