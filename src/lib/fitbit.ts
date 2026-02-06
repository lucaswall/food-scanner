import type { SessionData, FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";

const FITBIT_API_BASE = "https://api.fitbit.com";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10000;

interface CreateFoodResponse {
  food: {
    foodId: number;
    name: string;
  };
}

interface LogFoodResponse {
  foodLog: {
    logId: number;
    loggedFood: {
      foodId: number;
    };
  };
}

interface FindOrCreateResult {
  foodId: number;
  reused: boolean;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount = 0,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new Error("FITBIT_TOKEN_INVALID");
    }

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new Error("FITBIT_RATE_LIMIT");
      }
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      logger.warn(
        { action: "fitbit_rate_limit", retryCount, delay },
        "rate limited, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createFood(
  accessToken: string,
  food: FoodAnalysis,
): Promise<CreateFoodResponse> {
  logger.debug(
    { action: "fitbit_create_food", foodName: food.food_name },
    "creating food",
  );

  const params = new URLSearchParams({
    name: food.food_name,
    defaultFoodMeasurementUnitId: food.unit_id.toString(),
    defaultServingSize: food.amount.toString(),
    calories: food.calories.toString(),
    protein: food.protein_g.toString(),
    totalCarbohydrate: food.carbs_g.toString(),
    totalFat: food.fat_g.toString(),
    fiber: food.fiber_g.toString(),
    sodium: food.sodium_mg.toString(),
  });

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/foods.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "unable to read body");
    let errorBody: unknown;
    try {
      errorBody = JSON.parse(bodyText);
    } catch {
      errorBody = bodyText;
    }
    logger.error(
      { action: "fitbit_create_food_failed", status: response.status, errorBody },
      "food creation failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await response.json();
  if (typeof data.food?.foodId !== "number") {
    throw new Error("Invalid Fitbit create food response: missing food.foodId");
  }
  return data as CreateFoodResponse;
}

export async function logFood(
  accessToken: string,
  foodId: number,
  mealTypeId: number,
  amount: number,
  unitId: number,
  date: string,
  time?: string,
): Promise<LogFoodResponse> {
  logger.debug(
    { action: "fitbit_log_food", foodId, mealTypeId, amount, unitId, date },
    "logging food",
  );

  const params = new URLSearchParams({
    foodId: foodId.toString(),
    mealTypeId: mealTypeId.toString(),
    unitId: unitId.toString(),
    amount: amount.toString(),
    date,
  });

  if (time) {
    params.append("time", time);
  }

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/foods/log.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "unable to read body");
    let errorBody: unknown;
    try {
      errorBody = JSON.parse(bodyText);
    } catch {
      errorBody = bodyText;
    }
    logger.error(
      { action: "fitbit_log_food_failed", status: response.status, errorBody },
      "food logging failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await response.json();
  if (typeof data.foodLog?.logId !== "number") {
    throw new Error("Invalid Fitbit log food response: missing foodLog.logId");
  }
  return data as LogFoodResponse;
}

export async function findOrCreateFood(
  accessToken: string,
  food: FoodAnalysis,
): Promise<FindOrCreateResult> {
  logger.debug(
    { action: "fitbit_create_food_entry", foodName: food.food_name },
    "creating food entry",
  );

  const createResult = await createFood(accessToken, food);
  logger.info(
    { action: "fitbit_food_created", foodId: createResult.food.foodId },
    "created new food",
  );
  return { foodId: createResult.food.foodId, reused: false };
}

export function buildFitbitAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getRequiredEnv("FITBIT_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "nutrition",
    state,
  });

  return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeFitbitCode(
  code: string,
  redirectUri: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(
    `${getRequiredEnv("FITBIT_CLIENT_ID")}:${getRequiredEnv("FITBIT_CLIENT_SECRET")}`,
  ).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(
        { action: "fitbit_token_exchange_failed", status: response.status, statusText: response.statusText },
        "fitbit token exchange http failure",
      );
      throw new Error(`Fitbit token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Fitbit token response: missing access_token");
    }
    if (typeof data.refresh_token !== "string") {
      throw new Error("Invalid Fitbit token response: missing refresh_token");
    }
    if (typeof data.user_id !== "string") {
      throw new Error("Invalid Fitbit token response: missing user_id");
    }
    if (typeof data.expires_in !== "number") {
      throw new Error("Invalid Fitbit token response: missing expires_in");
    }
    return data as { access_token: string; refresh_token: string; user_id: string; expires_in: number };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function refreshFitbitToken(
  refreshToken: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  logger.debug({ action: "fitbit_token_refresh_start" }, "refreshing fitbit token");

  const credentials = Buffer.from(
    `${getRequiredEnv("FITBIT_CLIENT_ID")}:${getRequiredEnv("FITBIT_CLIENT_SECRET")}`,
  ).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(
        { action: "fitbit_token_refresh_failed", status: response.status, statusText: response.statusText },
        "fitbit token refresh http failure",
      );
      throw new Error("FITBIT_TOKEN_INVALID");
    }

    const data = await response.json();
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Fitbit token response: missing access_token");
    }
    if (typeof data.refresh_token !== "string") {
      throw new Error("Invalid Fitbit token response: missing refresh_token");
    }
    if (typeof data.user_id !== "string") {
      throw new Error("Invalid Fitbit token response: missing user_id");
    }
    if (typeof data.expires_in !== "number") {
      throw new Error("Invalid Fitbit token response: missing expires_in");
    }
    return data as { access_token: string; refresh_token: string; user_id: string; expires_in: number };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ensureFreshToken(
  session: SessionData & { save: () => Promise<void> },
): Promise<string> {
  if (!session.fitbit) {
    throw new Error("FITBIT_TOKEN_INVALID");
  }

  // If token expires within 1 hour, refresh it
  if (session.fitbit.expiresAt < Date.now() + 60 * 60 * 1000) {
    const tokens = await refreshFitbitToken(session.fitbit.refreshToken);
    session.fitbit = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      userId: tokens.user_id,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await session.save();
  }

  return session.fitbit.accessToken;
}
