/** Cookie-only session data (stored in iron-session encrypted cookie) */
export interface SessionData {
  sessionId: string;
  oauthState?: string;
}

/** Full session data combining cookie + database */
export interface FullSession {
  sessionId: string;
  email: string;
  expiresAt: number;
  fitbitConnected: boolean;
  /** Call to destroy both cookie and DB session */
  destroy: () => Promise<void>;
}

export const FITBIT_UNITS = {
  g:       { id: 147, name: "g",       plural: "g" },
  oz:      { id: 226, name: "oz",      plural: "oz" },
  cup:     { id: 91,  name: "cup",     plural: "cups" },
  tbsp:    { id: 349, name: "tbsp",    plural: "tbsp" },
  tsp:     { id: 364, name: "tsp",     plural: "tsp" },
  ml:      { id: 209, name: "ml",      plural: "ml" },
  slice:   { id: 311, name: "slice",   plural: "slices" },
  serving: { id: 304, name: "serving", plural: "servings" },
} as const;

export type FitbitUnitKey = keyof typeof FITBIT_UNITS;

const UNITS_WITHOUT_SPACE: Set<string> = new Set(["g", "oz", "ml", "tbsp", "tsp"]);

export function getUnitById(id: number): (typeof FITBIT_UNITS)[FitbitUnitKey] | undefined {
  for (const key of Object.keys(FITBIT_UNITS) as FitbitUnitKey[]) {
    if (FITBIT_UNITS[key].id === id) return FITBIT_UNITS[key];
  }
  return undefined;
}

export function getUnitLabel(unitId: number, amount: number): string {
  const unit = getUnitById(unitId);
  if (!unit) return `${amount} units`;
  const label = amount === 1 ? unit.name : unit.plural;
  if (UNITS_WITHOUT_SPACE.has(unit.name)) return `${amount}${label}`;
  return `${amount} ${label}`;
}

export interface FoodAnalysis {
  food_name: string;
  amount: number;
  unit_id: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  confidence: "high" | "medium" | "low";
  notes: string;
  keywords: string[];
}

export interface FoodLogRequest extends FoodAnalysis {
  mealTypeId: number; // 1,2,3,4,5,7
  date: string; // YYYY-MM-DD (client wall-clock)
  time: string; // HH:mm:ss (client wall-clock)
  reuseCustomFoodId?: number;
}

export interface FoodLogResponse {
  success: boolean;
  fitbitFoodId?: number;
  fitbitLogId?: number;
  reusedFood: boolean;
  foodLogId?: number;
  dryRun?: boolean;
  error?: string;
}

export enum FitbitMealType {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
  Anytime = 7,
}

export type ErrorCode =
  | "AUTH_INVALID_EMAIL"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_MISSING_SESSION"
  | "FITBIT_NOT_CONNECTED"
  | "FITBIT_TOKEN_INVALID"
  | "CLAUDE_API_ERROR"
  | "FITBIT_API_ERROR"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  timestamp: number;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  timestamp: number;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export const FITBIT_MEAL_TYPE_LABELS: Record<number, string> = {
  1: "Breakfast",
  2: "Morning Snack",
  3: "Lunch",
  4: "Afternoon Snack",
  5: "Dinner",
  7: "Anytime",
};

export interface CommonFood {
  customFoodId: number;
  foodName: string;
  amount: number;
  unitId: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  fitbitFoodId: number | null;
  mealTypeId: number;
}

export interface FoodLogHistoryEntry {
  id: number;
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  amount: number;
  unitId: number;
  mealTypeId: number;
  date: string;
  time: string | null;
  fitbitLogId: number | null;
}

export interface FoodMatch {
  customFoodId: number;
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fitbitFoodId: number | null;
  matchRatio: number;
  lastLoggedAt: Date;
  amount: number;
  unitId: number;
}
