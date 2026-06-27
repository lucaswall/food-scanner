import * as Sentry from "@sentry/nextjs";
import { logger, startTimer } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getHealthTokens, upsertHealthTokens, deleteHealthTokens } from "@/lib/health-tokens";
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

/**
 * Sleep for `ms` milliseconds, but abort early if `signal` fires.
 * Rejects with an AbortError when the signal fires before the timer completes.
 * Used for the 429 Retry-After sleep so callers can cancel mid-wait.
 */
function abortableSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    let onAbort: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * If the token expires within this window, we treat it as near-expired and
 * proactively refresh it. 5 minutes — must stay well BELOW the ~1h access-token
 * lifetime, otherwise a freshly minted token never satisfies the fast-return
 * check and every Health op forces a refresh + DB upsert (P1-6).
 */
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1000;

/**
 * Returns true if a parsed 403 response body signals Google Cloud quota exhaustion.
 * Quota-exhaustion RESOURCE_EXHAUSTED shape: `{ error: { status: "RESOURCE_EXHAUSTED" } }`.
 *
 * NOTE: Google Health quota exhaustion almost always arrives as HTTP 429, not 403 (see
 * the §6 discovery-doc ground truth: "Quota exhaustion returns 429"). A RESOURCE_EXHAUSTED
 * body carried on a 403 is a rare, defensive case — this predicate exists so that branch
 * is treated as a rate limit rather than a scope error, not because 403 is the normal
 * quota path. A 403 WITHOUT RESOURCE_EXHAUSTED (PERMISSION_DENIED etc.) is a scope/permission
 * problem and must map differently.
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
 * Extract a back-off duration (ms) from a `google.rpc.RetryInfo` entry in the error body's
 * `error.details[]`. Google Cloud conveys the suggested wait here (e.g. `retryDelay: "30s"`)
 * far more often than via a `Retry-After` header (P1-4). Returns null when absent/malformed.
 */
