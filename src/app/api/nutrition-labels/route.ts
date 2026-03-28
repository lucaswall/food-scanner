import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getAllLabels } from "@/lib/nutrition-labels";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/nutrition-labels");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") || undefined;

    const labels = await getAllLabels(session!.userId, q || undefined);

    const response = successResponse(labels);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "private, no-cache");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    log.error(
      {
        action: "get_nutrition_labels_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get nutrition labels",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get nutrition labels", 500);
  }
}
