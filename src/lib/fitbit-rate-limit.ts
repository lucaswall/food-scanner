import { logger as defaultLogger, type Logger } from "@/lib/logger";

export interface FitbitRateLimitSnapshot {
  limit: number;
  remaining: number;
  resetAt: number;
}

type ThresholdTier = "ok" | "low" | "critical";

const snapshots = new Map<string, FitbitRateLimitSnapshot>();
const lastTier = new Map<string, ThresholdTier>();

const LOW_TIER_THRESHOLD = 30;
const CRITICAL_TIER_THRESHOLD = 10;

function classifyTier(remaining: number): ThresholdTier {
  if (remaining < CRITICAL_TIER_THRESHOLD) return "critical";
  if (remaining < LOW_TIER_THRESHOLD) return "low";
  return "ok";
}

function parseIntOrNaN(value: string | null): number {
  if (value === null) return Number.NaN;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Parse Fitbit-Rate-Limit-* headers off a fetch response and update the per-user snapshot.
 * Silently no-ops if userId is undefined or any required header is missing/NaN.
 * Logs at warn level only when the snapshot transitions into a lower-headroom tier.
 */
export function recordRateLimitHeaders(
  userId: string | undefined,
  response: Response,
  log?: Logger,
): void {
  if (!userId) return;

  const limit = parseIntOrNaN(response.headers.get("Fitbit-Rate-Limit-Limit"));
  const remaining = parseIntOrNaN(response.headers.get("Fitbit-Rate-Limit-Remaining"));
  const resetSeconds = parseIntOrNaN(response.headers.get("Fitbit-Rate-Limit-Reset"));

  if (Number.isNaN(limit) || Number.isNaN(remaining) || Number.isNaN(resetSeconds)) {
    return;
  }

  const resetAt = Date.now() + resetSeconds * 1000;
  snapshots.set(userId, { limit, remaining, resetAt });

  const tier = classifyTier(remaining);
  const previousTier = lastTier.get(userId) ?? "ok";

  // Warn only when the headroom tier worsens (ok → low, ok → critical, low → critical).
  const tierRank: Record<ThresholdTier, number> = { ok: 0, low: 1, critical: 2 };
  if (tierRank[tier] > tierRank[previousTier]) {
    (log ?? defaultLogger).warn(
      {
        action: "fitbit_rate_limit_warn",
        userId,
        limit,
        remaining,
        resetAt,
        tier,
      },
      `Fitbit rate-limit headroom dropped to ${tier} (${remaining}/${limit} remaining)`,
    );
  }

  lastTier.set(userId, tier);
}

/**
 * Returns the latest known rate-limit snapshot for a user, or null if never observed
 * or stale (resetAt has passed).
 */
export function getRateLimitSnapshot(
  userId: string,
): FitbitRateLimitSnapshot | null {
  const snap = snapshots.get(userId);
  if (!snap) return null;
  if (snap.resetAt < Date.now()) return null;
  return snap;
}

// ─── Circuit breaker ────────────────────────────────────────────────────────

export type FitbitCallCriticality = "critical" | "important" | "optional";

const BREAKER_OPTIONAL_FLOOR = 20;
const BREAKER_IMPORTANT_FLOOR = 5;

/**
 * Throws `FITBIT_RATE_LIMIT_LOW` if the call should be blocked given the
 * user's current rate-limit headroom snapshot. Returns void otherwise.
 *
 * Rules:
 *   - Snapshot null (cold start or stale) → allow all.
 *   - remaining ≥ 20 → allow all.
 *   - 5 ≤ remaining < 20 → reject `optional` only.
 *   - remaining < 5 → allow `critical` only.
 */
export function assertRateLimitAllowed(
  userId: string,
  criticality: FitbitCallCriticality,
  log?: Logger,
): void {
  const snap = getRateLimitSnapshot(userId);
  if (!snap) return;

  const { remaining } = snap;

  if (remaining >= BREAKER_OPTIONAL_FLOOR) return;
  if (remaining >= BREAKER_IMPORTANT_FLOOR && criticality !== "optional") return;
  if (criticality === "critical") {
    // Always proceed for critical writes/refresh, but log so operators see the
    // call going through despite a low budget.
    (log ?? defaultLogger).warn(
      {
        action: "fitbit_breaker_critical_bypass",
        userId,
        criticality,
        remaining,
      },
      `Fitbit critical call proceeding with low headroom (remaining=${remaining})`,
    );
    return;
  }

  (log ?? defaultLogger).warn(
    {
      action: "fitbit_breaker_reject",
      userId,
      criticality,
      remaining,
    },
    `Fitbit circuit breaker rejecting ${criticality} call (remaining=${remaining})`,
  );
  throw new Error("FITBIT_RATE_LIMIT_LOW");
}

/** Test-only: clears all in-memory state. */
export function _resetForTests(): void {
  snapshots.clear();
  lastTier.clear();
}