function parseRetryDelayMs(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const err = (body as Record<string, unknown>).error;
  if (!err || typeof err !== "object") return null;
  const details = (err as Record<string, unknown>).details;
  if (!Array.isArray(details)) return null;
  for (const det of details) {
    if (det && typeof det === "object") {
      const dd = det as Record<string, unknown>;
      const type = typeof dd["@type"] === "string" ? (dd["@type"] as string) : "";
      if (type.includes("RetryInfo") && typeof dd.retryDelay === "string") {
        // google.protobuf.Duration string, e.g. "30s" or "1.500s".
        const m = /^([\d.]+)s$/.exec(dd.retryDelay.trim());
        if (m) return Math.ceil(Number(m[1]) * 1000);
      }
    }
  }
  return null;
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
  idempotent = true,
): Promise<Response> {
  // Extract the caller's AbortSignal (if any) for use in retry sleeps.
  // Note: each fetch attempt uses its own internal timeout controller, so options.signal
  // is NOT passed directly to fetch — we preserve it here only for the sleep race.
  const callerSignal: AbortSignal | undefined = options.signal ?? undefined;
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
    let response: Response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err) {
      // The per-request timeout (controller) fired — surface a typed timeout rather than a
      // bare AbortError that the route layer would map to a generic 500 (P1-15).
      if (err instanceof Error && err.name === "AbortError" && controller.signal.aborted) {
        l.warn(
          { action: "health_request_timeout", url, timeoutMs: REQUEST_TIMEOUT_MS },
          "per-request timeout aborted the Google Health fetch",
        );
        throw new Error("HEALTH_TIMEOUT");
      }
      throw err;
    }

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
      // Log the upstream body before throwing — otherwise a 401 surfaces as a bare code
      // with no clue (expired token vs revoked grant vs wrong audience).
      l.warn(
        { action: "health_401_unauthorized", url, errorBody: sanitizeErrorBody(await parseErrorBody(response)) },
        "401 from Google Health — token invalid/expired",
      );
      throw new Error("HEALTH_TOKEN_INVALID");
    }

    if (response.status === 403) {
      // A 403 is almost always a scope/permission error — quota exhaustion comes back
      // as 429 (handled below), not 403. We still read the body once to catch the rare,
      // defensive case where Google attaches a RESOURCE_EXHAUSTED status to a 403.
      // Scope/permission error: { error: { status: "PERMISSION_DENIED" } } or similar.
      // Defensive quota case: { error: { status: "RESOURCE_EXHAUSTED" } }.
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
      // Scope/permission 403: log Google's body (already parsed above) so the reason is
      // visible — the most likely first-write failure is a scope grant issue.
      l.warn(
        { action: "health_403_scope", url, errorBody: sanitizeErrorBody(rawBody) },
        "403 from Google Health — scope/permission denied",
      );
      throw new Error("HEALTH_SCOPE_MISSING");
    }

    if (response.status === 429) {
      // Allow at most 1 retry on 429. Amplifying retries during a rate-limit
      // event makes things worse for everyone.
      if (retryCount >= 1) {
        throw new Error("HEALTH_RATE_LIMIT");
      }

      // Google conveys the back-off via a Retry-After header (rare) OR a
      // google.rpc.RetryInfo.retryDelay inside the error body (common). Prefer whichever
      // is present; with NEITHER, do not do a futile sub-second retry inside the same
      // per-minute window — give up and let the recorded cooldown gate further calls (P1-4).
      const retryAfterMs =
        parseRetryAfter(response.headers.get("Retry-After")) ??
        parseRetryDelayMs(await parseErrorBody(response));

      if (retryAfterMs === null) {
        l.warn(
          { action: "health_rate_limit_no_backoff_hint" },
          "rate limited with no Retry-After/RetryInfo; not retrying (cooldown active)",
        );
        throw new Error("HEALTH_RATE_LIMIT");
      }

      const deadlineRemaining = DEADLINE_MS - (Date.now() - startTime);
      if (retryAfterMs > deadlineRemaining) {
        l.warn(
          { action: "health_rate_limit_no_retry", retryAfterMs, deadlineRemaining },
          "rate limited; back-off exceeds deadline, giving up",
        );
        throw new Error("HEALTH_RATE_LIMIT");
      }
      l.warn(
        { action: "health_rate_limit", retryAfterMs },
        "rate limited, sleeping per back-off hint",
      );
      await abortableSleep(retryAfterMs, callerSignal);
      return fetchWithRetry(url, options, retryCount + 1, startTime, l, userId, criticality, idempotent);
    }

    if (response.status >= 500) {
      // Never retry a non-idempotent request (e.g. nutrition create): a 5xx may mean the
      // write committed before the response failed, so a retry would duplicate it (P1-8).
      if (!idempotent || retryCount >= MAX_RETRIES) {
        return response;
      }
      // Exponential back-off with full jitter to avoid synchronized retry storms (P2-14).
      const base = Math.pow(2, retryCount) * 1000;
      const delay = Math.floor(base / 2 + Math.random() * (base / 2));
      l.warn(
        {
          action: "health_server_error",
          status: response.status,
          retryCount,
          delay,
        },
        "server error, retrying",
      );
      await abortableSleep(delay, callerSignal);
      return fetchWithRetry(url, options, retryCount + 1, startTime, l, userId, criticality, idempotent);
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
  const elapsed = startTimer();
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
      { action: "google_health_token_refresh_success", durationMs: elapsed() },
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

  // Check in-flight FIRST (before any await) — dedup window brackets the entire refresh
  // including the initial token read so concurrent callers always join a single promise.
  const existing = refreshInFlight.get(userId);
  if (existing) {
    return existing;
  }

  // Register the promise synchronously BEFORE any await so concurrent callers arriving in
  // the same sync-execution batch see it immediately and join rather than starting a
  // parallel refresh.
  const promise = (async (): Promise<string> => {
    try {
      const tokenRow = await getHealthTokens(userId, l);
      if (!tokenRow) {
        throw new Error("HEALTH_TOKEN_INVALID");
      }

      // Token is fresh — return immediately.
      if (tokenRow.expiresAt.getTime() >= Date.now() + TOKEN_EXPIRY_SKEW_MS) {
        return tokenRow.accessToken;
      }

      // Still near-expired — proceed with refresh.
      // Google does NOT rotate the refresh token — preserve the existing one.
      let tokens: { access_token: string; expires_in: number };
      try {
        tokens = await refreshGoogleHealthToken(tokenRow.refreshToken, l);
      } catch (refreshError) {
        // A DEFINITIVE HEALTH_TOKEN_INVALID (the 400/401 path) means the refresh
        // token is revoked/expired and will never recover. Delete the dead token
        // row so the next checkHealthConnection flips to `needs_reconnect` and the
        // UI prompts a reconnect — otherwise the row lingers and the connection is
        // silently reported `healthy` forever (P1-5). Best-effort: a delete failure
        // must NOT mask the original auth error. HEALTH_REFRESH_TRANSIENT is left
        // untouched (the token may still be valid on the next attempt).
        if (refreshError instanceof Error && refreshError.message === "HEALTH_TOKEN_INVALID") {
          try {
            await deleteHealthTokens(userId, l);
            l.warn(
              { action: "health_token_revoked_reconciled", userId },
              "refresh token revoked/expired — deleted dead token row to force reconnect",
            );
          } catch (deleteError) {
            l.error(
              {
                action: "health_token_revoked_reconcile_failed",
                userId,
                error: deleteError instanceof Error ? deleteError.message : String(deleteError),
              },
              "failed to delete revoked token row — connection may still report healthy",
            );
          }
        }
        throw refreshError;
      }

      const tokenData = {
        healthUserId: tokenRow.healthUserId,
        accessToken: tokens.access_token,
        refreshToken: tokenRow.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scope: tokenRow.scope,
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
 * gRPC status codes (google.rpc.Code) used in `Operation.error.code`. The Google Health
 * API surfaces long-running-operation failures INSIDE the Operation envelope (HTTP 200 +
 * `{ done, error: { code, message } }`), NOT as an HTTP status — so these are how we
 * distinguish "already gone" (NOT_FOUND) from a hard failure.
 */
const GRPC_INVALID_ARGUMENT = 3;
const GRPC_NOT_FOUND = 5;
const GRPC_PERMISSION_DENIED = 7;

interface ParsedOperation {
  /** True when the payload looks like an Operation (boolean `done` or an `operations/…` name). */
  isOperation: boolean;
  /** Operation completion. A direct (non-Operation) DataPoint payload is treated as done. */
  done: boolean;
  /** google.rpc.Code from `Operation.error.code`, or null when there is no error. */
  errorCode: number | null;
  errorMessage: string | null;
  /**
   * The created resource name: `Operation.response.name` (done-inline LRO) or the
   * top-level `name` when the payload is a direct DataPoint. Null for an `operations/…`
   * name (the Operation's own name is not the created resource name).
   */
  resourceName: string | null;
}

/**
 * Parse a `create`/`batchDelete` 2xx body. Both methods return a long-running `Operation`
 * (`{ name: "operations/…", done, response, error }`); a synchronously-completed call may
 * instead return the resource (DataPoint) inline. The Google Health API exposes NO
 * `operations.get` method, so an incomplete (`done:false`) Operation is UNRECOVERABLE —
 * callers must fail loudly rather than treat it as success (P0-2/P0-3).
 */
function parseOperation(data: unknown): ParsedOperation {
  if (!data || typeof data !== "object") {
    // A non-JSON / empty 2xx body cannot be confirmed — treat as not-done so callers fail loud.
    return { isOperation: false, done: false, errorCode: null, errorMessage: null, resourceName: null };
  }
  const d = data as Record<string, unknown>;
  const hasDone = typeof d.done === "boolean";
  const nameIsOperation = typeof d.name === "string" && (d.name as string).startsWith("operations/");

  let errorCode: number | null = null;
  let errorMessage: string | null = null;
  const err = d.error;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.code === "number") errorCode = e.code;
    if (typeof e.message === "string") errorMessage = e.message;
  }

  let resourceName: string | null = null;
  const resp = d.response;
  if (resp && typeof resp === "object" && typeof (resp as Record<string, unknown>).name === "string") {
    resourceName = (resp as Record<string, unknown>).name as string;
  } else if (typeof d.name === "string" && !nameIsOperation) {
    resourceName = d.name as string;
  }

  return {
    isOperation: hasDone || nameIsOperation,
    // A direct DataPoint (no `done` field, real resource name) is complete by definition.
    done: hasDone ? (d.done as boolean) : true,
    errorCode,
    errorMessage,
    resourceName,
  };
}

/** Extract the trailing dataPoint id from a resource name `users/.../dataPoints/{id}`. */
function extractDataPointId(name: string | null): string | null {
  if (typeof name !== "string") return null;
  const m = /\/dataPoints\/([^/]+)$/.exec(name);
  return m ? m[1] : null;
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
  const elapsed = startTimer();

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
    // create is NOT idempotent — never retry on 5xx (would duplicate the log). P1-8.
    0, Date.now(), l, userId, "critical", false,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      // Log the request-body field shape (not values) so a field-level rejection is
      // diagnosable without forwarding the food name/macros (PII) to logs/Sentry (P1-10).
      {
        action: "health_create_nutrition_log_failed",
        status: response.status,
        errorBody,
        requestBodyKeys: Object.keys((body.nutritionLog as Record<string, unknown> | undefined) ?? {}),
        durationMs: elapsed(),
      },
      "nutrition log creation failed",
    );
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  // create returns a long-running Operation. There is NO operations.get method and
  // nutrition is writeonly (no read-back), so the server-assigned dataPoint id is
  // recoverable ONLY from a done-inline Operation (done:true + response.name). An errored
  // or still-in-progress Operation is unrecoverable and FAILS LOUDLY rather than silently
  // persisting a write we can never reference for edit/delete (P0-2). The FOO-1115 live
  // smoke test confirms create completes synchronously.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const op = parseOperation(parsed);
  // Log only the response key shape (not the body) so the live sync-vs-async behavior is
  // diagnosable without forwarding any payload to logs/Sentry.
  const responseKeys = parsed && typeof parsed === "object" ? Object.keys(parsed as Record<string, unknown>) : [];

  if (op.errorCode !== null) {
    l.error(
      { action: "health_create_nutrition_log_op_error", errorCode: op.errorCode, errorMessage: op.errorMessage, durationMs: elapsed() },
      "nutrition log create returned an Operation error",
    );
    throw new Error(op.errorCode === GRPC_INVALID_ARGUMENT ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }
  if (!op.done) {
    l.error(
      { action: "health_create_nutrition_log_async", responseKeys, durationMs: elapsed() },
      "nutrition log create returned an incomplete async Operation — id unrecoverable (no operations.get; nutrition is writeonly)",
    );
    throw new Error("HEALTH_API_ERROR");
  }
  const healthLogId = extractDataPointId(op.resourceName);
  if (healthLogId === null) {
    l.error(
      { action: "health_create_nutrition_log_no_id", responseKeys, durationMs: elapsed() },
      "nutrition log create completed but no dataPoint name in response — cannot reference for edit/delete",
    );
    throw new Error("HEALTH_API_ERROR");
  }
  l.info({ action: "health_create_nutrition_log_success", healthLogId, responseKeys, durationMs: elapsed() }, "nutrition log created");
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
  const elapsed = startTimer();

  if (isHealthDryRun()) {
    l.debug({ action: "health_delete_nutrition_logs_dry_run" }, "dry run: skipping nutrition log deletion");
    return;
  }

  // Nothing to delete — batchDelete with an empty names array would be a no-op but
  // consumes a rate-limit slot unnecessarily; short-circuit early.
  if (ids.length === 0) {
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

  // NOT_FOUND handling shared by the HTTP-404 gateway fallback and the Operation
  // error.code===5 path: idempotent for cleanup/compensation; a hard error for a
  // user-initiated delete (the DB id has no live Health entry — surface the drift).
  const handleNotFound = (): void => {
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
  };

  // batchDelete is a long-running Operation: NOT_FOUND and other failures surface as
  // Operation.error.code (google.rpc.Code) with HTTP 200, NOT as an HTTP status. The
  // HTTP-404 check is kept only as a gateway-level fallback.
  if (response.status === 404) {
    handleNotFound();
    return;
  }

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error(
      { action: "health_delete_nutrition_logs_failed", status: response.status, errorBody, durationMs: elapsed() },
      "nutrition log deletion failed",
    );
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  // 2xx: success is `done && no error` in the Operation envelope, NOT the HTTP status.
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const op = parseOperation(parsed);

  if (op.errorCode === GRPC_NOT_FOUND) {
    handleNotFound();
    return;
  }
  if (op.errorCode !== null) {
    l.error(
      { action: "health_delete_nutrition_logs_op_error", errorCode: op.errorCode, errorMessage: op.errorMessage, ids, durationMs: elapsed() },
      "nutrition log deletion returned an Operation error",
    );
    throw new Error(
      op.errorCode === GRPC_INVALID_ARGUMENT || op.errorCode === GRPC_PERMISSION_DENIED ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR",
    );
  }
  if (!op.done) {
    // No operations.get to poll — an unconfirmed delete must NOT be reported as success,
    // or the caller would proceed to recreate / drop the local row and risk a duplicate.
    l.error(
      { action: "health_delete_nutrition_logs_unconfirmed", ids, durationMs: elapsed() },
      "nutrition log deletion returned an incomplete async Operation — cannot confirm deletion (no operations.get)",
    );
    throw new Error("HEALTH_API_ERROR");
  }

  l.info({ action: "health_delete_nutrition_logs_success", idCount: ids.length, durationMs: elapsed() }, "nutrition logs deleted");
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
 * Build a v4 `CivilDateTime` ({ date: { year, month, day } }) from a YYYY-MM-DD string.
 *
 * `CivilDateTime` is timezone-agnostic BY DESIGN: the discovery schema explicitly
 * forbids any timezone/offset field ("ensures that neither the timezone nor the UTC
 * offset can be set ... to avoid confusion between civil and physical time queries").
 * The CALLER selects which civil date (already in the user's timezone) and passes it
 * here. An earlier version embedded a `utcOffset` duration (FOO-1134) — that field does
 * not exist on `CivilDateTime` and Google's JSON parser rejects the body with
 * 400 INVALID_ARGUMENT, breaking the calories-out read. Never re-add it (P0-4).
 */
function civilDateTime(dateStr: string): Record<string, unknown> {
  const parts = dateStr.split("-").map(Number);
  // Fail fast on a malformed date rather than POSTing { year: NaN, … } and getting an
  // opaque upstream 400.
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
    throw new Error(`Invalid YYYY-MM-DD date for Google Health civil interval: ${dateStr}`);
  }
  const [year, month, day] = parts;
  return { date: { year, month, day } };
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
  // Take the most-recent parseable height by sample time. Don't rely on response ordering:
  // the doc documents interval-start ordering, which doesn't apply to sample observations (P2-1).
  const valid: Array<{ cm: number; date: string }> = [];
  for (const p of points) {
    const h = p.height as Record<string, unknown> | undefined;
    if (!h) continue;
    const cm = parseHeightCm(h);
    if (cm === null) continue;
    valid.push({ cm, date: extractSampleDate(h.sampleTime) ?? "" });
  }
  if (valid.length > 0) {
    valid.sort((a, b) => b.date.localeCompare(a.date));
    return valid[0].cm;
  }
  // No height parsed. Log the dataPoint count + key shape (not the body) so "genuinely no
  // height" is distinguishable from a shape change (e.g. heightMillimeters renamed) without
  // forwarding biometric PII to logs (P2-8).
  l.debug(
    { action: "health_get_height_not_found", dataPointCount: points.length, responseKeys: Object.keys(data) },
    "no parseable height dataPoint in response",
  );
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
 * Profile shape verified against the v4 discovery doc (`Profile` carries `age`, no
 * sex/height). Whether the live account is populated is what the smoke test exercises.
 */
export async function getHealthProfile(
  accessToken: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthProfile> {
  const l = log ?? logger;
  const elapsed = startTimer();
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
    l.error({ action: "health_get_profile_failed", status: response.status, errorBody, durationMs: elapsed() }, "profile fetch failed");
    throw new Error(response.status < 500 ? "HEALTH_BAD_REQUEST" : "HEALTH_API_ERROR");
  }

  const data = await jsonWithTimeout<Record<string, unknown>>(response);

  // The v4 Profile exposes a derived integer `age`, but it is OPTIONAL (absent when the
  // account has no birth date). Degrade to 0 rather than throwing: the macro engine's
  // INVALID_PROFILE_DATA guard (ageYears <= 0) turns this into a resolved "blocked" goals
  // state (HTTP 200) instead of a 502 that bricks the entire goals/macro feature (P1-1).
  // Log only the key shape — never the raw profile body (PII) (P1-10).
  const ageYears = typeof data.age === "number" ? data.age : 0;
  if (ageYears === 0) {
    l.warn(
      { action: "health_get_profile_no_age", profileKeys: Object.keys(data), durationMs: elapsed() },
      "Google Health profile has no numeric `age` (optional field absent) — goals will degrade to blocked",
    );
  }

  // sex is not part of the v4 Profile → NA (parse defensively in case it ever appears).
  const sex = parseSex(data.sex);

  // height is its own data type, not a profile field — null when the user has none.
  // Tolerate it (mirror the sex→NA tolerance); the goals layer applies a fallback.
  const heightCm = await getHealthHeightCm(accessToken, l, userId, criticality);

  // Log the parsed fields + raw profile keys so a live shape change (e.g. sex ever
  // appearing, or age in a different unit) is visible during testing.
  l.debug(
    { action: "health_get_profile_success", ageYears, sex, heightCm, profileKeys: Object.keys(data), durationMs: elapsed() },
    "profile fetched",
  );
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
 * Uses the documented AIP-160 `filter` (weight.sample_time.civil_time range) to scope the
 * window server-side; client-side window filtering is retained as a safety net (P1-2).
 */
export async function getHealthLatestWeightKg(
  accessToken: string,
  targetDate: string,
  log?: Logger,
  userId?: string,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthWeightLog | null> {
  const l = log ?? logger;
  const elapsed = startTimer();
  const startDate = subtractDays(targetDate, 13); // 14 days inclusive
  l.debug(
    { action: "health_get_weight", targetDate, startDate, windowDays: 14 },
    "fetching weight from Google Health (14-day window)",
  );

  const url = new URL(dataPointsUrl("weight"));
  url.searchParams.set("pageSize", "100");
  // Server-side time window (AIP-160): `<` is exclusive, so the upper bound is the day
  // AFTER targetDate to include it. Fixes the >100-sample / past-date-null edge cases the
  // old client-only filter had; client-side filtering below still guarantees exactness (P1-2).
  url.searchParams.set(
    "filter",
    `weight.sample_time.civil_time >= "${startDate}" AND weight.sample_time.civil_time < "${addDays(targetDate, 1)}"`,
  );

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
    l.error({ action: "health_get_weight_failed", status: response.status, errorBody, durationMs: elapsed() }, "weight fetch failed");
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
    // Include the raw response so an empty window is distinguishable from a shape change
    // (e.g. weightGrams / sampleTime renamed) during the smoke test.
    l.debug(
      { action: "health_get_weight_not_found", targetDate, dataPointCount: points.length, responseKeys: Object.keys(data) },
      "no weight found in 14-day window",
    );
    return null;
  }

  // Sort by date descending → take the most recent
  valid.sort((a, b) => b.date.localeCompare(a.date));
  const latest = valid[0];

  l.debug({ action: "health_get_weight_success", loggedDate: latest.date, weightKg: latest.weightKg, durationMs: elapsed() }, "weight fetched");
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
): Promise<ActivitySummary> {
  const l = log ?? logger;
  const elapsed = startTimer();
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
          start: civilDateTime(date),
          end: civilDateTime(addDays(date, 1)),
        },
        windowSizeDays: 1,
      }),
    },
    0, Date.now(), l, userId, criticality,
  );

  if (!response.ok) {
    const rawBody = await parseErrorBody(response);
    const errorBody = sanitizeErrorBody(rawBody);
    l.error({ action: "health_get_activity_summary_failed", status: response.status, errorBody, durationMs: elapsed() }, "activity summary fetch failed");
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
    // Include the raw response so "no activity data yet" is distinguishable from a shape
    // change (e.g. totalCalories.kcalSum nesting differs) during the smoke test.
    l.debug(
      { action: "health_get_activity_summary_empty", date, rollupPointCount: rollupPoints.length, responseKeys: Object.keys(data) },
      "activity summary caloriesOut not yet available",
    );
    return { caloriesOut: null };
  }

  const caloriesOut = Math.round(kcal);
  l.debug({ action: "health_get_activity_summary_success", date, caloriesOut, durationMs: elapsed() }, "activity summary fetched");
  return { caloriesOut };
}
