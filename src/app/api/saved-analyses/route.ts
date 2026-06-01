import { getSession, validateSession } from "@/lib/session";
import { conditionalResponse, errorResponse, successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { saveAnalysis, getSavedAnalyses } from "@/lib/saved-analyses";
import { validateFoodAnalysis } from "@/lib/claude";
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be a JSON object", 400);
  }

  const data = body as Record<string, unknown>;

  let foodAnalysis: FoodAnalysis;
  try {
    foodAnalysis = validateFoodAnalysis(data.foodAnalysis);
  } catch (err) {
    return errorResponse(
      "VALIDATION_ERROR",
      err instanceof Error ? err.message : "Invalid food analysis",
      400,
    );
  }

  try {
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
