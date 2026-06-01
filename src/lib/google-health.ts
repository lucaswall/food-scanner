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

// Google Health API v4 base. Data points live under
// `${BASE}/users/me/dataTypes/{data-type}/dataPoints` (data-type id is kebab-case).
// Confirmed against developers.google.com/health/endpoints (FOO-1115).
const GOOGLE_HEALTH_API_BASE = "https://health.googleapis.com/v4";

/** Kebab-case v4 data-type id for the nutrition log. */
const NUTRITION_LOG_DATA_TYPE = "nutrition-log";

/** v4 dataPoints collection URL for a data-type (kebab-case id). */
function dataPointsUrl(dataType: string): string {
  return `${GOOGLE_HEALTH_API_BASE}/users/me/dataTypes/${dataType}/dataPoints`;
}

/** Full resource name of a single dataPoint — used for batchDelete `names`. */
function dataPointName(dataType: string, id: string): string {
  return `users/me/dataTypes/${dataType}/dataPoints/${id}`;
}

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
 * Map the app's internal mealTypeId (1..7) to the Google Health MealType enum.
 * INFERRED enum values — validate against the live API (FOO-1115).
 */
function mapMealType(mealTypeId: number): string {
  switch (mealTypeId) {
    case 1: return "BREAKFAST";        // Breakfast
    case 2: return "SNACK";            // Morning snack
    case 3: return "LUNCH";            // Lunch
    case 4: return "SNACK";            // Afternoon snack
    case 5: return "DINNER";           // Dinner
    default: return "UNKNOWN";         // 7 = Anytime / unspecified
  }
}

/**
 * Build a Google Health **v4** nutrition-log DataPoint body.
 *
 * The OUTER structure is confirmed against developers.google.com/health v4:
 *   - A DataPoint is `{ name, <dataType-member>: {...} }`; for nutrition-log the
 *     member is `nutritionLog`. `name` is the client-providable resource name, which
 *     lets us know the id without parsing the async Operation the create returns.
 *   - `nutritionLog` carries `sampleTime` (the meal instant), `food` (display name +
 *     energy), `nutrients[]` (macros), and `mealType`.
 *
 * The INNER nutritionLog field names (food/energy/nutrient enums/mealType enum/serving)
 * are BEST-EFFORT from the v4 schema and MUST be validated against the live API —
 * staging is HEALTH_DRY_RUN so writes are never exercised there (FOO-1115).
 */
function buildNutritionLogBody(name: string, food: FoodAnalysis, timing: HealthLogTiming): Record<string, unknown> {
  const nutrients: Array<Record<string, unknown>> = [
    { nutrient: "PROTEIN", amount: { grams: food.protein_g } },
    { nutrient: "TOTAL_CARBOHYDRATE", amount: { grams: food.carbs_g } },
    { nutrient: "TOTAL_FAT", amount: { grams: food.fat_g } },
    { nutrient: "DIETARY_FIBER", amount: { grams: food.fiber_g } },
    { nutrient: "SODIUM", amount: { milligrams: food.sodium_mg } },
  ];
  if (food.saturated_fat_g != null) nutrients.push({ nutrient: "SATURATED_FAT", amount: { grams: food.saturated_fat_g } });
  if (food.trans_fat_g != null) nutrients.push({ nutrient: "TRANS_FAT", amount: { grams: food.trans_fat_g } });
  if (food.sugars_g != null) nutrients.push({ nutrient: "SUGARS", amount: { grams: food.sugars_g } });
  // NOTE: calories_from_fat is intentionally NOT sent to the health mirror yet — the v4
  // nutrient enum is unconfirmed and sending an unknown enum on the critical write path
  // could 400 ALL food logging. It is a derived value (≈ fat_g × 9) and is fully
  // preserved locally; add it once the enum is confirmed live (FOO-1115).

  const nutritionLog: Record<string, unknown> = {
    food: {
      name: food.food_name,
      energy: { kilocalories: Math.round(food.calories) },
      servingSize: { amount: food.amount, unit: food.unit_id },
    },
    nutrients,
  };

  // Meal instant — the user's selected date/time, not "now" (FOO-1113).
  const sampleTime = buildHealthTimestamp(timing);
  if (sampleTime) {
    nutritionLog.sampleTime = { sampleTime };
  }
  if (timing.mealTypeId != null) {
    nutritionLog.mealType = mapMealType(timing.mealTypeId);
  }

  return { name, nutritionLog };
}

