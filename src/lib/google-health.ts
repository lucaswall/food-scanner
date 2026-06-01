import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getHealthTokens, upsertHealthTokens } from "@/lib/health-tokens";
import {
  assertRateLimitAllowed,
  recordRateLimitHeaders,
  type HealthCallCriticality,
} from "@/lib/google-health-rate-limit";
import {
  REQUEST_TIMEOUT_MS,
  parseErrorBody,
  sanitizeErrorBody,
  jsonWithTimeout,
} from "@/lib/http";
import type { FoodAnalysis, HealthProfile, HealthWeightLog, ActivitySummary } from "@/types";

export type { HealthCallCriticality } from "@/lib/google-health-rate-limit";
export { parseErrorBody, sanitizeErrorBody, jsonWithTimeout };

const GOOGLE_HEALTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_RETRIES = 3;
const DEADLINE_MS = 30_000;
const RATE_LIMIT_NO_HEADER_DELAY_MS = 1_000;

/**
 * If the token expires within this window, we treat it as near-expired and
 * proactively refresh it. Mirrors the 1-hour window used by fitbit.ts.
 */
const TOKEN_EXPIRY_SKEW_MS = 60 * 60 * 1000;

/**
 * Parse a Retry-After header value (RFC 7231 — integer seconds OR HTTP-date)
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

/**
 * Fetch with retry logic tailored for Google Health / Google Cloud APIs.
 *
 * - Checks the DEADLINE_MS budget at the start of each attempt.
 * - Runs the rate-limit circuit breaker on the first attempt only.
 * - Maps 401 → HEALTH_TOKEN_INVALID, 403 → HEALTH_SCOPE_MISSING.
 * - Allows at most 1 retry on 429 (sleeping per Retry-After if present).
 * - Exponential back-off on 5xx (up to MAX_RETRIES).
 * - Each individual request is guarded by REQUEST_TIMEOUT_MS via AbortController.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retryCount = 0,
  startTime = Date.now(),
  l: Logger = logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<Response> {
  const elapsed = Date.now() - startTime;
  if (elapsed > DEADLINE_MS) {
    throw new Error("HEALTH_TIMEOUT");
  }

  // Circuit breaker: only on the first attempt — once we've committed to a
  // 429-retry sleep the headroom decision was already made.
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

    // Always record rate-limit headers so even error responses (including 429)
    // update the per-user cooldown snapshot.
    recordRateLimitHeaders(userId, response, l);

    if (userId) {
      Sentry.addBreadcrumb({
        category: "google-health",
        level: "info",
        message: "google health api call",
        data: {
          url,
          status: response.status,
        },
      });
    }

    if (response.status === 401) {
      throw new Error("HEALTH_TOKEN_INVALID");
    }

    if (response.status === 403) {
      throw new Error("HEALTH_SCOPE_MISSING");
    }

    if (response.status === 429) {
      // Allow at most 1 retry on 429. Amplifying retries during a rate-limit
      // event makes things worse for everyone.
      if (retryCount >= 1) {
        throw new Error("HEALTH_RATE_LIMIT");
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
      const deadlineRemaining = DEADLINE_MS - (Date.now() - startTime);

      if (retryAfterMs !== null) {
        if (retryAfterMs > deadlineRemaining) {
          l.warn(
            {
              action: "health_rate_limit_no_retry",
              retryAfterMs,
              deadlineRemaining,
            },
            "rate limited; Retry-After exceeds deadline, giving up",
          );
          throw new Error("HEALTH_RATE_LIMIT");
        }
        l.warn(
          { action: "health_rate_limit", retryAfterMs, source: "header" },
          "rate limited, sleeping per Retry-After header",
        );
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
      } else {
        l.warn(
          {
            action: "health_rate_limit",
            retryAfterMs: RATE_LIMIT_NO_HEADER_DELAY_MS,
            source: "default",
          },
          "rate limited (no Retry-After), brief retry",
        );
        await new Promise((resolve) =>
          setTimeout(resolve, RATE_LIMIT_NO_HEADER_DELAY_MS),
        );
      }

      return fetchWithRetry(url, options, retryCount + 1, startTime, l, userId, criticality);
    }

    if (response.status >= 500) {
      if (retryCount >= MAX_RETRIES) {
        return response;
      }
      const delay = Math.pow(2, retryCount) * 1000;
      l.warn(
        {
          action: "health_server_error",
          status: response.status,
          retryCount,
          delay,
        },
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

/**
 * Exchange a refresh token for a new access token using the Google OAuth 2.0
 * token endpoint.
 *
 * Google does NOT rotate refresh tokens on a refresh_token grant — the input
 * refresh token remains valid and must be preserved by the caller.
 *
 * Throws:
 *   - HEALTH_TOKEN_INVALID on 400/401 (token revoked or expired)
 *   - HEALTH_REFRESH_TRANSIENT on other non-2xx responses
 */
