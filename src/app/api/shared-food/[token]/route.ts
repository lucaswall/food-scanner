import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getCustomFoodByShareToken } from "@/lib/food-log";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const log = createRequestLogger("GET", "/api/shared-food/[token]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { token } = await params;

  const food = await getCustomFoodByShareToken(token);
  if (!food) {
    log.warn({ action: "shared_food_not_found", token }, "shared food not found");
    return errorResponse("NOT_FOUND", "Shared food not found", 404);
  }

  log.info({ action: "shared_food_fetched", token, foodId: food.id }, "shared food fetched");

  return successResponse({
    id: food.id,
    foodName: food.foodName,
    amount: Number(food.amount),
    unitId: food.unitId,
    calories: food.calories,
    proteinG: Number(food.proteinG),
    carbsG: Number(food.carbsG),
    fatG: Number(food.fatG),
    fiberG: Number(food.fiberG),
    sodiumMg: Number(food.sodiumMg),
    saturatedFatG: food.saturatedFatG != null ? Number(food.saturatedFatG) : null,
    transFatG: food.transFatG != null ? Number(food.transFatG) : null,
    sugarsG: food.sugarsG != null ? Number(food.sugarsG) : null,
    caloriesFromFat: food.caloriesFromFat != null ? Number(food.caloriesFromFat) : null,
    confidence: food.confidence,
    notes: food.notes,
    description: food.description,
    keywords: food.keywords,
  });
}
