import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { findMatchingFoods } from "@/lib/food-matching";

export async function POST(request: Request) {
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
    (body as Record<string, unknown[]>).keywords.length === 0 ||
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

  try {
    const matches = await findMatchingFoods(
      session!.email,
      body as Parameters<typeof findMatchingFoods>[1],
    );

    logger.info(
      { action: "find_matches", matchCount: matches.length },
      "food matching complete",
    );

    return successResponse({ matches });
  } catch (error) {
    logger.error(
      {
        action: "find_matches_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to find matching foods",
    );
    return errorResponse(
      "FITBIT_API_ERROR",
      "Failed to find matching foods",
      500,
    );
  }
}
