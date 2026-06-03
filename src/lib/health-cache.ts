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

// ─── Shared TTL-cache helper ────────────────────────────────────────────────
// Mirrors the canonical eviction shape from rate-limit.ts:
//   cleanExpiredEntries, evictOldest, MAX_*_SIZE=1000, periodic CLEANUP_INTERVAL sweep + hard cap.

const MAX_CACHE_SIZE = 1000;
const CACHE_CLEANUP_INTERVAL = 100;

class TtlCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private callCount = 0;

  /** Returns the cached value if present and not expired; deletes expired entries eagerly. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Stores a value with the given TTL, running periodic cleanup and enforcing the size cap. */
  set(key: string, value: T, ttlMs: number): void {
    const now = Date.now();
    this.callCount++;
    if (this.callCount % CACHE_CLEANUP_INTERVAL === 0 || this.store.size >= MAX_CACHE_SIZE) {
      this.cleanExpired(now);
    }
    if (this.store.size >= MAX_CACHE_SIZE) {
      this.evictOldest();
    }
    this.store.set(key, { value, expiresAt: now + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  private cleanExpired(now: number): void {
    for (const [k, v] of this.store) {
      if (v.expiresAt <= now) this.store.delete(k);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [k, v] of this.store) {
      if (v.expiresAt < oldestExpiry) {
        oldestExpiry = v.expiresAt;
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
        profileCache.set(userId, profile, TTL_24H);
      }
      return profile;
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
        weightCache.set(key, weight, ttl);
      }
      return weight;
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
      const activity = await getHealthActivitySummary(accessToken, targetDate, l, userId, criticality, zoneOffset);
      if (getUserGeneration(userId) === generationAtStart) {
        activityCache.set(key, activity, TTL_5MIN);
      }
      return activity;
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