/**
 * Create a single anonymous nutrition-log dataPoint in Google Health.
 *
 * Collapses Fitbit's two-step createFood + logFood into one API call.
 * Anonymous logs are not editable in place — the app always does
 * delete-old + create-new on edit.
 *
 * POSTs to the v4 dataPoints collection. The create returns a long-running
 * Operation (not the DataPoint), so we CLIENT-PROVIDE the dataPoint `name` (the v4
 * schema allows a client id of 4–63 lowercase letters/numbers/hyphens — a UUID fits)
 * and return that id as the healthLogId without parsing the Operation. The stored id
 * is later turned back into a resource name for batchDelete.
 *
 * Returns { healthLogId } — the client-generated dataPoint id.
 * Throws HEALTH_API_ERROR on non-ok response.
 *
 * NOTE: endpoint/method/envelope confirmed (v4); the nutritionLog body internals are
 * best-effort and must be validated against the live API (FOO-1115).
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

  // Client-generated dataPoint id (lowercase hex + hyphens, 36 chars — within the
  // 4–63 char constraint), so we know the id without parsing the async Operation.
  const dataPointId = crypto.randomUUID();
  const body = buildNutritionLogBody(dataPointName(NUTRITION_LOG_DATA_TYPE, dataPointId), food, timing);

  const response = await fetchWithRetry(
    dataPointsUrl(NUTRITION_LOG_DATA_TYPE),
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

  // Create returns a long-running Operation; the dataPoint id is the one we supplied.
  l.info({ action: "health_create_nutrition_log_success", healthLogId: dataPointId }, "nutrition log created");
  return { healthLogId: dataPointId };
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

  // v4 batchDelete takes full resource names, not bare ids.
  const names = ids.map((id) => dataPointName(NUTRITION_LOG_DATA_TYPE, id));
  const response = await fetchWithRetry(
    `${dataPointsUrl(NUTRITION_LOG_DATA_TYPE)}:batchDelete`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ names }),
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

/** Subtract days from a YYYY-MM-DD date string, returning YYYY-MM-DD. */
function subtractDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * Extract a YYYY-MM-DD date from a v4 ObservationSampleTime, which may be an RFC3339
 * string or an object carrying `sampleTime`. Best-effort (FOO-1115).
 */
