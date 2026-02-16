import type { FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getFitbitTokens, upsertFitbitTokens } from "@/lib/fitbit-tokens";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";

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
  l: Logger = logger,
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

    if (response.status === 403) {
      throw new Error("FITBIT_SCOPE_MISSING");
    }

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        throw new Error("FITBIT_RATE_LIMIT");
      }
      const delay = Math.pow(2, retryCount) * 1000; // 1s, 2s, 4s
      l.warn(
        { action: "fitbit_rate_limit", retryCount, delay },
        "rate limited, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, startTime, l);
    }

    if (response.status >= 500) {
      if (retryCount >= MAX_RETRIES) {
        return response;
      }
      const delay = Math.pow(2, retryCount) * 1000;
      l.warn(
        { action: "fitbit_server_error", status: response.status, retryCount, delay },
        "server error, retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retryCount + 1, startTime, l);
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createFood(
  accessToken: string,
  food: FoodAnalysis,
  log?: Logger,
): Promise<CreateFoodResponse> {
  const l = log ?? logger;
  l.debug(
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

  // Conditionally add Tier 1 nutrients if present and not null
  if (food.saturated_fat_g != null) {
    params.set("saturatedFat", food.saturated_fat_g.toString());
  }
  if (food.trans_fat_g != null) {
    params.set("transFat", food.trans_fat_g.toString());
  }
  if (food.sugars_g != null) {
    params.set("sugars", food.sugars_g.toString());
  }
  if (food.calories_from_fat != null) {
    params.set("caloriesFromFat", food.calories_from_fat.toString());
  }

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
    0, Date.now(), l,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
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
  log?: Logger,
): Promise<LogFoodResponse> {
  const l = log ?? logger;
  l.debug(
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
    0, Date.now(), l,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
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
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  l.debug(
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
    0, Date.now(), l,
  );

  if (response.status === 404) {
    l.warn(
      { action: "fitbit_delete_food_log_not_found", fitbitLogId },
      "food log not found on Fitbit, treating as already deleted",
    );
    return;
  }

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "fitbit_delete_food_log_failed", status: response.status, errorBody },
      "food log deletion failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }
}

export async function findOrCreateFood(
  accessToken: string,
  food: FoodAnalysis,
  log?: Logger,
): Promise<FindOrCreateResult> {
  const l = log ?? logger;
  l.debug(
    { action: "fitbit_create_food_entry", foodName: food.food_name },
    "creating food entry",
  );

  const createResult = await createFood(accessToken, food, l);
  l.info(
    { action: "fitbit_food_created", foodId: createResult.food.foodId },
    "created new food",
  );
  return { foodId: createResult.food.foodId, reused: false };
}

export interface FitbitClientCredentials {
  clientId: string;
  clientSecret: string;
}

export function buildFitbitAuthUrl(state: string, redirectUri: string, clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "nutrition activity",
    state,
  });

  return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeFitbitCode(
  code: string,
  redirectUri: string,
  credentials: FitbitClientCredentials,
  log?: Logger,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  const l = log ?? logger;
  const authHeader = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
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
      l.error(
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
  credentials: FitbitClientCredentials,
  log?: Logger,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  const l = log ?? logger;
  l.debug({ action: "fitbit_token_refresh_start" }, "refreshing fitbit token");

  const authHeader = Buffer.from(
    `${credentials.clientId}:${credentials.clientSecret}`,
  ).toString("base64");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.fitbit.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${authHeader}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      l.error(
        { action: "fitbit_token_refresh_failed", status: response.status, statusText: response.statusText },
        "fitbit token refresh http failure",
      );
      // Classify errors: 400/401 = invalid token, 429/5xx = transient
      if (response.status === 400 || response.status === 401) {
        throw new Error("FITBIT_TOKEN_INVALID");
      }
      throw new Error("FITBIT_REFRESH_TRANSIENT");
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

export async function ensureFreshToken(userId: string, log?: Logger): Promise<string> {
  const l = log ?? logger;
  const credentials = await getFitbitCredentials(userId);
  if (!credentials) {
    throw new Error("FITBIT_CREDENTIALS_MISSING");
  }

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
        const tokens = await refreshFitbitToken(tokenRow.refreshToken, credentials);
        const tokenData = {
          fitbitUserId: tokens.user_id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        };

        // Try to save tokens with retry logic (FOO-430)
        try {
          await upsertFitbitTokens(userId, tokenData);
        } catch (upsertError) {
          l.warn(
            { error: upsertError instanceof Error ? upsertError.message : String(upsertError) },
            "fitbit token upsert failed, retrying once",
          );
          // Retry once
          try {
            await upsertFitbitTokens(userId, tokenData);
          } catch (retryError) {
            l.error(
              { error: retryError instanceof Error ? retryError.message : String(retryError) },
              "fitbit token upsert retry failed",
            );
            throw new Error("FITBIT_TOKEN_SAVE_FAILED");
          }
        }

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

export async function getFoodGoals(
  accessToken: string,
  log?: Logger,
): Promise<import("@/types").NutritionGoals> {
  const l = log ?? logger;
  l.debug(
    { action: "fitbit_get_food_goals" },
    "fetching food goals",
  );

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/foods/log/goal.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    0, Date.now(), l,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "fitbit_get_food_goals_failed", status: response.status, errorBody },
      "food goals fetch failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const goals = data.goals as Record<string, unknown> | undefined;
  if (typeof goals?.calories !== "number") {
    return { calories: null };
  }

  return { calories: goals.calories };
}

export async function getActivitySummary(
  accessToken: string,
  date: string,
  log?: Logger,
): Promise<import("@/types").ActivitySummary> {
  const l = log ?? logger;
  l.debug(
    { action: "fitbit_get_activity_summary", date },
    "fetching activity summary",
  );

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/activities/date/${date}.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    0, Date.now(), l,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "fitbit_get_activity_summary_failed", status: response.status, errorBody },
      "activity summary fetch failed",
    );
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const summary = data.summary as Record<string, unknown> | undefined;
  if (typeof summary?.caloriesOut !== "number") {
    throw new Error("FITBIT_API_ERROR");
  }

  return {
    caloriesOut: summary.caloriesOut,
  };
}
