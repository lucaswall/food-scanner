import { getSession, validateSession } from "@/lib/session";
import { errorResponse, successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { bulkSaveAnalyses } from "@/lib/saved-analyses";
import { validateFoodAnalysis } from "@/lib/claude";
import type { FoodAnalysis } from "@/types";

const MAX_BULK_ITEMS = 20;

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/saved-analyses/bulk");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be an object", 400);
  }

  const data = body as Record<string, unknown>;

  if (!Array.isArray(data.items)) {
    return errorResponse("VALIDATION_ERROR", "items must be an array", 400);
  }

  const items = data.items;

  if (items.length === 0) {
    return errorResponse("VALIDATION_ERROR", "items array cannot be empty", 400);
  }

  if (items.length > MAX_BULK_ITEMS) {
    return errorResponse("VALIDATION_ERROR", `items array exceeds maximum of ${MAX_BULK_ITEMS}`, 400);
  }

  // Validate each item using the same validation as single-item analysis
  const validatedItems: FoodAnalysis[] = [];
  for (let i = 0; i < items.length; i++) {
    try {
      validatedItems.push(validateFoodAnalysis(items[i]));
    } catch (err) {
      return errorResponse(
        "VALIDATION_ERROR",
        `items[${i}] is invalid: ${err instanceof Error ? err.message : "invalid item"}`,
        400
      );
    }
  }

  try {
    const result = await bulkSaveAnalyses(session!.userId, validatedItems);

    log.info(
      { action: "bulk_save_analyses_success", userId: session!.userId, count: result.length },
      "bulk saved analyses"
    );

    return successResponse({ items: result }, 201);
  } catch (error) {
    log.error(
      { action: "bulk_save_analyses_error", error: error instanceof Error ? error.message : String(error) },
      "failed to bulk save analyses"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to save analyses", 500);
  }
}