function extractSampleDate(sampleTime: unknown): string | null {
  if (typeof sampleTime === "string") return sampleTime.slice(0, 10);
  if (sampleTime && typeof sampleTime === "object") {
    const st = (sampleTime as Record<string, unknown>).sampleTime;
    if (typeof st === "string") return st.slice(0, 10);
  }
  return null;
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
 * Parse a height value from a v4 `height` dataPoint into cm. Height samples carry
 * `meters` (double) in v4; alternate shapes may use { value, unit }. Best-effort —
 * validate against the live API (FOO-1115).
 */
function parseHeightCm(height: Record<string, unknown>): number | null {
  if (typeof height.meters === "number") return height.meters * 100;
  if (typeof height.centimeters === "number") return height.centimeters;
  if (typeof height.value === "number") {
    const unit = typeof height.unit === "string" ? height.unit.toUpperCase() : "METER";
    return unit.startsWith("CENT") ? height.value : height.value * 100;
  }
  return null;
}

/**
 * Read the user's latest height (cm) from the v4 `height` data type, or null if none.
 * The v4 Profile resource does NOT carry height — it is its own data type (FOO-1115).
 */
async function getHealthHeightCm(
  accessToken: string,
  l: Logger,
  userId: string | undefined,
  criticality: HealthCallCriticality,
): Promise<number | null> {
  const response = await fetchWithRetry(
    dataPointsUrl("height"),
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
    0, Date.now(), l, userId, criticality,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const errorBody = sanitizeErrorBody(await parseErrorBody(response));
    l.error({ action: "health_get_height_failed", status: response.status, errorBody }, "height fetch failed");
    throw new Error("HEALTH_API_ERROR");
  }
  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const points = Array.isArray(data.dataPoints) ? (data.dataPoints as Array<Record<string, unknown>>) : [];
  for (const p of points) {
    const h = p.height as Record<string, unknown> | undefined;
    if (h) {
      const cm = parseHeightCm(h);
      if (cm !== null) return cm;
    }
  }
  return null;
}

/**
 * Fetch and parse the user's Google Health profile (v4).
 *
 * Returns { ageYears, sex, heightCm }. The v4 `users/me/profile` resource carries the
 * derived `age` but NOT sex or height (confirmed — FOO-1115): sex is unavailable so it
 * defaults to 'NA' (keeps the daily-goals sex_unset path alive), and height is read
 * from the separate `height` data type.
 *
 * NOTE: endpoints confirmed (v4 /users/me/profile + /dataTypes/height/dataPoints); the
 * height value shape is best-effort — validate against the live API (FOO-1115).
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
    `${GOOGLE_HEALTH_API_BASE}/users/me/profile`,
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

  // The v4 Profile exposes a derived integer `age`.
  if (typeof data.age !== "number") {
    throw new Error("HEALTH_API_ERROR");
  }
  const ageYears = data.age;

  // sex is not part of the v4 Profile → NA (parse defensively in case it ever appears).
  const sex = parseSex(data.sex);

  // height is its own data type, not a profile field.
  const heightCm = await getHealthHeightCm(accessToken, l, userId, criticality);
  if (heightCm === null) {
    throw new Error("HEALTH_API_ERROR");
  }

  l.debug({ action: "health_get_profile_success" }, "profile fetched");
  return { ageYears, sex, heightCm };
}

/**
 * Fetch the most recent weight log on or before targetDate from Google Health.
 *
 * Reads the v4 `weight` data type's dataPoints and returns the most-recent sample
 * on/before targetDate within a 14-day window, or null if empty. Weight samples carry
 * `kilograms` directly (no unit conversion).
 *
 * NOTE: endpoint confirmed (v4 /dataTypes/weight/dataPoints, weight.kilograms); the v4
 * ranged-read filter syntax isn't confirmed, so points are filtered client-side to the
 * window. Best-effort — validate against the live API (FOO-1115).
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

  const url = new URL(dataPointsUrl("weight"));
  url.searchParams.set("pageSize", "100");

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
  const points = Array.isArray(data.dataPoints) ? (data.dataPoints as Array<Record<string, unknown>>) : [];

  // Parse weight samples, keep those within [startDate, targetDate].
  const valid: Array<{ weightKg: number; date: string }> = [];
  for (const p of points) {
    const w = p.weight as Record<string, unknown> | undefined;
    if (!w || typeof w.kilograms !== "number") continue;
    const d = extractSampleDate(w.sampleTime);
    if (!d || d < startDate || d > targetDate) continue;
    valid.push({ weightKg: w.kilograms, date: d });
  }

  if (valid.length === 0) {
    l.debug({ action: "health_get_weight_not_found", targetDate }, "no weight found in 14-day window");
    return null;
  }

  // Sort by date descending → take the most recent
  valid.sort((a, b) => b.date.localeCompare(a.date));
  const latest = valid[0];

  l.debug({ action: "health_get_weight_success", loggedDate: latest.date, weightKg: latest.weightKg }, "weight fetched");
  return { weightKg: latest.weightKg, loggedDate: latest.date };
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

  // v4 daily roll-up of total daily energy expenditure (the caloriesOut analogue).
  const response = await fetchWithRetry(
    `${dataPointsUrl("total-calories")}:dailyRollUp`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startDate: date, endDate: date }),
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
  // dailyRollUp returns per-day roll-ups; pull the first day's total-calories kcal.
  // Response shape is best-effort: accept either a top-level rollUp or a dailyRollUps[] array.
  const rollUps = Array.isArray(data.dailyRollUps)
    ? (data.dailyRollUps as Array<Record<string, unknown>>)
    : (data.dailyRollUp ? [data.dailyRollUp as Record<string, unknown>] : []);
  const rollUp = rollUps[0];

  // Prefer kcal fields; fall back to kilojoule fields converted to kcal (÷4.184) —
  // Google fitness energy is often reported in kJ. Best-effort field names (FOO-1115).
  const kcal =
    rollUp && typeof rollUp.totalCaloriesKcal === "number" ? rollUp.totalCaloriesKcal
    : rollUp && typeof rollUp.caloriesKcal === "number" ? rollUp.caloriesKcal
    : rollUp && typeof rollUp.caloriesOut === "number" ? rollUp.caloriesOut
    : rollUp && typeof rollUp.totalCaloriesKj === "number" ? rollUp.totalCaloriesKj / 4.184
    : rollUp && typeof rollUp.kilojoules === "number" ? rollUp.kilojoules / 4.184
    : null;

  if (kcal === null) {
    l.debug({ action: "health_get_activity_summary_empty", date }, "activity summary caloriesOut not yet available");
    return { caloriesOut: null };
  }

  const caloriesOut = Math.round(kcal);
  l.debug({ action: "health_get_activity_summary_success", date, caloriesOut }, "activity summary fetched");
  return { caloriesOut };
}
