/** Display formatting for nutrient values (kcal/mg as integers, grams to at most one decimal). */

/** Whole number for kcal and mg values: 180.4 -> "180". */
export function formatWhole(value: number): string {
  return String(Math.round(value));
}

/** Grams with at most one decimal and no trailing zero: 12.34 -> "12.3", 4 -> "4". */
export function formatGrams(value: number): string {
  return String(Number(value.toFixed(1)));
}
