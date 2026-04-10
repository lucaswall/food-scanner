/**
 * Shared validation for FoodAnalysis fields.
 * Used by log-food and edit-food routes.
 */
export function isValidFoodAnalysisFields(body: Record<string, unknown>): boolean {
  if (
    typeof body.food_name !== "string" ||
    body.food_name.length === 0 ||
    body.food_name.length > 500 ||
    typeof body.amount !== "number" ||
    body.amount <= 0 ||
    typeof body.unit_id !== "number" ||
    typeof body.calories !== "number" ||
    body.calories < 0 ||
    typeof body.protein_g !== "number" ||
    body.protein_g < 0 ||
    typeof body.carbs_g !== "number" ||
    body.carbs_g < 0 ||
    typeof body.fat_g !== "number" ||
    body.fat_g < 0 ||
    typeof body.fiber_g !== "number" ||
    body.fiber_g < 0 ||
    typeof body.sodium_mg !== "number" ||
    body.sodium_mg < 0 ||
    typeof body.notes !== "string" ||
    body.notes.length > 2000 ||
    typeof body.description !== "string" ||
    body.description.length > 2000 ||
    (body.confidence !== "high" && body.confidence !== "medium" && body.confidence !== "low")
  ) {
    return false;
  }

  // Validate keywords if present: must be an array of strings, each ≤100 chars, max 20 elements
  if (body.keywords !== undefined) {
    if (
      !Array.isArray(body.keywords) ||
      body.keywords.length > 20 ||
      !body.keywords.every((k: unknown) => typeof k === "string" && (k as string).length <= 100)
    ) {
      return false;
    }
  }

  // Validate Tier 1 nutrients if present: must be null or non-negative number
  const tier1Fields = ["saturated_fat_g", "trans_fat_g", "sugars_g", "calories_from_fat"] as const;
  for (const field of tier1Fields) {
    const value = body[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || value < 0) {
        return false;
      }
    }
  }

  return true;
}
