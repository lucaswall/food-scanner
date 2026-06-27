import type { HealthProfile, HealthWeightLog, ActivitySummary } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import {
  ensureFreshToken,
  getHealthProfile,
  getHealthLatestWeightKg,
  getHealthActivitySummary,
  type HealthCallCriticality,
} from "@/lib/google-health";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_1H = 60 * 60 * 1000;
const TTL_10MIN = 10 * 60 * 1000;
const TTL_5MIN = 5 * 60 * 1000;

// ─── Serve-stale-on-error retention windows (P1-9) ──────────────────────────
// During the Google Health v4 cutover window a transient upstream failure after
// the short fresh TTL should NOT hard-fail the dashboard. We retain the last
// successful value for a window well beyond its fresh TTL so the cached getters
// can serve it (stale-while-erroring) when a TRANSIENT read error is thrown.
// This consciously trades against the CLAUDE.md "freshness preferred" default —
// the trade is intentionally narrow (transient errors only; see
// isTransientHealthError) and scoped to the cutover.
const STALE_PROFILE = 7 * 24 * 60 * 60 * 1000; // 7 days  (profile rarely changes)
const STALE_WEIGHT = 24 * 60 * 60 * 1000; //       24 hours
const STALE_ACTIVITY = 6 * 60 * 60 * 1000; //       6 hours

// ─── Transient-error classification (P1-9) ───────────────────────────────────
// Only these codes are eligible for serve-stale. HEALTH_TOKEN_INVALID and
// HEALTH_SCOPE_MISSING are deliberately EXCLUDED: those require the user to
// reconnect and MUST surface rather than be masked by a stale value.
// NOTE: daily-goals.ts keeps its own copy of this set (it must classify the same
// codes for its last-known-good row fallback); keep the two in sync. The proper
// long-term home is a shared helper in `src/lib/health-error-response.ts`.
const TRANSIENT_HEALTH_CODES = new Set<string>([
  "HEALTH_API_ERROR",
  "HEALTH_TIMEOUT",
  "HEALTH_RATE_LIMIT",
  "HEALTH_RATE_LIMIT_LOW",
  "HEALTH_REFRESH_TRANSIENT",
]);

function isTransientHealthError(error: unknown): boolean {
  const code = error instanceof Error ? error.message : String(error);
  return TRANSIENT_HEALTH_CODES.has(code);
}

// ─── Shared TTL-cache helper ────────────────────────────────────────────────
// Mirrors the canonical eviction shape from rate-limit.ts:
//   cleanExpiredEntries, evictOldest, MAX_*_SIZE=1000, periodic CLEANUP_INTERVAL sweep + hard cap.

const MAX_CACHE_SIZE = 1000;
const CACHE_CLEANUP_INTERVAL = 100;

interface CacheEntry<T> {
  value: T;
  /** Fresh-TTL boundary: `get()` returns the value only before this. */
  expiresAt: number;
  /** Stale-retention boundary: `getStale()` serves the value before this; cleanup removes after. */
  staleUntil: number;
}

