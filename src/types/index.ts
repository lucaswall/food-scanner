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
  healthConnected: boolean;
  /** Call to destroy both cookie and DB session */
  destroy: () => Promise<void>;
}

/**
 * Internal serving-unit representation. Replaces the legacy Fitbit numeric
 * unit_id registry — Google Health logs anonymous foods with a free-text
 * serving unit, so we keep our own stable string enum.
 */
export type ServingUnit =
  | "g"
  | "oz"
  | "cup"
  | "tbsp"
  | "tsp"
  | "ml"
  | "slice"
  | "serving";

export const SERVING_UNITS: Record<ServingUnit, { name: string; plural: string }> = {
  g:       { name: "g",       plural: "g" },
  oz:      { name: "oz",      plural: "oz" },
  cup:     { name: "cup",     plural: "cups" },
  tbsp:    { name: "tbsp",    plural: "tbsp" },
  tsp:     { name: "tsp",     plural: "tsp" },
  ml:      { name: "ml",      plural: "ml" },
  slice:   { name: "slice",   plural: "slices" },
  serving: { name: "serving", plural: "servings" },
};

const UNITS_WITHOUT_SPACE: Set<string> = new Set(["g", "oz", "ml", "tbsp", "tsp"]);

/**
 * Maps the legacy Fitbit numeric unit ids to the internal ServingUnit string.
 * Exported for the one-time DB backfill that converts unit_id integer -> text.
 */
export const LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT: Record<number, ServingUnit> = {
  147: "g",
  226: "oz",
  91:  "cup",
  349: "tbsp",
  364: "tsp",
  209: "ml",
  311: "slice",
  304: "serving",
};

const SERVING_UNIT_KEYS: Set<string> = new Set(Object.keys(SERVING_UNITS));

/**
 * Coerce an arbitrary value (model output, legacy numeric id, numeric string)
 * into a valid ServingUnit. Defaults to "serving" so a bad value never throws.
 */
export function coerceServingUnit(value: unknown): ServingUnit {
  if (typeof value === "string" && SERVING_UNIT_KEYS.has(value)) {
    return value as ServingUnit;
  }
  if (typeof value === "number" && value in LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT) {
    return LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT[value];
  }
  if (typeof value === "string") {
    const asNum = Number(value);
    if (Number.isInteger(asNum) && asNum in LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT) {
      return LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT[asNum];
    }
  }
  return "serving";
}

export function getUnitLabel(unit: ServingUnit | string, amount: number): string {
  const entry = SERVING_UNITS[coerceServingUnit(unit)];
  const label = amount === 1 ? entry.name : entry.plural;
  if (UNITS_WITHOUT_SPACE.has(entry.name)) return `${amount}${label}`;
  return `${amount} ${label}`;
}

export interface FoodAnalysis {
  food_name: string;
  amount: number;
  unit_id: ServingUnit;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  saturated_fat_g: number | null;
  trans_fat_g: number | null;
  sugars_g: number | null;
  calories_from_fat: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
  description: string;
  keywords: string[];
  sourceCustomFoodId?: number;
  /** Entry ID from search_food_log results when the user asks to edit an existing entry. */
  editingEntryId?: number;
  /** Date in YYYY-MM-DD format. For edits: original entry date. For new entries: explicit user date or undefined (today). */
  date?: string | null;
  /** Meal time suggested by Claude in HH:mm format. Only set when user explicitly mentions time. */
  time?: string | null;
  /** Fitbit meal type ID (1-7, no 6) suggested by Claude. Only set when user mentions meal context. */
  mealTypeId?: number | null;
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
  zoneOffset?: string; // ±HH:MM (client UTC offset)
  reuseCustomFoodId?: number;
  // Optional metadata updates when reusing a custom food
  newDescription?: string;
  newNotes?: string;
  newKeywords?: string[];
  newConfidence?: "high" | "medium" | "low";
}

export interface FoodLogResponse {
  success: boolean;
  healthLogId?: string;
  reusedFood: boolean;
  foodLogId?: number;
  dryRun?: boolean;
  error?: string;
}

export enum MealType {
  Breakfast = 1,
  MorningSnack = 2,
  Lunch = 3,
  AfternoonSnack = 4,
  Dinner = 5,
  Anytime = 7,
}

export type HealthConnectionStatus =
  | { status: "needs_reconnect" }
  | { status: "scope_mismatch"; missingScopes: string[] }
  | { status: "healthy" };

export type ErrorCode =
  | "AUTH_INVALID_EMAIL"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_MISSING_SESSION"
  | "HEALTH_NOT_CONNECTED"
  | "HEALTH_TOKEN_INVALID"
  | "HEALTH_SCOPE_MISSING"
  | "HEALTH_RATE_LIMIT"
  | "HEALTH_RATE_LIMIT_LOW"
  | "HEALTH_TIMEOUT"
  | "HEALTH_REFRESH_TRANSIENT"
  | "HEALTH_TOKEN_SAVE_FAILED"
  | "HEALTH_API_ERROR"
  | "NOT_FOUND"
  | "PARTIAL_ERROR"
  | "CLAUDE_API_ERROR"
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

export const MEAL_TYPE_LABELS: Record<number, string> = {
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
  unitId: ServingUnit;
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
  mealTypeId: number;
  isFavorite: boolean;
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
  customFoodId: number;
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
  unitId: ServingUnit;
  mealTypeId: number;
  date: string;
  time: string | null;
  healthLogId: string | null;
  isFavorite: boolean;
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
  matchRatio: number;
  lastLoggedAt: Date;
  amount: number;
  unitId: ServingUnit;
}

