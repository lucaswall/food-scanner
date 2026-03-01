import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { setShareToken } from "@/lib/food-log";
import { buildUrl } from "@/lib/url";

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/share");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object") {
    return errorResponse("VALIDATION_ERROR", "Missing or invalid request body", 400);
  }

  const { customFoodId } = body as Record<string, unknown>;
  if (typeof customFoodId !== "number" || !Number.isInteger(customFoodId) || customFoodId <= 0) {
    return errorResponse("VALIDATION_ERROR", "customFoodId must be a positive integer", 400);
  }

  const token = await setShareToken(session!.userId, customFoodId);
  if (!token) {
    log.warn({ action: "share_food_not_found", customFoodId }, "food not found for sharing");
    return errorResponse("NOT_FOUND", "Custom food not found", 404);
  }

  const shareUrl = buildUrl(`/app/log-shared/${token}`);
  log.info({ action: "share_food_success", customFoodId }, "share token generated");

  return successResponse({ shareUrl, shareToken: token });
}
