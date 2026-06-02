import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { checkHealthConnection } from "@/lib/health-connection";

export async function GET() {
  const log = createRequestLogger("GET", "/api/health-status");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const health = await checkHealthConnection(session!.userId, log);

    const response = successResponse(health);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      { action: "health_status_error", error: error instanceof Error ? error.message : String(error) },
      "health connection check failed",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to check health connection status", 500);
  }
}