export async function refreshGoogleHealthToken(
  refreshToken: string,
  log?: Logger,
): Promise<{ access_token: string; expires_in: number }> {
  const l = log ?? logger;
  l.debug(
    { action: "google_health_token_refresh_start" },
    "refreshing Google Health token",
  );

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_HEALTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      l.error(
        {
          action: "google_health_token_refresh_failed",
          status: response.status,
          statusText: response.statusText,
        },
        "Google Health token refresh http failure",
      );
      // 400/401 = invalid/revoked token; anything else = transient
      if (response.status === 400 || response.status === 401) {
        throw new Error("HEALTH_TOKEN_INVALID");
      }
      throw new Error("HEALTH_REFRESH_TRANSIENT");
    }

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Google token response: missing access_token");
    }
    if (typeof data.expires_in !== "number") {
      throw new Error("Invalid Google token response: missing expires_in");
    }

    // NOTE: Google does NOT return a new refresh_token — the input token is
    // reused indefinitely. We intentionally omit it from the return value so
    // callers are forced to preserve the existing one.
    l.info(
      { action: "google_health_token_refresh_success" },
      "Google Health token refreshed",
    );
    return { access_token: data.access_token, expires_in: data.expires_in };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * In-flight refresh deduplication map.
 * Ensures at most one concurrent token refresh per user.
 */
const refreshInFlight = new Map<string, Promise<string>>();

/**
 * Ensure the stored Google Health access token is fresh, refreshing it if it
 * expires within TOKEN_EXPIRY_SKEW_MS.
 *
 * Race-safe design:
 *   1. Register the refresh promise BEFORE any async work — concurrent callers
 *      that arrive while a refresh is in flight immediately receive the same
 *      promise, preventing duplicate refreshes.
 *   2. Re-read the token row INSIDE the deduped promise — if another server
 *      instance already refreshed the token between our outer read and the
 *      refresh start, we short-circuit and return the already-fresh token.
 *   3. Preserve the existing refresh token — Google does not rotate it.
 *
 * Throws:
 *   - HEALTH_TOKEN_INVALID — no token row found
 *   - HEALTH_TOKEN_SAVE_FAILED — upsert failed after one retry
 *   - (propagates any HEALTH_TOKEN_INVALID / HEALTH_REFRESH_TRANSIENT from refreshGoogleHealthToken)
 */