class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private callCount = 0;

  /**
   * Returns the cached value if present and still FRESH (within its TTL).
   * Past the TTL it is a miss, but the entry is intentionally retained (not
   * deleted) so `getStale()` can still serve it on a transient fetch error;
   * the stale entry is reclaimed by cleanup / eviction or overwritten on the
   * next successful fetch.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry.value;
  }

  /**
   * Returns the last successful value past its fresh TTL, as long as it is still
   * within the stale-retention window. Used to serve-stale on transient read
   * errors (P1-9). Returns `undefined` when no entry exists or the stale window
   * has elapsed (the entry is then evicted). Note: a stored value of `null`
   * (e.g. "no weight") is a real last-known value and is returned as `null`,
   * distinct from `undefined` "no entry".
   */
  getStale(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.staleUntil <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Stores a value with the given fresh TTL, running periodic cleanup and
   * enforcing the size cap. `staleMs` is the stale-retention window measured
   * from now (must be >= ttlMs); it defaults to `ttlMs` (no extra retention).
   */
  set(key: string, value: T, ttlMs: number, staleMs: number = ttlMs): void {
    const now = Date.now();
    this.callCount++;
    if (this.callCount % CACHE_CLEANUP_INTERVAL === 0 || this.store.size >= MAX_CACHE_SIZE) {
      this.cleanExpired(now);
    }
    if (this.store.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }
    this.store.set(key, { value, expiresAt: now + ttlMs, staleUntil: now + Math.max(ttlMs, staleMs) });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  /** Removes entries past their stale-retention window (not merely their fresh TTL). */
  private cleanExpired(now: number): void {
    for (const [k, v] of this.store) {
      if (v.staleUntil <= now) this.store.delete(k);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [k, v] of this.store) {
      if (v.staleUntil < oldestExpiry) {
        oldestExpiry = v.staleUntil;
        oldestKey = k;
      }
    }
    if (oldestKey) this.store.delete(oldestKey);
  }
}

// Per-user generation, bumped on each invalidation. Each fetcher snapshots
// the user's current generation when it starts; if it has changed by the
// time the underlying fetch resolves, the resolved value belongs to a
// pre-invalidation request and must not be written to cache (otherwise an
// orphan write can overwrite fresh data from a refresh-triggered fetch that
// finished earlier). Per-user — invalidating one user must not suppress
// cache writes for unrelated users' in-flight fetches.
const userCacheGeneration = new Map<string, number>();

function getUserGeneration(userId: string): number {
  return userCacheGeneration.get(userId) ?? 0;
}

// ─── Profile cache ─────────────────────────────────────────────────────────

const profileCache = new TtlCache<HealthProfile>();
const profileInFlight = new Map<string, Promise<HealthProfile>>();

export async function getCachedHealthProfile(
  userId: string,
  log?: Logger,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthProfile> {
  const l = log ?? logger;

  const cached = profileCache.get(userId);
  if (cached !== undefined) {
    return cached;
  }

  const inflightKey = `${userId}:${criticality}`;
  const existing = profileInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  // `let !` so the IIFE's `finally` can compare against the bound promise:
  // by the time finally runs (after both awaits), assignment has completed.
  let promise!: Promise<HealthProfile>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const profile = await getHealthProfile(accessToken, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        profileCache.set(userId, profile, TTL_24H, STALE_PROFILE);
      }
      return profile;
    } catch (error) {
      // P1-9 serve-stale-on-error: on a TRANSIENT read failure, fall back to the
      // last successful value (if still within its stale window) instead of
      // propagating. Token-invalid / scope-missing are NOT transient and surface
      // so the user reconnects. No prior value → the error propagates unchanged.
      if (isTransientHealthError(error)) {
        const stale = profileCache.getStale(userId);
        if (stale !== undefined) {
          l.warn(
            { action: "health_cache_serve_stale", resource: "profile", userId, error: error instanceof Error ? error.message : String(error) },
            "serving stale Google Health profile after transient read error",
          );
          return stale;
        }
      }
      throw error;
    } finally {
      if (profileInFlight.get(inflightKey) === promise) {
        profileInFlight.delete(inflightKey);
      }
    }
  })();

  profileInFlight.set(inflightKey, promise);
  return promise;
}

// ─── Weight cache ───────────────────────────────────────────────────────────

const weightCache = new TtlCache<HealthWeightLog | null>();
const weightInFlight = new Map<string, Promise<HealthWeightLog | null>>();

