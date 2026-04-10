import { getSession, validateSession } from "@/lib/session";
import { conditionalResponse, errorResponse, successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { saveAnalysis, getSavedAnalyses } from "@/lib/saved-analyses";
import type { FoodAnalysis } from "@/types";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/saved-analyses");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const items = await getSavedAnalyses(session!.userId);
    return conditionalResponse(request, { items });
  } catch (error) {
    log.error(
      {
        action: "get_saved_analyses_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get saved analyses",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get saved analyses", 500);
  }
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/saved-analyses");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("VALIDATION_ERROR", "Request body must be a JSON object", 400);
    }
    const foodAnalysis = body.foodAnalysis as FoodAnalysis | undefined;

    if (
      !foodAnalysis ||
      typeof foodAnalysis.food_name !== "string" ||
      !foodAnalysis.food_name ||
      typeof foodAnalysis.calories !== "number" ||
      typeof foodAnalysis.amount !== "number" ||
      typeof foodAnalysis.unit_id !== "number" ||
      typeof foodAnalysis.protein_g !== "number" ||
      typeof foodAnalysis.carbs_g !== "number" ||
      typeof foodAnalysis.fat_g !== "number" ||
      typeof foodAnalysis.fiber_g !== "number" ||
      typeof foodAnalysis.sodium_mg !== "number"
    ) {
      return errorResponse(
        "VALIDATION_ERROR",
        "foodAnalysis must include food_name, calories, amount, unit_id, protein_g, carbs_g, fat_g, fiber_g, and sodium_mg",
        400,
      );
    }

    const result = await saveAnalysis(session!.userId, foodAnalysis);

    log.info(
      { action: "save_analysis", userId: session!.userId, id: result.id },
      "saved analysis",
    );

    return successResponse(result, 201);
  } catch (error) {
    log.error(
      {
        action: "save_analysis_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to save analysis",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to save analysis", 500);
  }
}
