import { getSession, validateSession } from "@/lib/session";
import { errorResponse, successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { bulkSaveAnalyses } from "@/lib/saved-analyses";
import type { FoodAnalysis } from "@/types";

const MAX_BULK_ITEMS = 20;

function isValidItem(item: unknown): item is Pick<FoodAnalysis, "food_name" | "calories" | "amount" | "protein_g" | "carbs_g" | "fat_g"> {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.food_name === "string" &&
    obj.food_name.length > 0 &&
    typeof obj.calories === "number" &&
    typeof obj.amount === "number" &&
    typeof obj.protein_g === "number" &&
    typeof obj.carbs_g === "number" &&
    typeof obj.fat_g === "number"
  );
}

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

  // Validate each item
  for (let i = 0; i < items.length; i++) {
    if (!isValidItem(items[i])) {
      return errorResponse(
        "VALIDATION_ERROR",
        `items[${i}] must include food_name, calories, amount, protein_g, carbs_g, and fat_g`,
        400
      );
    }
  }

  try {
    const result = await bulkSaveAnalyses(session!.userId, items as FoodAnalysis[]);

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