export async function getCachedHealthWeightKg(
  userId: string,
  targetDate: string,
  log?: Logger,
  criticality: HealthCallCriticality = "optional",
): Promise<HealthWeightLog | null> {
  const l = log ?? logger;
  const key = `${userId}:${targetDate}`;

  const cached = weightCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const inflightKey = `${key}:${criticality}`;
  const existing = weightInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  let promise!: Promise<HealthWeightLog | null>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const weight = await getHealthLatestWeightKg(accessToken, targetDate, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        // Keep null TTL short so the user-feedback loop is tight
        // when "no weight" is the blocking factor. Positive results stay 1h.
        const ttl = weight === null ? TTL_10MIN : TTL_1H;
        weightCache.set(key, weight, ttl, STALE_WEIGHT);
      }
      return weight;
    } catch (error) {
      // P1-9 serve-stale-on-error (see getCachedHealthProfile). A stored `null`
      // ("no weight") is a real last-known value and is served as `null`; only a
      // genuinely absent entry (getStale → undefined) lets the error propagate.
      if (isTransientHealthError(error)) {
        const stale = weightCache.getStale(key);
        if (stale !== undefined) {
          l.warn(
            { action: "health_cache_serve_stale", resource: "weight", userId, error: error instanceof Error ? error.message : String(error) },
            "serving stale Google Health weight after transient read error",
          );
          return stale;
        }
      }
      throw error;
    } finally {
      if (weightInFlight.get(inflightKey) === promise) {
        weightInFlight.delete(inflightKey);
      }
    }
  })();

  weightInFlight.set(inflightKey, promise);
  return promise;
}

// ─── Activity summary cache ─────────────────────────────────────────────────

const activityCache = new TtlCache<ActivitySummary>();
const activityInFlight = new Map<string, Promise<ActivitySummary>>();

export async function getCachedHealthActivitySummary(
  userId: string,
  targetDate: string,
  log?: Logger,
  criticality: HealthCallCriticality = "optional",
  zoneOffset?: string | null,
): Promise<ActivitySummary> {
  const l = log ?? logger;
  // zoneOffset selects which civil-day window the rollup covers, so it must be
  // part of the cache key — otherwise a UTC-keyed value would be served for a
  // zoned request (and vice versa) near date boundaries.
  const key = `${userId}:${targetDate}:${zoneOffset ?? ""}`;

  const cached = activityCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const inflightKey = `${key}:${criticality}`;
  const existing = activityInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  let promise!: Promise<ActivitySummary>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      // zoneOffset is part of the cache key above (selects the civil-day window), but the
      // API call itself takes only the already-resolved civil date — CivilDateTime forbids
      // an offset field (P0-4).
      const activity = await getHealthActivitySummary(accessToken, targetDate, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        activityCache.set(key, activity, TTL_5MIN, STALE_ACTIVITY);
      }
      return activity;
    } catch (error) {
      // P1-9 serve-stale-on-error (see getCachedHealthProfile).
      if (isTransientHealthError(error)) {
        const stale = activityCache.getStale(key);
        if (stale !== undefined) {
          l.warn(
            { action: "health_cache_serve_stale", resource: "activity", userId, error: error instanceof Error ? error.message : String(error) },
            "serving stale Google Health activity summary after transient read error",
          );
          return stale;
        }
      }
      throw error;
    } finally {
      if (activityInFlight.get(inflightKey) === promise) {
        activityInFlight.delete(inflightKey);
      }
    }
  })();

  activityInFlight.set(inflightKey, promise);
  return promise;
}

// ─── Cache invalidation ─────────────────────────────────────────────────────

/**
 * Clears all profile, weight, and activity cache entries for the given user,
 * plus any in-flight dedup entries across all criticality tiers.
 * Called by the settings "Refresh from Google Health" button.
 *
 * Weight-goal cache is omitted — it was removed in Task 19 (replaced by
 * local users.weightGoalType from Task 9).
 */
export function invalidateHealthProfileCache(userId: string): void {
  userCacheGeneration.set(userId, getUserGeneration(userId) + 1);
  profileCache.delete(userId);

  const userPrefix = `${userId}:`;
  for (const key of weightCache.keys()) {
    if (key.startsWith(userPrefix)) weightCache.delete(key);
  }
  for (const key of activityCache.keys()) {
    if (key.startsWith(userPrefix)) activityCache.delete(key);
  }
  for (const key of profileInFlight.keys()) {
    if (key.startsWith(userPrefix)) profileInFlight.delete(key);
  }
  for (const key of weightInFlight.keys()) {
    if (key.startsWith(userPrefix)) weightInFlight.delete(key);
  }
  for (const key of activityInFlight.keys()) {
    if (key.startsWith(userPrefix)) activityInFlight.delete(key);
  }
}
