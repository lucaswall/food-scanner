import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getHealthTokens, upsertHealthTokens } from "@/lib/health-tokens";
import {
  assertRateLimitAllowed,
  recordRateLimitHeaders,
  recordResourceExhaustedCooldown,
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
 * proactively refresh it. Uses a 1-hour skew window to pre-empt near-expiry.
 */
const TOKEN_EXPIRY_SKEW_MS = 60 * 60 * 1000;

/**
 * Returns true if a parsed 403 response body signals Google Cloud quota exhaustion.
 * Quota-403 shape: `{ error: { status: "RESOURCE_EXHAUSTED" } }`.
 * Scope-403 (PERMISSION_DENIED etc.) is NOT quota exhaustion and must map differently.
 */
function isResourceExhaustedBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== "object") return false;
  return (err as Record<string, unknown>).status === "RESOURCE_EXHAUSTED";
}

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
      // Read body once to distinguish quota-403 from scope-403.
      // Google Cloud quota exhaustion: { error: { status: "RESOURCE_EXHAUSTED" } }
      // Scope/permission error: { error: { status: "PERMISSION_DENIED" } } or similar.
      const rawBody = await parseErrorBody(response);
      if (isResourceExhaustedBody(rawBody)) {
        // Treat like 429: record a cooldown so the breaker blocks cheap calls.
        if (userId) recordResourceExhaustedCooldown(userId, l);
        l.warn(
          { action: "health_403_resource_exhausted", userId },
          "403 RESOURCE_EXHAUSTED — recording cooldown, throwing HEALTH_RATE_LIMIT",
        );
        throw new Error("HEALTH_RATE_LIMIT");
      }
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

/**
 * Extract the server-assigned dataPoint id from a `create` (POST) response. Per the v4
 * discovery doc, `create` returns a long-running `Operation` ({ name: "operations/…",
 * done, response }); the created DataPoint (with its server-assigned `name`) is in
 * `response`. A done-inline create may instead return the DataPoint directly
 * (`{ name: "users/.../dataPoints/{id}", … }`). Returns the dataPoint id, or null when
 * the response carries no dataPoint name (e.g. an Operation still in progress) — the
 * server assigns the id, so there is no client fallback.
 */
function parseCreatedDataPointId(data: unknown): string | null {
  const idFromName = (name: unknown): string | null => {
    if (typeof name !== "string") return null;
    const m = /\/dataPoints\/([^/]+)$/.exec(name);
    return m ? m[1] : null;
  };
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    const fromTop = idFromName(d.name);
    if (fromTop) return fromTop;
    const resp = d.response;
    if (resp && typeof resp === "object") {
      const fromResp = idFromName((resp as Record<string, unknown>).name);
      if (fromResp) return fromResp;
    }
  }
  return null;
}

/** Module-level dry-run gate — single source of truth for both write functions. */
function isHealthDryRun(): boolean {
  return process.env.HEALTH_DRY_RUN === "true";
}

/**
 * Timing + meal context for a nutrition-log write. The Google Health entry must be
 * stamped with the meal date/time the user selected (not the current instant), and
 * carry the meal-type context for the Google Health nutrition log entry.
 */
export interface HealthLogTiming {
  date: string;              // YYYY-MM-DD (meal wall-clock date)
  time: string | null;       // HH:mm[:ss] (meal wall-clock time) — null if unknown
  zoneOffset?: string | null; // ±HH:MM client UTC offset, when available
  mealTypeId?: number | null; // 1..7 meal-type context
}

/** Convert a ±HH:MM client offset to a google-duration string (e.g. "-03:00" → "-10800s"). */
function zoneOffsetToDuration(zoneOffset: string): string {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(zoneOffset);
  if (!m) return "0s";
  const sign = m[1] === "-" ? -1 : 1;
  const seconds = sign * (Number(m[2]) * 3600 + Number(m[3]) * 60);
  return `${seconds}s`;
}

/**
 * Build the v4 `SessionTimeInterval` for the logged meal (a point-in-time event, so
 * start == end). Each bound is an RFC3339 instant + a google-duration UTC offset, per
 * the discovery schema. Returns undefined when no time is known.
 */