export interface FoodLogEntryDetail {
  id: number;
  customFoodId: number;
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
  unitId: ServingUnit;
  mealTypeId: number;
  date: string;
  time: string | null;
  healthLogId: string | null;
  confidence: string;
  isFavorite: boolean;
  keywords: string[];
}

export interface MealEntry {
  id: number;
  customFoodId: number;
  foodName: string;
  time: string | null;
  zoneOffset: string | null;
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
  amount: number;
  unitId: ServingUnit;
  isFavorite: boolean;
  healthLogId: string | null;
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

export interface ActivitySummary {
  caloriesOut: number | null;
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

export interface NutritionLabel {
  id: number;
  userId: string;
  brand: string;
  productName: string;
  variant: string | null;
  servingSizeG: number;
  servingSizeLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number | null;
  transFatG: number | null;
  sugarsG: number | null;
  extraNutrients: Record<string, number> | null;
  source: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NutritionLabelInput {
  brand: string;
  productName: string;
  variant: string | null;
  servingSizeG: number;
  servingSizeLabel: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number | null;
  transFatG: number | null;
  sugarsG: number | null;
  extraNutrients: Record<string, number> | null;
  source: string;
  notes: string | null;
}

export type NutritionLabelSearchResult = NutritionLabel;

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[];
  analysis?: FoodAnalysis;
  sessionItems?: FoodAnalysis[];
  isThinking?: boolean;
}

export interface CaptureItem {
  id: string;
  imageCount: number;
  note: string | null;
  capturedAt: string;
  order: number;
}

export interface CaptureSession {
  id: string;
  captures: CaptureItem[];
  createdAt: string;
}

export interface ChatCapturesRequest {
  messages: ConversationMessage[];
  initialItems?: FoodAnalysis[];
}

export interface ChatFoodRequest {
  messages: ConversationMessage[];
  initialAnalysis?: FoodAnalysis;
}

export interface ChatFoodResponse {
  message: string;
  analysis?: FoodAnalysis;
}

export interface GlucoseReading {
  id: number;
  measuredAt: string;
  zoneOffset: string | null;
  valueMgDl: number;
  relationToMeal: string | null;
  mealType: string | null;
  specimenSource: string | null;
}

export interface BloodPressureReading {
  id: number;
  measuredAt: string;
  zoneOffset: string | null;
  systolic: number;
  diastolic: number;
  bodyPosition: string | null;
  measurementLocation: string | null;
}

export interface SavedAnalysisListItem {
  id: number;
  description: string;
  calories: number;
  createdAt: string;
}

export interface GlucoseReadingInput {
  measuredAt: string;
  zoneOffset: string | null;
  valueMgDl: number;
  relationToMeal: string | null;
  mealType: string | null;
  specimenSource: string | null;
}

export interface BloodPressureReadingInput {
  measuredAt: string;
  zoneOffset: string | null;
  systolic: number;
  diastolic: number;
  bodyPosition: string | null;
  measurementLocation: string | null;
}

export interface HydrationReading {
  id: number;
  measuredAt: string;
  zoneOffset: string | null;
  volumeMl: number;
}

export interface HydrationReadingInput {
  measuredAt: string;
  zoneOffset: string | null;
  volumeMl: number;
}

export interface SavedAnalysisDetail extends SavedAnalysisListItem {
  foodAnalysis: FoodAnalysis;
}

export interface HealthProfileData {
  ageYears: number;
  sex: "MALE" | "FEMALE" | "NA";
  heightCm: number;
  weightKg: number | null;
  weightLoggedDate: string | null;
  goalType: "LOSE" | "MAINTAIN" | "GAIN" | null;
  lastSyncedAt: number;
}

export interface HealthProfile {
  ageYears: number;
  sex: "MALE" | "FEMALE" | "NA";
  heightCm: number;
}

export interface HealthWeightLog {
  weightKg: number;
  loggedDate: string;
}

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "very_active"
  | "extra_active";

export interface MacroEngineInputs {
  sex: "MALE" | "FEMALE" | "NA";
  ageYears: number;
  heightCm: number;
  currentWeightKg: number;
  activityLevel: ActivityLevel;
  goalWeightKg: number;
  goalRateKgPerWeek: number;
}

export interface MacroEngineOutputs {
  targetKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  rmr: number;
  palMultiplier: number;
  tdee: number;
  deficitKcal: number;
  direction: "LOSE" | "MAINTAIN" | "GAIN";
}

export interface NutritionGoalsAudit {
  rmr: number;
  palMultiplier: number;
  tdee: number;
  weightKg: string;
  weightLoggedDate: string | null;
  activityLevel: ActivityLevel;
  goalWeightKg: number;
  goalRateKgPerWeek: number;
  deficitKcal: number;
  direction: "LOSE" | "MAINTAIN" | "GAIN";
}

export interface NutritionGoals {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  status: "ok" | "blocked";
  reason?:
    | "no_weight"
    | "sex_unset"
    | "scope_mismatch"
    | "invalid_profile"
    | "goals_not_set";
  audit?: NutritionGoalsAudit;
  /** True when the health weight log used was logged > 7 days before the target date (FOO-1010). */
  weightStale?: boolean;
}
