import { getSession, validateSession } from "@/lib/session";
import { errorResponse, conditionalResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getMonthlyUsage } from "@/lib/claude-usage";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/claude-usage");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const monthsParam = searchParams.get("months");

  // Parse and clamp months to 1-12 range, default 3
  let months = 3;
  if (monthsParam) {
    const parsed = parseInt(monthsParam, 10);
    if (!isNaN(parsed)) {
      months = Math.max(1, Math.min(12, parsed));
    }
  }

  try {
    const usage = await getMonthlyUsage(session!.userId, months);

    log.debug(
      {
        action: "claude_usage_retrieved",
        months,
        monthCount: usage.length,
      },
      "claude usage retrieved"
    );

    return conditionalResponse(request, { months: usage });
  } catch (error) {
    log.error(
      { action: "claude_usage_error", error: error instanceof Error ? error.message : String(error) },
      "claude usage retrieval failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve usage data", 500);
  }
}
