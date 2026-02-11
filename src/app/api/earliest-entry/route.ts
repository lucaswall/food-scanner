import { getSession, validateSession } from "@/lib/session";
import { getEarliestEntryDate } from "@/lib/food-log";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function GET(): Promise<Response> {
  try {
    const session = await getSession();

    const authError = validateSession(session);
    if (authError) {
      return authError;
    }

    const date = await getEarliestEntryDate(session!.userId);

    logger.info(
      {
        action: "earliest_entry_get_success",
        hasDate: date !== null,
      },
      "earliest entry date retrieved"
    );

    const response = successResponse({ date });
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "earliest entry retrieval failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve earliest entry date", 500);
  }
}
