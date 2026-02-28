import { getSession, validateSession } from "@/lib/session";
import { getEarliestEntryDate } from "@/lib/food-log";
import { errorResponse, conditionalResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";

export async function GET(request: Request): Promise<Response> {
  const log = createRequestLogger("GET", "/api/earliest-entry");
  try {
    const session = await getSession();

    const authError = validateSession(session);
    if (authError) {
      return authError;
    }

    const date = await getEarliestEntryDate(session!.userId, log);

    log.debug(
      {
        action: "earliest_entry_get_success",
        hasDate: date !== null,
      },
      "earliest entry date retrieved"
    );

    return conditionalResponse(request, { date });
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "earliest entry retrieval failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve earliest entry date", 500);
  }
}
