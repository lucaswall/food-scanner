import * as Sentry from "@sentry/nextjs";
import type { FoodAnalysis } from "@/types";
import { logger, startTimer } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getFitbitTokens, upsertFitbitTokens } from "@/lib/fitbit-tokens";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";
import {
  assertRateLimitAllowed,
  getRateLimitSnapshot,
  recordRateLimitHeaders,
  type FitbitCallCriticality,
} from "@/lib/fitbit-rate-limit";

export type { FitbitCallCriticality } from "@/lib/fitbit-rate-limit";

const FITBIT_API_BASE = "https://api.fitbit.com";
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 10000;
const DEADLINE_MS = 30000;
const RATE_LIMIT_NO_HEADER_DELAY_MS = 1000;

/**
 * Parse a Fitbit `Retry-After` header value (RFC 7231 — integer seconds OR HTTP-date)
 * into milliseconds. Returns null if the value is missing or malformed.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();

  // Integer seconds
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  // HTTP-date — Date.parse returns NaN for invalid input
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, Math.ceil(dateMs - Date.now()));
}

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
  userId?: string,
  criticality: FitbitCallCriticality = "optional",
): Promise<Response> {
  const elapsed = Date.now() - startTime;
  if (elapsed > DEADLINE_MS) {
    throw new Error("FITBIT_TIMEOUT");
  }

  // Circuit breaker: reject before burning a request when budget is too low.
  // Only check on the FIRST attempt (retryCount === 0) — once we've already
  // committed to a 429-retry sleep, the headroom decision was made.
  if (userId && retryCount === 0) {
    assertRateLimitAllowed(userId, criticality, l);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    // Always parse rate-limit headers first so even error responses (including 429)
    // update the per-user headroom snapshot.
    recordRateLimitHeaders(userId, response, l);

    if (userId) {
      const snap = getRateLimitSnapshot(userId);
      Sentry.addBreadcrumb({
        category: "fitbit",
        level: "info",
        message: "fitbit api call",
        data: {
          url,
          status: response.status,
          remaining: snap?.remaining ?? null,
        },
      });
    }

    if (response.status === 401) {
      throw new Error("FITBIT_TOKEN_INVALID");
    }

    if (response.status === 403) {
      throw new Error("FITBIT_SCOPE_MISSING");
    }

    if (response.status === 429) {
      // Allow at most 1 retry on 429 (per FOO-1011). Each retry burns budget,
      // so amplifying retries during a rate-limit event makes things worse.
      if (retryCount >= 1) {
        throw new Error("FITBIT_RATE_LIMIT");
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      const deadlineRemaining = DEADLINE_MS - (Date.now() - startTime);

      if (retryAfterMs !== null) {
        if (retryAfterMs > deadlineRemaining) {
          l.warn(
            {
              action: "fitbit_rate_limit_no_retry",
              retryAfterMs,
              deadlineRemaining,
            },
            "rate limited; Retry-After exceeds deadline, giving up",
          );
          throw new Error("FITBIT_RATE_LIMIT");
        }

        l.warn(
          { action: "fitbit_rate_limit", retryAfterMs, source: "header" },
          "rate limited, sleeping per Retry-After header",
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      } else {
        l.warn(
          { action: "fitbit_rate_limit", retryAfterMs: RATE_LIMIT_NO_HEADER_DELAY_MS, source: "default" },
          "rate limited (no Retry-After), brief retry",
        );
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_NO_HEADER_DELAY_MS));
      }

      return fetchWithRetry(url, options, retryCount + 1, startTime, l, userId, criticality);
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
      return fetchWithRetry(url, options, retryCount + 1, startTime, l, userId, criticality);
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
  userId?: string,
): Promise<CreateFoodResponse> {
  const l = log ?? logger;
  const elapsed = startTimer();
  l.debug(
    { action: "fitbit_create_food", foodName: food.food_name },
    "creating food",
  );

  const params = new URLSearchParams({
    name: food.food_name,
    defaultFoodMeasurementUnitId: food.unit_id.toString(),
    defaultServingSize: food.amount.toString(),
    calories: Math.round(food.calories).toString(),
    protein: food.protein_g.toString(),
    totalCarbohydrate: food.carbs_g.toString(),
    totalFat: food.fat_g.toString(),
    dietaryFiber: food.fiber_g.toString(),
    sodium: Math.round(food.sodium_mg).toString(),
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
    params.set("caloriesFromFat", Math.round(food.calories_from_fat).toString());
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
    0, Date.now(), l, userId, "critical",
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
  l.info({ action: "fitbit_create_food_success", foodName: food.food_name, durationMs: elapsed() }, "food created on Fitbit");
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
  userId?: string,
): Promise<LogFoodResponse> {
  const l = log ?? logger;
  const elapsed = startTimer();
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
    0, Date.now(), l, userId, "critical",
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
  l.info({ action: "fitbit_log_food_success", foodId, date, durationMs: elapsed() }, "food logged on Fitbit");
  return data as unknown as LogFoodResponse;
}

export async function deleteFoodLog(
  accessToken: string,
  fitbitLogId: number,
  log?: Logger,
  userId?: string,
): Promise<void> {
  const l = log ?? logger;
  const elapsed = startTimer();
  l.debug(
    { action: "fitbit_delete_food_log", fitbitLogId },
    "deleting food log",
  );

  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/foods/log/${fitbitLogId}.json`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    0, Date.now(), l, userId, "critical",
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
  l.info({ action: "fitbit_delete_food_log_success", fitbitLogId, durationMs: elapsed() }, "food log deleted from Fitbit");
}

export async function findOrCreateFood(
  accessToken: string,
  food: FoodAnalysis,
  log?: Logger,
  userId?: string,
): Promise<FindOrCreateResult> {
  const l = log ?? logger;
  l.debug(
    { action: "fitbit_create_food_entry", foodName: food.food_name },
    "creating food entry",
  );

  const createResult = await createFood(accessToken, food, l, userId);
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

export const FITBIT_REQUIRED_SCOPES = ["nutrition", "activity", "profile", "weight"] as const;

export function buildFitbitAuthUrl(
  state: string,
  redirectUri: string,
  clientId: string,
  options?: { forceConsent?: boolean },
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FITBIT_REQUIRED_SCOPES.join(" "),
    state,
  });

  if (options?.forceConsent) {
    params.set("prompt", "consent");
  }

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
  scope: string;
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
    if (typeof data.scope !== "string") {
      throw new Error("Invalid Fitbit token response: missing scope");
    }
    return { access_token: data.access_token, refresh_token: data.refresh_token, user_id: data.user_id, expires_in: data.expires_in, scope: data.scope };
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
  const elapsed = startTimer();
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
    l.info({ action: "fitbit_token_refresh_success", durationMs: elapsed() }, "fitbit token refreshed");
    return { access_token: data.access_token, refresh_token: data.refresh_token, user_id: data.user_id, expires_in: data.expires_in };
  } finally {
    clearTimeout(timeoutId);
  }
}

const refreshInFlight = new Map<string, Promise<string>>();

export async function ensureFreshToken(userId: string, log?: Logger): Promise<string> {
  const l = log ?? logger;
  const credentials = await getFitbitCredentials(userId, l);
  if (!credentials) {
    throw new Error("FITBIT_CREDENTIALS_MISSING");
  }

  const tokenRow = await getFitbitTokens(userId, l);
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
        const tokens = await refreshFitbitToken(tokenRow.refreshToken, credentials, l);
        const tokenData = {
          fitbitUserId: tokens.user_id,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          scope: tokenRow.scope,
        };

        // Try to save tokens with retry logic (FOO-430)
        try {
          await upsertFitbitTokens(userId, tokenData, l);
        } catch (upsertError) {
          l.warn(
            {
              action: "fitbit_token_upsert_warn",
              error: upsertError instanceof Error ? upsertError.message : String(upsertError),
            },
            "fitbit token upsert failed, retrying once",
          );
          // Retry once
          try {
            await upsertFitbitTokens(userId, tokenData, l);
          } catch (retryError) {
            l.error(
              {
                action: "fitbit_token_upsert_failed",
                error: retryError instanceof Error ? retryError.message : String(retryError),
              },
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

function subtractDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function getFitbitProfile(
  accessToken: string,
  log?: Logger,
  userId?: string,
  criticality: FitbitCallCriticality = "optional",
): Promise<import("@/types").FitbitProfile> {
  const l = log ?? logger;
  const elapsed = startTimer();
  l.debug({ action: "fitbit_get_profile" }, "fetching Fitbit profile");

  // No Accept-Language header — Fitbit defaults to METRIC (cm, kg). Sending
  // en_US would return inches/pounds, which we'd then mislabel as cm/kg.
  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/profile.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "fitbit_get_profile_failed", status: response.status, errorBody }, "profile fetch failed");
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const user = data.user as Record<string, unknown> | undefined;

  if (typeof user?.age !== "number") {
    throw new Error("Invalid Fitbit profile response: missing user.age");
  }
  if (typeof user?.gender !== "string") {
    throw new Error("Invalid Fitbit profile response: missing user.gender");
  }
  if (typeof user?.height !== "number") {
    throw new Error("Invalid Fitbit profile response: missing user.height");
  }

  const validSexValues = ["MALE", "FEMALE", "NA"] as const;
  if (!validSexValues.includes(user.gender as "MALE" | "FEMALE" | "NA")) {
    throw new Error(`Invalid Fitbit profile response: unknown gender "${user.gender}"`);
  }

  l.debug({ action: "fitbit_get_profile_success", durationMs: elapsed() }, "profile fetched");
  return {
    ageYears: user.age,
    sex: user.gender as "MALE" | "FEMALE" | "NA",
    heightCm: user.height,
  };
}

export async function getFitbitLatestWeightKg(
  accessToken: string,
  targetDate: string,
  log?: Logger,
  userId?: string,
  criticality: FitbitCallCriticality = "optional",
): Promise<import("@/types").FitbitWeightLog | null> {
  const l = log ?? logger;
  const elapsed = startTimer();
  l.debug({ action: "fitbit_get_weight", targetDate }, "fetching latest weight");

  // Single shared deadline across all 14 walk-back days — without this, each
  // iteration would get its own 30s budget (420s worst case).
  const walkbackStart = Date.now();

  for (let daysBack = 0; daysBack < 14; daysBack++) {
    const date = subtractDays(targetDate, daysBack);

    // No Accept-Language header — Fitbit defaults to METRIC (kg). en_US would return pounds.
    const response = await fetchWithRetry(
      `${FITBIT_API_BASE}/1/user/-/body/log/weight/date/${date}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      0, walkbackStart, l, userId, criticality,
    );

    if (!response.ok) {
      const rawBody = await parseErrorBody(response);
      const errorBody = sanitizeErrorBody(rawBody);
      l.warn(
        { action: "fitbit_get_weight_day_failed", status: response.status, errorBody, date },
        "weight fetch failed for date, continuing walk-back",
      );
      continue;
    }

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    const weights = data.weight as Array<Record<string, unknown>> | undefined;

    if (Array.isArray(weights) && weights.length > 0) {
      const entry = weights[0];
      if (typeof entry.weight !== "number") {
        throw new Error("Invalid Fitbit weight response: missing weight value");
      }
      if (typeof entry.date !== "string") {
        throw new Error("Invalid Fitbit weight response: missing date");
      }
      l.debug({ action: "fitbit_get_weight_success", date, durationMs: elapsed() }, "weight fetched");
      return { weightKg: entry.weight, loggedDate: entry.date };
    }
  }

  l.debug({ action: "fitbit_get_weight_not_found", targetDate, durationMs: elapsed() }, "no weight found in past 7 days");
  return null;
}

export async function getFitbitWeightGoal(
  accessToken: string,
  log?: Logger,
  userId?: string,
  criticality: FitbitCallCriticality = "optional",
): Promise<import("@/types").FitbitWeightGoal | null> {
  const l = log ?? logger;
  const elapsed = startTimer();
  l.debug({ action: "fitbit_get_weight_goal" }, "fetching weight goal");

  // No Accept-Language header — keeps weight units consistent with profile/weight-log
  // calls (defaults to METRIC). We currently only read goalType, but staying metric
  // future-proofs any future reads of startWeight/weight/goal.
  const response = await fetchWithRetry(
    `${FITBIT_API_BASE}/1/user/-/body/log/weight/goal.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "fitbit_get_weight_goal_failed", status: response.status, errorBody }, "weight goal fetch failed");
    throw new Error("FITBIT_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const goal = data.goal as Record<string, unknown> | undefined;

  if (!goal || typeof goal.goalType !== "string") {
    l.debug({ action: "fitbit_get_weight_goal_not_set", durationMs: elapsed() }, "weight goal not set");
    return null;
  }

  const validGoalTypes = ["LOSE", "MAINTAIN", "GAIN"] as const;
  if (!validGoalTypes.includes(goal.goalType as "LOSE" | "MAINTAIN" | "GAIN")) {
    throw new Error(`Invalid Fitbit weight goal response: unknown goalType "${goal.goalType}"`);
  }

  l.debug({ action: "fitbit_get_weight_goal_success", durationMs: elapsed() }, "weight goal fetched");
  return { goalType: goal.goalType as "LOSE" | "MAINTAIN" | "GAIN" };
}

export async function getActivitySummary(
  accessToken: string,
  date: string,
  log?: Logger,
  userId?: string,
  criticality: FitbitCallCriticality = "optional",
): Promise<import("@/types").ActivitySummary> {
  const l = log ?? logger;
  const elapsed = startTimer();
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
    0, Date.now(), l, userId, criticality,
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
    l.debug({ action: "fitbit_get_activity_summary_no_calories_out", durationMs: elapsed() }, "activity summary fetched (no caloriesOut yet)");
    return { caloriesOut: null };
  }

  l.debug({ action: "fitbit_get_activity_summary_success", durationMs: elapsed() }, "activity summary fetched");
  return {
    caloriesOut: summary.caloriesOut,
  };
}