function buildInterval(timing: HealthLogTiming): Record<string, unknown> | undefined {
  if (!timing.time) return undefined;
  const t = /^\d{2}:\d{2}$/.test(timing.time) ? `${timing.time}:00` : timing.time;
  const instant = timing.zoneOffset ? `${timing.date}T${t}${timing.zoneOffset}` : `${timing.date}T${t}Z`;
  const offset = timing.zoneOffset ? zoneOffsetToDuration(timing.zoneOffset) : "0s";
  return { startTime: instant, startUtcOffset: offset, endTime: instant, endUtcOffset: offset };
}

/**
 * Map the app's internal mealTypeId to the Google Health v4 `MealType` enum.
 * App ids (MEAL_TYPE_LABELS): 1 Breakfast, 2 Morning Snack, 3 Lunch, 4 Afternoon Snack,
 * 5 Dinner, 7 Anytime. The v4 enum descriptions (verified against the discovery doc) map
 * "morning snack"→BEFORE_LUNCH, "afternoon snack"→BEFORE_DINNER, "any time"→ANYTIME, so
 * each app id maps to its exact semantic enum value (all valid `MealType` members).
 */
function mapMealType(mealTypeId: number): string {
  switch (mealTypeId) {
    case 1: return "BREAKFAST";    // Breakfast
    case 2: return "BEFORE_LUNCH"; // Morning snack
    case 3: return "LUNCH";        // Lunch
    case 4: return "BEFORE_DINNER"; // Afternoon snack
    case 5: return "DINNER";       // Dinner
    default: return "ANYTIME";     // 7 = Anytime (and any unmapped id)
  }
}

/**
 * Build a Google Health **v4** nutrition-log DataPoint body for a `create` (POST).
 *
 * Schema verified against the v4 discovery document
 * (health.googleapis.com/$discovery/rest?version=v4):
 *   - DataPoint = { nutritionLog: NutritionLog }. `create` is POST-to-collection and the
 *     server assigns the dataPoint name/id — the client does NOT supply a `name`.
 *   - NutritionLog has TOP-LEVEL `foodDisplayName`, `energy`/`energyFromFat`
 *     (EnergyQuantity {kcal}), `totalCarbohydrate`/`totalFat` (WeightQuantity {grams}),
 *     `serving` (Serving {amount, foodMeasurementUnit}), `mealType`, `interval`
 *     (SessionTimeInterval), and `nutrients[]` (NutrientQuantity {nutrient, quantity}).
 *   - The remaining macros go in `nutrients[]` keyed by the `Nutrient` enum
 *     (PROTEIN, DIETARY_FIBER, SODIUM, SATURATED_FAT, TRANS_FAT, SUGAR). WeightQuantity
 *     `grams` is the canonical mass, so sodium mg is converted to grams.
 */
function buildNutritionLogBody(food: FoodAnalysis, timing: HealthLogTiming): Record<string, unknown> {
  const nutrients: Array<Record<string, unknown>> = [
    { nutrient: "PROTEIN", quantity: { grams: food.protein_g } },
    { nutrient: "DIETARY_FIBER", quantity: { grams: food.fiber_g } },
    { nutrient: "SODIUM", quantity: { grams: food.sodium_mg / 1000 } },
  ];
  if (food.saturated_fat_g != null) nutrients.push({ nutrient: "SATURATED_FAT", quantity: { grams: food.saturated_fat_g } });
  if (food.trans_fat_g != null) nutrients.push({ nutrient: "TRANS_FAT", quantity: { grams: food.trans_fat_g } });
  if (food.sugars_g != null) nutrients.push({ nutrient: "SUGAR", quantity: { grams: food.sugars_g } });

  const nutritionLog: Record<string, unknown> = {
    foodDisplayName: food.food_name,
    energy: { kcal: Math.round(food.calories) },
    totalCarbohydrate: { grams: food.carbs_g },
    totalFat: { grams: food.fat_g },
    serving: { amount: food.amount, foodMeasurementUnit: food.unit_id },
    nutrients,
  };

  if (food.calories_from_fat != null) {
    nutritionLog.energyFromFat = { kcal: Math.round(food.calories_from_fat) };
  }

  // Meal instant — the user's selected date/time, not "now" (FOO-1113).
  const interval = buildInterval(timing);
  if (interval) {
    nutritionLog.interval = interval;
  }
  if (timing.mealTypeId != null) {
    nutritionLog.mealType = mapMealType(timing.mealTypeId);
  }

  return { nutritionLog };
}

