/** User record from the users table */
export interface User {
  id: string;
  email: string;
  name: string | null;
}

/** Cookie-only session data (stored in iron-session encrypted cookie) */
export interface SessionData {
  sessionId: string;
  oauthState?: string;
}

/** Full session data combining cookie + database */
export interface FullSession {
  sessionId: string;
  userId: string;
  expiresAt: number;
  fitbitConnected: boolean;
  hasFitbitCredentials: boolean;
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
  saturated_fat_g?: number | null;
  trans_fat_g?: number | null;
  sugars_g?: number | null;
  calories_from_fat?: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
  description: string;
  keywords: string[];
}

export interface AnalyzeFoodDirectResult {
  type: "analysis";
  analysis: FoodAnalysis;
}

export interface AnalyzeFoodNeedsChatResult {
  type: "needs_chat";
  message: string;
}

export type AnalyzeFoodResult = AnalyzeFoodDirectResult | AnalyzeFoodNeedsChatResult;

export interface FoodLogRequest extends FoodAnalysis {
  mealTypeId: number; // 1,2,3,4,5,7
  date: string; // YYYY-MM-DD (client wall-clock)
  time: string; // HH:mm:ss (client wall-clock)
  reuseCustomFoodId?: number;
  // Optional metadata updates when reusing a custom food
  newDescription?: string;
  newNotes?: string;
  newKeywords?: string[];
  newConfidence?: "high" | "medium" | "low";
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
  | "FITBIT_SCOPE_MISSING"
  | "FITBIT_CREDENTIALS_MISSING"
  | "FITBIT_RATE_LIMIT"
  | "FITBIT_TIMEOUT"
  | "FITBIT_REFRESH_TRANSIENT"
  | "FITBIT_TOKEN_SAVE_FAILED"
  | "NOT_FOUND"
  | "PARTIAL_ERROR"
  | "CLAUDE_API_ERROR"
  | "FITBIT_API_ERROR"
  | "VALIDATION_ERROR"
  | "RATE_LIMIT_EXCEEDED"
  | "LUMEN_PARSE_ERROR"
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
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
  fitbitFoodId: number | null;
  mealTypeId: number;
}

export interface CommonFoodsCursor {
  score: number;
  id: number;
}

export interface CommonFoodsResponse {
  foods: CommonFood[];
  nextCursor: CommonFoodsCursor | null;
}

export interface RecentFoodsCursor {
  lastDate: string;
  lastTime: string | null;
  lastId: number;
}

export interface RecentFoodsResponse {
  foods: CommonFood[];
  nextCursor: RecentFoodsCursor | null;
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
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
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
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
  fitbitFoodId: number | null;
  matchRatio: number;
  lastLoggedAt: Date;
  amount: number;
  unitId: number;
}

export interface FoodLogEntryDetail {
  id: number;
  foodName: string;
  description: string | null;
  notes: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
  amount: number;
  unitId: number;
  mealTypeId: number;
  date: string;
  time: string | null;
  fitbitLogId: number | null;
  confidence: string;
}

export interface MealEntry {
  id: number;
  foodName: string;
  time: string | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number | null;
  transFatG: number | null;
  sugarsG: number | null;
  caloriesFromFat: number | null;
}

export interface MealGroup {
  mealTypeId: number;
  entries: MealEntry[];
  subtotal: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sodiumMg: number;
    saturatedFatG: number;
    transFatG: number;
    sugarsG: number;
    caloriesFromFat: number;
  };
}

export interface NutritionSummary {
  date: string;
  meals: MealGroup[];
  totals: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sodiumMg: number;
    saturatedFatG: number;
    transFatG: number;
    sugarsG: number;
    caloriesFromFat: number;
  };
}

export interface NutritionGoals {
  calories: number | null;
}

export interface ActivitySummary {
  caloriesOut: number;
}

export interface LumenGoals {
  date: string;
  dayType: string;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

export interface LumenGoalsResponse {
  goals: LumenGoals | null;
}

export interface ClaudeUsageRecord {
  id: number;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  costUsd: string;
  createdAt: string;
}

export interface MonthlyClaudeUsage {
  month: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

export interface ClaudeUsageResponse {
  months: MonthlyClaudeUsage[];
}

export interface FastingWindow {
  date: string;
  lastMealTime: string; // HH:mm:ss
  firstMealTime: string | null;
  durationMinutes: number | null;
}

export interface FastingResponse {
  window: FastingWindow | null;
  live: {
    lastMealTime: string;
    startDate: string;
  } | null;
}

export interface DailyNutritionTotals {
  date: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  calorieGoal: number | null;
  proteinGoalG: number | null;
  carbsGoalG: number | null;
  fatGoalG: number | null;
}

export interface DateRangeNutritionResponse {
  days: DailyNutritionTotals[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  analysis?: FoodAnalysis;
}

export interface ChatFoodRequest {
  messages: ConversationMessage[];
  images?: string[];
  initialAnalysis?: FoodAnalysis;
}

export interface ChatFoodResponse {
  message: string;
  analysis?: FoodAnalysis;
}
