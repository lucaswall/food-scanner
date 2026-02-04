export interface SessionData {
  sessionId: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  fitbit?: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    expiresAt: number;
  };
}

export interface FoodAnalysis {
  food_name: string;
  portion_size_g: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  sodium_mg: number;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export interface FoodLogRequest extends FoodAnalysis {
  mealTypeId: number; // 1,2,3,4,5,7
  date?: string; // YYYY-MM-DD
  time?: string; // HH:mm:ss
}

export interface FoodLogResponse {
  success: boolean;
  fitbitFoodId: number;
  fitbitLogId: number;
  reusedFood: boolean;
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
  | "VALIDATION_ERROR";

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