/**
 * Create a single anonymous nutrition-log dataPoint in Google Health.
 *
 * Anonymous logs are not editable in place — the app always does
 * delete-old + create-new on edit.
 *
 * Create is `POST …/dataTypes/nutrition-log/dataPoints` (POST-to-collection, per the v4
 * discovery `create` method); the SERVER assigns the dataPoint id and returns a
 * long-running `Operation` whose `response` carries the created DataPoint's resource
 * name. The stored healthLogId is parsed from that name and is later turned back into a
 * resource name for batchDelete. If the response carries no dataPoint name (e.g. an
 * Operation still in progress), healthLogId is null — the write succeeded, but the local
 * row can't reference it (matches the dry-run null contract; the partial unique index
 * tolerates null).
 *
 * Returns { healthLogId } — the server-assigned dataPoint id, or null if unresolved.
 * Throws HEALTH_BAD_REQUEST on 4xx, HEALTH_API_ERROR on 5xx.
 *
 * NOTE: method/path/envelope/enums/field names verified against the v4 discovery doc.
 * The one unverified behavior is whether create completes synchronously (done + inline
 * response) or requires polling the Operation — gated on the live smoke test (FOO-1115).
 */
export async function createNutritionLog(
  accessToken: string,
  food: FoodAnalysis,
  timing: HealthLogTiming,
  log?: Logger,
  userId?: string,
): Promise<{ healthLogId: string | null }> {
  const l = log ?? logger;

  if (isHealthDryRun()) {
    l.debug({ action: "health_create_nutrition_log_dry_run" }, "dry run: skipping nutrition log creation");
    // null (not a "dry-run" sentinel) so the partial unique index on
    // (user_id, health_log_id) never collides across repeated dry-run logs.
    return { healthLogId: null };
  }

  // create is POST-to-collection; the server assigns the dataPoint id (no client id).
  const body = buildNutritionLogBody(food, timing);

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
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  // Read the server-assigned dataPoint id from the Operation/DataPoint response.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const healthLogId = parseCreatedDataPointId(parsed);

  if (healthLogId === null) {
    // Write succeeded (2xx) but no dataPoint name came back — likely an Operation still
    // in progress. Don't throw (the entry exists server-side); record null so the row is
    // saved, and surface it for the live-validation follow-up (FOO-1115).
    l.warn(
      { action: "health_create_nutrition_log_no_id" },
      "nutrition log created but no dataPoint id in response (operation may be async) — storing null healthLogId",
    );
  } else {
    l.info({ action: "health_create_nutrition_log_success", healthLogId }, "nutrition log created");
  }
  return { healthLogId };
}

/**
 * Delete one or more Google Health nutrition-log dataPoints by id.
 *
 * Uses v4 batchDelete to handle multi-delete in one call, simplifying
 * compensation (edit-old-delete pattern).
 *
 * `mode` controls 404 handling:
 *   - `"cleanup"` (default) — compensation/rollback delete; a 404 means the entry is
 *     already gone, which is the desired idempotent outcome → resolve.
 *   - `"user"` — the user explicitly deleted a logged food; a 404 means our DB id has
 *     no Health entry (data drift) and must NOT be silently swallowed → throw.
 * Other non-ok responses throw HEALTH_API_ERROR.
 */
