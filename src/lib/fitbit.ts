import type { FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { getFitbitTokens, upsertFitbitTokens } from "@/lib/fitbit-tokens";

const FITBIT_API_BASE = "https://api.fitbit.com";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10000;
const DEADLINE_MS = 30000;

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

export function sanitizeErrorBody(body: unknown): unknown {
  if (typeof body === "string") {
    return body.replace(/<[^>]*>/g, "").slice(0, 500);
  }
  return body;
}

export async function parseErrorBody(response: Response): Promise<unknown> {
  const bodyText = await response.text().catch(() => "unable to read body");
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export async function jsonWithTimeout<T>(response: Response, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const jsonPromise = response.json().then((v) => v as T);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Response body read timed out")), timeoutMs);
  });
  // Attach noop catch handlers to prevent unhandled rejection from losing promise
  jsonPromise.catch(() => {});
  timeoutPromise.catch(() => {});
  try {
    return await Promise.race([jsonPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount = 0,
  startTime = Date.now(),
): Promise<Response> {
  const elapsed = Date.now() - startTime;
  if (elapsed > DEADLINE_MS) {
    throw new Error("FITBIT_TIMEOUT");
  }

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
      return fetchWithRetry(url, options, retryCount + 1, startTime);
    }

    if (response.status >= 500) {
      if (retryCount >= MAX_RETRIES) {
        return response;
      }
      const delay = Math.pow(2, retryCount) * 1000;
      logger.warn(
        { action: "fitbit_server_error", status: response.status, retryCount, delay },
        "server error, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, startTime);
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
    dietaryFiber: food.fiber_g.toString(),
    sodium: food.sodium_mg.toString(),
    formType: "DRY",
    description: food.food_name,
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
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    logger.error(
      { action: "fitbit_create_food_failed", status: response.status, errorBody },
      "food creation failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const foodEntry = data.food as Record<string, unknown> | undefined;
  if (typeof foodEntry?.foodId !== "number") {
    throw new Error("Invalid Fitbit create food response: missing food.foodId");
  }
  return data as unknown as CreateFoodResponse;
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
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    logger.error(
      { action: "fitbit_log_food_failed", status: response.status, errorBody },
      "food logging failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const foodLog = data.foodLog as Record<string, unknown> | undefined;
  if (typeof foodLog?.logId !== "number") {
    throw new Error("Invalid Fitbit log food response: missing foodLog.logId");
  }
  return data as unknown as LogFoodResponse;
}

export async function deleteFoodLog(
  accessToken: string,
  fitbitLogId: number,
): Promise<void> {
  logger.debug(
    { action: "fitbit_delete_food_log", fitbitLogId },
    "deleting food log",
  );

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/food/log/${fitbitLogId}.json`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.status === 404) {
    logger.warn(
      { action: "fitbit_delete_food_log_not_found", fitbitLogId },
      "food log not found on Fitbit, treating as already deleted",
    );
    return;
  }

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    logger.error(
      { action: "fitbit_delete_food_log_failed", status: response.status, errorBody },
      "food log deletion failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }
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

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
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
    return { access_token: data.access_token, refresh_token: data.refresh_token, user_id: data.user_id, expires_in: data.expires_in };
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

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
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
    return { access_token: data.access_token, refresh_token: data.refresh_token, user_id: data.user_id, expires_in: data.expires_in };
  } finally {
    clearTimeout(timeoutId);
  }
}

const refreshInFlight = new Map<string, Promise<string>>();

export async function ensureFreshToken(userId: string): Promise<string> {
  const tokenRow = await getFitbitTokens(userId);
  if (!tokenRow) {
    throw new Error("FITBIT_TOKEN_INVALID");
  }

  // If token expires within 1 hour, refresh it
  if (tokenRow.expiresAt.getTime() < Date.now() + 60 * 60 * 1000) {
    const existing = refreshInFlight.get(userId);
    if (existing) {
      return existing;
    }

    const promise = (async () => {
      try {
        const tokens = await refreshFitbitToken(tokenRow.refreshToken);
        await upsertFitbitTokens(userId, {
          fitbitUserId: tokens.user_id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        });
        return tokens.access_token;
      } finally {
        refreshInFlight.delete(userId);
      }
    })();

    refreshInFlight.set(userId, promise);
    return promise;
  }

  return tokenRow.accessToken;
}
