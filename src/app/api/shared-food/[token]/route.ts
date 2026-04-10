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
    log.warn({ action: "shared_food_not_found" }, "shared food not found");
    return errorResponse("NOT_FOUND", "Shared food not found", 404);
  }

  log.info({ action: "shared_food_fetched", foodId: food.id }, "shared food fetched");

  return successResponse({
    food_name: food.foodName,
    amount: Number(food.amount),
    unit_id: food.unitId,
    calories: food.calories,
    protein_g: Number(food.proteinG),
    carbs_g: Number(food.carbsG),
    fat_g: Number(food.fatG),
    fiber_g: Number(food.fiberG),
    sodium_mg: Number(food.sodiumMg),
    saturated_fat_g: food.saturatedFatG != null ? Number(food.saturatedFatG) : null,
    trans_fat_g: food.transFatG != null ? Number(food.transFatG) : null,
    sugars_g: food.sugarsG != null ? Number(food.sugarsG) : null,
    calories_from_fat: food.caloriesFromFat != null ? Number(food.caloriesFromFat) : null,
    confidence: food.confidence,
    notes: food.notes,
    description: food.description,
    keywords: food.keywords,
  });
}