export async function ensureFreshToken(userId: string, log?: Logger): Promise<string> {
  const l = log ?? logger;

  const tokenRow = await getHealthTokens(userId, l);
  if (!tokenRow) {
    throw new Error("HEALTH_TOKEN_INVALID");
  }

  // Token is fresh — return immediately without acquiring the refresh lock.
  if (tokenRow.expiresAt.getTime() >= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
    return tokenRow.accessToken;
  }

  // Token near-expired — dedup concurrent refreshes.
  const existing = refreshInFlight.get(userId);
  if (existing) {
    return existing;
  }

  // Register the promise synchronously BEFORE any await so subsequent callers
  // arriving in the same microtask batch see it and join rather than starting
  // a second refresh.
  const promise = (async (): Promise<string> => {
    try {
      // Re-read to short-circuit if another server instance already refreshed.
      const freshRow = await getHealthTokens(userId, l);
      if (!freshRow) {
        throw new Error("HEALTH_TOKEN_INVALID");
      }
      if (freshRow.expiresAt.getTime() >= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
        return freshRow.accessToken;
      }

      // Still near-expired — proceed with refresh.
      const tokens = await refreshGoogleHealthToken(freshRow.refreshToken, l);

      const tokenData = {
        healthUserId: freshRow.healthUserId,
        accessToken: tokens.access_token,
        // Google does NOT rotate the refresh token — preserve the existing one.
        refreshToken: freshRow.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: freshRow.scope,
      };

      try {
        await upsertHealthTokens(userId, tokenData, l);
      } catch (upsertError) {
        l.warn(
          {
            action: "health_token_upsert_warn",
            error:
              upsertError instanceof Error
                ? upsertError.message
                : String(upsertError),
          },
          "health token upsert failed, retrying once",
        );
        try {
          await upsertHealthTokens(userId, tokenData, l);
        } catch (retryError) {
          l.error(
            {
              action: "health_token_upsert_failed",
              error:
                retryError instanceof Error
                  ? retryError.message
                  : String(retryError),
            },
            "health token upsert retry failed",
          );
          throw new Error("HEALTH_TOKEN_SAVE_FAILED");
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

// ─── Nutrition write API ──────────────────────────────────────────────────────

const GOOGLE_HEALTH_API_BASE = "https://health.googleapis.com/v1";

/** Module-level dry-run gate — single source of truth for both write functions. */
function isHealthDryRun(): boolean {
  return process.env.HEALTH_DRY_RUN === "true";
}

/**
 * Timing + meal context for a nutrition-log write. The Google Health entry must be
 * stamped with the meal date/time the user selected (not the current instant), and
 * carry the meal-type context — mirroring the data the old Fitbit path sent.
 */
export interface HealthLogTiming {
  date: string;              // YYYY-MM-DD (meal wall-clock date)
  time: string | null;       // HH:mm[:ss] (meal wall-clock time) — null if unknown
  zoneOffset?: string | null; // ±HH:MM client UTC offset, when available
  mealTypeId?: number | null; // 1..7 meal-type context
}

/**
 * Build an RFC3339 timestamp for the logged meal from its wall-clock date/time and
 * (when available) the client UTC offset. Returns undefined when no time is known —
 * the caller then omits the timestamp and the API falls back to its default.
 */
function buildHealthTimestamp(timing: HealthLogTiming): string | undefined {
  if (!timing.time) return undefined;
  const t = /^\d{2}:\d{2}$/.test(timing.time) ? `${timing.time}:00` : timing.time;
  return timing.zoneOffset ? `${timing.date}T${t}${timing.zoneOffset}` : `${timing.date}T${t}`;
}

/**
 * Build the JSON body for a Google Health nutrition-log dataPoint.
 *
 * Ports the nutrient-param logic from fitbit.ts (createFood body builder):
 *   - Required nutrients are always included.
 *   - Conditional tier-1 nutrients (saturated_fat, trans_fat, sugars,
 *     calories_from_fat) are omitted when null and included when present.
 *   - Calories and calories_from_fat are rounded via Math.round.
 *   - The meal timestamp (start_time/end_time) + meal_type carry the user's selected
 *     date/time/meal context so the Health entry isn't stamped at "now" (FOO-1113).
 *
 * NOTE: JSON field paths (including start_time/end_time/meal_type) are inferred from
 * Google Health Connect REST API docs and must be confirmed against the real API
 * (production — staging is dry-run) — see FOO-1086 / FOO-1113.
 */
function buildNutritionLogBody(food: FoodAnalysis, timing: HealthLogTiming): Record<string, unknown> {
  const body: Record<string, unknown> = {
    food_display_name: food.food_name,
    amount: food.amount,
    serving_unit: food.unit_id, // ServingUnit is already a string
    energy: Math.round(food.calories),
    protein: food.protein_g,
    total_carbohydrate: food.carbs_g,
    total_fat: food.fat_g,
    dietary_fiber: food.fiber_g,
    sodium: food.sodium_mg,
  };

  // Conditional tier-1 nutrients — omit when null (port from fitbit.ts:211-223)
  if (food.saturated_fat_g != null) {
    body.saturated_fat = food.saturated_fat_g;
  }
  if (food.trans_fat_g != null) {
    body.trans_fat = food.trans_fat_g;
  }
  if (food.sugars_g != null) {
    body.sugars = food.sugars_g;
  }
  if (food.calories_from_fat != null) {
    body.calories_from_fat = Math.round(food.calories_from_fat);
  }

  // Meal timing + context — the user's selected date/time, not "now".
  const startTime = buildHealthTimestamp(timing);
  if (startTime) {
    body.start_time = startTime;
    body.end_time = startTime; // point-in-time meal event
  }
  if (timing.mealTypeId != null) {
    body.meal_type = timing.mealTypeId;
  }

  return body;
}

/**
 * Create a single anonymous nutrition-log dataPoint in Google Health.
 *
 * Collapses Fitbit's two-step createFood + logFood into one API call.
 * Anonymous logs are not editable in place — the app always does
 * delete-old + create-new on edit.
 *
 * Returns { healthLogId } — the string id from the created dataPoint.
 * Throws HEALTH_API_ERROR on non-ok response or missing id in response body.
 *
 * NOTE: endpoint and body shape inferred from docs; confirm during staging QA.
 */
export async function createNutritionLog(
  accessToken: string,
  food: FoodAnalysis,
  timing: HealthLogTiming,
  log?: Logger,
  userId?: string,
): Promise<{ healthLogId: string }> {
  const l = log ?? logger;

  if (isHealthDryRun()) {
    l.debug({ action: "health_create_nutrition_log_dry_run" }, "dry run: skipping nutrition log creation");
    return { healthLogId: "dry-run" };
  }

  const body = buildNutritionLogBody(food, timing);

  const response = await fetchWithRetry(
    `${GOOGLE_HEALTH_API_BASE}/users/me/nutrition-log/dataPoints`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    0, Date.now(), l, userId, "critical",
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "health_create_nutrition_log_failed", status: response.status, errorBody },
      "nutrition log creation failed",
    );
    throw new Error("HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  if (typeof data.id !== "string") {
    l.error(
      { action: "health_create_nutrition_log_invalid_response" },
      "nutrition log response missing string id",
    );
    throw new Error("HEALTH_API_ERROR");
  }

  l.info({ action: "health_create_nutrition_log_success", healthLogId: data.id }, "nutrition log created");
  return { healthLogId: data.id };
}

/**
 * Delete one or more Google Health nutrition-log dataPoints by id.
 *
 * Replaces Fitbit's deleteFoodLog (single) — batchDelete handles multi-delete
 * and makes compensation simpler (one call for edit-old-delete).
 *
 * 404 resolves without error (already-deleted idempotency — port from
 * fitbit.ts:343-349 not-found handling).
 * Other non-ok responses throw HEALTH_API_ERROR.
 */
export async function deleteNutritionLogs(
  accessToken: string,
  ids: string[],
  log?: Logger,
  userId?: string,
): Promise<void> {
  const l = log ?? logger;

  if (isHealthDryRun()) {
    l.debug({ action: "health_delete_nutrition_logs_dry_run" }, "dry run: skipping nutrition log deletion");
    return;
  }

  const response = await fetchWithRetry(
    `${GOOGLE_HEALTH_API_BASE}/users/me/nutrition-log/dataPoints:batchDelete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids }),
    },
    0, Date.now(), l, userId, "critical",
  );

  // 404 = already deleted — treat as success (idempotency)
  if (response.status === 404) {
    l.warn(
      { action: "health_delete_nutrition_logs_not_found", ids },
      "nutrition logs not found on Google Health, treating as already deleted",
    );
    return;
  }

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "health_delete_nutrition_logs_failed", status: response.status, errorBody },
      "nutrition log deletion failed",
    );
    throw new Error("HEALTH_API_ERROR");
  }

  l.info({ action: "health_delete_nutrition_logs_success", idCount: ids.length }, "nutrition logs deleted");
}

// ─── Profile + biometric read API ────────────────────────────────────────────

const GOOGLE_HEALTH_API_V4 = "https://health.googleapis.com/v4";

/** Subtract days from a YYYY-MM-DD date string, returning YYYY-MM-DD. */
function subtractDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** Compute integer age from a date-of-birth object { year, month, day } and now. */
function computeAge(dob: { year: number; month: number; day: number }): number {
  const now = new Date();
  let age = now.getUTCFullYear() - dob.year;
  const birthdayThisYear = new Date(Date.UTC(now.getUTCFullYear(), dob.month - 1, dob.day));
  if (now < birthdayThisYear) {
    age--;
  }
  return age;
}

/**
 * Map a Google Health sex string to the internal enum.
 * Unknown/absent defaults to 'NA' — keeps the daily-goals sex_unset path alive.
 * NOTE: Google Health may return lowercase ('male'/'female') — handle both.
 */
function parseSex(value: unknown): "MALE" | "FEMALE" | "NA" {
  if (typeof value !== "string") return "NA";
  const upper = value.toUpperCase();
  if (upper === "MALE") return "MALE";
  if (upper === "FEMALE") return "FEMALE";
  return "NA";
}

/**
 * Parse height from the Google Health response into cm.
 * Height is expected as { value: number, unit: string } where unit is "METER".
 * Converts metres → cm by multiplying by 100.
 *
 * NOTE: field paths inferred from docs — confirm during staging QA (FOO-1088).
 */
function parseHeightCm(height: Record<string, unknown>): number {
  const value = height.value as number;
  const unit = typeof height.unit === "string" ? height.unit.toUpperCase() : "METER";
  if (unit === "CENTIMETER" || unit === "CM") return value;
  // Default: treat as meters → cm
  return value * 100;
}

/**
 * Fetch and parse the user's Google Health profile.
 *
 * Returns { ageYears, sex, heightCm }.
 * Unknown sex defaults to 'NA' (not a throw — keeps sex_unset daily-goals path alive).
 * Height is always returned in cm.
 * Age is derived from the dateOfBirth field using the current date.
 *
 * NOTE: endpoint and body shape inferred from Google Health Connect REST API v4 docs;
 * confirm during staging QA (FOO-1088).
 */
export async function getHealthProfile(
  accessToken: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthProfile> {
  const l = log ?? logger;
  l.debug({ action: "health_get_profile" }, "fetching Google Health profile");

  const response = await fetchWithRetry(
    `${GOOGLE_HEALTH_API_V4}/users/me`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "health_get_profile_failed", status: response.status, errorBody }, "profile fetch failed");
    throw new Error("HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);

  const sex = parseSex(data.sex);

  const heightRaw = data.height as Record<string, unknown> | undefined;
  if (!heightRaw || typeof heightRaw.value !== "number") {
    throw new Error("HEALTH_API_ERROR");
  }
  const heightCm = parseHeightCm(heightRaw);

  const dobRaw = data.dateOfBirth as Record<string, unknown> | undefined;
  if (!dobRaw || typeof dobRaw.year !== "number") {
    throw new Error("HEALTH_API_ERROR");
  }
  const ageYears = computeAge({
    year: dobRaw.year as number,
    month: (dobRaw.month as number) ?? 1,
    day: (dobRaw.day as number) ?? 1,
  });

  l.debug({ action: "health_get_profile_success" }, "profile fetched");
  return { ageYears, sex, heightCm };
}

/**
 * Fetch the most recent weight log on or before targetDate from Google Health.
 *
 * Issues a SINGLE ranged fetch over [targetDate-13d, targetDate] (14-day window)
 * rather than a 14-day walk-back (replaces fitbit.ts getFitbitLatestWeightKg).
 * Returns the most-recent data point on/before targetDate, or null if empty.
 * Expects the API to return weight in kg (weightKg field); no unit conversion performed.
 *
 * NOTE: endpoint and body shape inferred from docs — confirm during staging QA (FOO-1088).
 */
export async function getHealthLatestWeightKg(
  accessToken: string,
  targetDate: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthWeightLog | null> {
  const l = log ?? logger;
  const startDate = subtractDays(targetDate, 13); // 14 days inclusive
  l.debug(
    { action: "health_get_weight", targetDate, startDate, windowDays: 14 },
    "fetching weight from Google Health (14-day window)",
  );

  const url = new URL(`${GOOGLE_HEALTH_API_V4}/users/me/weight-log`);
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", targetDate);

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "health_get_weight_failed", status: response.status, errorBody }, "weight fetch failed");
    throw new Error("HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const points = data.weightPoints as Array<Record<string, unknown>> | undefined;

  if (!Array.isArray(points) || points.length === 0) {
    l.debug({ action: "health_get_weight_not_found", targetDate }, "no weight found in 14-day window");
    return null;
  }

  // Filter to only points on/before targetDate, then sort descending by date
  const valid = points.filter((p) => {
    return typeof p.date === "string" && p.date <= targetDate;
  });

  if (valid.length === 0) {
    l.debug({ action: "health_get_weight_all_future", targetDate }, "all weight points are after targetDate");
    return null;
  }

  // Sort by date descending → take the most recent
  valid.sort((a, b) => (b.date as string).localeCompare(a.date as string));
  const latest = valid[0];

  if (typeof latest.weightKg !== "number") {
    throw new Error("HEALTH_API_ERROR");
  }

  l.debug({ action: "health_get_weight_success", loggedDate: latest.date, weightKg: latest.weightKg }, "weight fetched");
  return { weightKg: latest.weightKg, loggedDate: latest.date as string };
}

/**
 * Fetch the daily activity summary (caloriesOut) from Google Health.
 *
 * Returns { caloriesOut: number } from dailyRollUp, or { caloriesOut: null }
 * if the roll-up is empty or caloriesOut is not yet available (no throw).
 * Converts kJ → kcal if energyUnit is "kJ".
 *
 * NOTE: endpoint and body shape inferred from docs — confirm during staging QA (FOO-1088).
 */
export async function getHealthActivitySummary(
  accessToken: string,
  date: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<ActivitySummary> {
  const l = log ?? logger;
  l.debug({ action: "health_get_activity_summary", date }, "fetching activity summary from Google Health");

  const url = new URL(`${GOOGLE_HEALTH_API_V4}/users/me/activity-summary`);
  url.searchParams.set("date", date);

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "health_get_activity_summary_failed", status: response.status, errorBody }, "activity summary fetch failed");
    throw new Error("HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const rollUp = data.dailyRollUp as Record<string, unknown> | undefined;

  if (!rollUp || typeof rollUp.caloriesOut !== "number") {
    l.debug({ action: "health_get_activity_summary_empty", date }, "activity summary caloriesOut not yet available");
    return { caloriesOut: null };
  }

  let caloriesOut = rollUp.caloriesOut;

  // Convert kJ → kcal if the energy unit is specified as kJ
  const energyUnit = typeof rollUp.energyUnit === "string" ? rollUp.energyUnit : "";
  if (energyUnit.toLowerCase() === "kj") {
    caloriesOut = Math.round(caloriesOut / 4.184);
  }

  l.debug({ action: "health_get_activity_summary_success", date, caloriesOut }, "activity summary fetched");
  return { caloriesOut };
}
