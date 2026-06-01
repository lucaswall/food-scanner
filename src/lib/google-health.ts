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
