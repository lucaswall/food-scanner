import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";

interface NutritionFactsCardProps {
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  unitId: number;
  amount: number;
  mealTypeId?: number;
  // Tier 1 nutrients (optional)
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
}

export function NutritionFactsCard({
  foodName,
  calories,
  proteinG,
  carbsG,
  fatG,
  fiberG,
  sodiumMg,
  unitId,
  amount,
  mealTypeId,
  saturatedFatG,
  transFatG,
  sugarsG,
  caloriesFromFat,
}: NutritionFactsCardProps) {
  return (
    <div className="border-2 border-foreground dark:border-foreground/50 rounded-lg p-4">
      <h4 className="text-lg font-bold border-b border-foreground dark:border-foreground/50 pb-1">
        Nutrition Facts
      </h4>
      <p className="text-sm font-medium mt-1">{foodName}</p>
      <p className="text-sm text-muted-foreground">
        {getUnitLabel(unitId, amount)}
      </p>
      <div className="border-t-4 border-foreground dark:border-foreground/50 mt-2 pt-2">
        <div className="flex justify-between items-baseline">
          <span className="text-sm font-bold">Calories</span>
          <span className="text-2xl font-bold">{calories}</span>
        </div>
        {caloriesFromFat != null && (
          <div className="text-xs text-muted-foreground mt-0.5">
            Calories from Fat {caloriesFromFat}
          </div>
        )}
      </div>
      <div className="border-t border-foreground dark:border-foreground/50 mt-1 pt-1 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="font-bold">Protein</span>
          <span>{proteinG}g</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-bold">Carbs</span>
          <span>{carbsG}g</span>
        </div>
        {sugarsG != null && (
          <div className="flex justify-between text-sm pl-4 text-muted-foreground">
            <span>Sugars</span>
            <span>{sugarsG}g</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="font-bold">Fat</span>
          <span>{fatG}g</span>
        </div>
        {saturatedFatG != null && (
          <div className="flex justify-between text-sm pl-4 text-muted-foreground">
            <span>Saturated Fat</span>
            <span>{saturatedFatG}g</span>
          </div>
        )}
        {transFatG != null && (
          <div className="flex justify-between text-sm pl-4 text-muted-foreground">
            <span>Trans Fat</span>
            <span>{transFatG}g</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="font-bold">Fiber</span>
          <span>{fiberG}g</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-bold">Sodium</span>
          <span>{sodiumMg}mg</span>
        </div>
      </div>
      {mealTypeId !== undefined && (
        <div className="border-t border-foreground dark:border-foreground/50 mt-2 pt-2 text-sm text-muted-foreground">
          {FITBIT_MEAL_TYPE_LABELS[mealTypeId] ?? "Unknown"}
        </div>
      )}
    </div>
  );
}
