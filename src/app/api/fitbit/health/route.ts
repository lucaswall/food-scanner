import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { checkFitbitHealth } from "@/lib/fitbit-health";

export async function GET() {
  const log = createRequestLogger("GET", "/api/fitbit/health");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const health = await checkFitbitHealth(session!.userId, log);

    const response = successResponse(health);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      { action: "fitbit_health_error", error: error instanceof Error ? error.message : String(error) },
      "fitbit health check failed",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to check Fitbit health", 500);
  }
}