export async function deleteNutritionLogs(
  accessToken: string,
  ids: string[],
  log?: Logger,
  userId?: string,
  mode: "user" | "cleanup" = "cleanup",
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

  // 404 = entry already gone. Idempotent for cleanup/compensation; a hard error for a
  // user-initiated delete (the DB id has no live Health entry — surface the drift).
  if (response.status === 404) {
    if (mode === "user") {
      l.error(
        { action: "health_delete_nutrition_logs_not_found", ids, mode },
        "user-initiated delete: nutrition logs not found on Google Health (data drift)",
      );
      // Distinct typed error so the caller can surface the drift loudly yet still
      // complete the user's local delete (the Health entry is definitively gone).
      throw new Error("HEALTH_LOG_NOT_FOUND");
    }
    l.warn(
      { action: "health_delete_nutrition_logs_not_found", ids, mode },
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
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
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

/** Add days to a YYYY-MM-DD date string, returning YYYY-MM-DD (handles month/year rollover). */
function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Build a v4 CivilDateTime from a YYYY-MM-DD string.
 *
 * When `zoneOffset` (±HH:MM) is provided the resulting object includes a
 * `utcOffset` duration field so Google Health interprets the civil day in the
 * user's timezone rather than UTC. This aligns the rollup window with the
 * write instant produced by `buildInterval` (which also embeds the zone offset),
 * preventing a date-boundary mismatch for late-night meals (e.g. 23:30 at −03:00
 * is next-day UTC but same civil day locally — FOO-1134).
 *
 * NOTE: the `utcOffset` field on CivilDateTime is inferred — pending live
 * validation against the v4 API (FOO-1115).
 */
function civilDateTime(
  dateStr: string,
  zoneOffset?: string | null,
): Record<string, unknown> {
  const parts = dateStr.split("-").map(Number);
  // Fail fast on a malformed date rather than POSTing { year: NaN, … } and getting an
  // opaque upstream 400.
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`Invalid YYYY-MM-DD date for Google Health civil interval: ${dateStr}`);
  }
  const [year, month, day] = parts;
  const result: Record<string, unknown> = { date: { year, month, day } };
  if (zoneOffset) {
    result.utcOffset = zoneOffsetToDuration(zoneOffset);
  }
  return result;
}

/**
 * Extract a YYYY-MM-DD date from a v4 `ObservationSampleTime`, whose `physicalTime` is
 * an RFC3339 instant (per the v4 discovery schema). Tolerates a bare RFC3339 string.
 */
function extractSampleDate(sampleTime: unknown): string | null {
  if (sampleTime && typeof sampleTime === "object") {
    const pt = (sampleTime as Record<string, unknown>).physicalTime;
    if (typeof pt === "string") return pt.slice(0, 10);
  }
  if (typeof sampleTime === "string") return sampleTime.slice(0, 10);
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
 * Parse a v4 `Height` dataPoint into cm. Per the discovery schema, Height carries
 * `heightMillimeters` (int64 as a string). cm = mm / 10.
 */
function parseHeightCm(height: Record<string, unknown>): number | null {
  const mm = height.heightMillimeters;
  if (typeof mm === "string" && mm.trim() !== "" && !Number.isNaN(Number(mm))) return Number(mm) / 10;
  if (typeof mm === "number") return mm / 10;
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
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
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
 * from the separate `height` data type — which many users will not have, so heightCm is
 * `null` (NOT a throw) when absent; the goals layer degrades gracefully with a fallback.
 *
 * NOTE: endpoints and response shapes are inferred from the v4 discovery document —
 * pending live validation against the staging API (FOO-1115).
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
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);

  // The v4 Profile exposes a derived integer `age`.
  if (typeof data.age !== "number") {
    throw new Error("HEALTH_API_ERROR");
  }
  const ageYears = data.age;

  // sex is not part of the v4 Profile → NA (parse defensively in case it ever appears).
  const sex = parseSex(data.sex);

  // height is its own data type, not a profile field — null when the user has none.
  // Tolerate it (mirror the sex→NA tolerance); the goals layer applies a fallback.
  const heightCm = await getHealthHeightCm(accessToken, l, userId, criticality);

  l.debug({ action: "health_get_profile_success", heightAvailable: heightCm !== null }, "profile fetched");
  return { ageYears, sex, heightCm };
}

/**
 * Fetch the most recent weight log on or before targetDate from Google Health.
 *
 * Reads the v4 `weight` data type's dataPoints and returns the most-recent sample
 * on/before targetDate within a 14-day window, or null if empty. Per the v4 discovery
 * schema, Weight carries `weightGrams` (double) + `sampleTime.physicalTime` (RFC3339),
 * so kg = weightGrams / 1000.
 *
 * NOTE: the v4 ranged-read filter syntax isn't confirmed, so points are fetched
 * (pageSize 100) and filtered client-side to the window.
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
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  const points = Array.isArray(data.dataPoints) ? (data.dataPoints as Array<Record<string, unknown>>) : [];

  // Parse weight samples (weightGrams → kg), keep those within [startDate, targetDate].
  const valid: Array<{ weightKg: number; date: string }> = [];
  for (const p of points) {
    const w = p.weight as Record<string, unknown> | undefined;
    if (!w || typeof w.weightGrams !== "number") continue;
    const d = extractSampleDate(w.sampleTime);
    if (!d || d < startDate || d > targetDate) continue;
    valid.push({ weightKg: w.weightGrams / 1000, date: d });
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
 * Returns { caloriesOut: number } summed from the v4 daily roll-up's `kcalSum`, or
 * { caloriesOut: null } if the roll-up is empty (no throw).
 *
 * Request/response shape verified against the v4 discovery doc: POST `:dailyRollUp` with
 * { range: CivilTimeInterval, windowSizeDays } → { rollupDataPoints: DailyRollupDataPoint[] },
 * each carrying `totalCalories: TotalCaloriesRollupValue { kcalSum }` for the `total-calories`
 * data type. Whether live data is actually present/populated is gated on the smoke test
 * (FOO-1115).
 */
export async function getHealthActivitySummary(
  accessToken: string,
  date: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
  zoneOffset?: string | null,
): Promise<ActivitySummary> {
  const l = log ?? logger;
  l.debug({ action: "health_get_activity_summary", date }, "fetching activity summary from Google Health");

  // v4 DailyRollUp requires a `range` (CivilTimeInterval { start, end } of CivilDateTime),
  // NOT {startTime,endTime}. The interval is closed-open, so `end` is the NEXT civil day
  // (start == end would be a zero-length window → no points). windowSizeDays:1 → one bucket.
  const response = await fetchWithRetry(
    `${dataPointsUrl("total-calories")}:dailyRollUp`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        range: {
          start: civilDateTime(date, zoneOffset),
          end: civilDateTime(addDays(date, 1), zoneOffset),
        },
        windowSizeDays: 1,
      }),
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "health_get_activity_summary_failed", status: response.status, errorBody }, "activity summary fetch failed");
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);
  // Per the v4 discovery schema, a daily-rollup response is
  // { rollupDataPoints: [ { ...value union... } ] }, and the total-calories value is a
  // TotalCaloriesRollupValue carrying `kcalSum`. Sum kcalSum across the day's point(s).
  const rollupPoints = Array.isArray(data.rollupDataPoints)
    ? (data.rollupDataPoints as Array<Record<string, unknown>>)
    : [];

  // Read the calories-out total explicitly from each point's `totalCalories.kcalSum`
  // (TotalCaloriesRollupValue). A DailyRollupDataPoint can carry several other `kcalSum`
  // fields (activeEnergyBurned, nutritionLog.energy, …), so we must NOT first-match any
  // kcalSum — only the totalCalories leaf is the calories-out figure.
  let kcal: number | null = null;
  for (const point of rollupPoints) {
    const totalCalories = point.totalCalories as Record<string, unknown> | undefined;
    const k = totalCalories && typeof totalCalories.kcalSum === "number" ? totalCalories.kcalSum : null;
    if (k !== null) kcal = (kcal ?? 0) + k;
  }

  if (kcal === null) {
    l.debug({ action: "health_get_activity_summary_empty", date }, "activity summary caloriesOut not yet available");
    return { caloriesOut: null };
  }

  const caloriesOut = Math.round(kcal);
  l.debug({ action: "health_get_activity_summary_success", date, caloriesOut }, "activity summary fetched");
  return { caloriesOut };
}
