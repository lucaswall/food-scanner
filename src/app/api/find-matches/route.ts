import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { findMatchingFoods } from "@/lib/food-matching";

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/find-matches");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (
    !body ||
    typeof body !== "object" ||
    !("keywords" in body) ||
    !Array.isArray((body as Record<string, unknown>).keywords) ||
    !(body as Record<string, unknown[]>).keywords.every(
      (k: unknown) => typeof k === "string",
    )
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing or invalid keywords array",
      400,
    );
  }

  const b = body as Record<string, unknown>;
  if (
    typeof b.food_name !== "string" ||
    typeof b.amount !== "number" ||
    typeof b.unit_id !== "number" ||
    typeof b.calories !== "number" ||
    typeof b.protein_g !== "number" ||
    typeof b.carbs_g !== "number" ||
    typeof b.fat_g !== "number" ||
    typeof b.fiber_g !== "number" ||
    typeof b.sodium_mg !== "number"
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing required fields: food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg",
      400,
    );
  }

  try {
    const matches = await findMatchingFoods(
      session!.userId,
      body as Parameters<typeof findMatchingFoods>[1],
      log,
    );

    log.debug(
      { action: "find_matches", matchCount: matches.length },
      "food matching complete",
    );

    return successResponse({ matches });
  } catch (error) {
    log.error(
      {
        action: "find_matches_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to find matching foods",
    );
    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to find matching foods",
      500,
    );
  }
}
