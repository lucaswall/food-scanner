import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getEarliestEntryDate } from "@/lib/food-log";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/earliest-entry");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:earliest-entry:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  try {
    const date = await getEarliestEntryDate(authResult.userId, log);

    log.debug(
      { action: "v1_earliest_entry_success", hasDate: date !== null },
      "v1 earliest entry date retrieved"
    );

    return conditionalResponse(request, { date });
  } catch (error) {
    log.error(
      { action: "v1_earliest_entry_error", error: error instanceof Error ? error.message : String(error) },
      "v1 earliest entry failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve earliest entry date", 500);
  }
}
