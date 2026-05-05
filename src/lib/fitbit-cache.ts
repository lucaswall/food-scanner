import type { FitbitProfile, FitbitWeightLog, FitbitWeightGoal, ActivitySummary } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import {
  ensureFreshToken,
  getFitbitProfile,
  getFitbitLatestWeightKg,
  getFitbitWeightGoal,
  getActivitySummary,
  type FitbitCallCriticality,
} from "@/lib/fitbit";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_1H = 60 * 60 * 1000;
const TTL_10MIN = 10 * 60 * 1000;
const TTL_5MIN = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
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

const profileCache = new Map<string, CacheEntry<FitbitProfile>>();
const profileInFlight = new Map<string, Promise<FitbitProfile>>();

export async function getCachedFitbitProfile(
  userId: string,
  log?: Logger,
  criticality: FitbitCallCriticality = "optional",
): Promise<FitbitProfile> {
  const l = log ?? logger;

  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflightKey = `${userId}:${criticality}`;
  const existing = profileInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  // `let !` so the IIFE's `finally` can compare against the bound promise:
  // by the time finally runs (after both awaits), assignment has completed.
  let promise!: Promise<FitbitProfile>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const profile = await getFitbitProfile(accessToken, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        profileCache.set(userId, { value: profile, expiresAt: Date.now() + TTL_24H });
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

const weightCache = new Map<string, CacheEntry<FitbitWeightLog | null>>();
const weightInFlight = new Map<string, Promise<FitbitWeightLog | null>>();

export async function getCachedFitbitWeightKg(
  userId: string,
  targetDate: string,
  log?: Logger,
  criticality: FitbitCallCriticality = "optional",
): Promise<FitbitWeightLog | null> {
  const l = log ?? logger;
  const key = `${userId}:${targetDate}`;

  const cached = weightCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflightKey = `${key}:${criticality}`;
  const existing = weightInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  let promise!: Promise<FitbitWeightLog | null>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const weight = await getFitbitLatestWeightKg(accessToken, targetDate, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        // FOO-1010: keep null TTL short so the user-feedback loop is tight
        // when "no weight" is the blocking factor. Positive results stay 1h.
        const ttl = weight === null ? TTL_10MIN : TTL_1H;
        weightCache.set(key, { value: weight, expiresAt: Date.now() + ttl });
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

// ─── Weight goal cache ──────────────────────────────────────────────────────

const weightGoalCache = new Map<string, CacheEntry<FitbitWeightGoal | null>>();
const weightGoalInFlight = new Map<string, Promise<FitbitWeightGoal | null>>();

export async function getCachedFitbitWeightGoal(
  userId: string,
  log?: Logger,
  criticality: FitbitCallCriticality = "optional",
): Promise<FitbitWeightGoal | null> {
  const l = log ?? logger;

  const cached = weightGoalCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflightKey = `${userId}:${criticality}`;
  const existing = weightGoalInFlight.get(inflightKey);
  if (existing) return existing;

  const generationAtStart = getUserGeneration(userId);
  let promise!: Promise<FitbitWeightGoal | null>;
  // eslint-disable-next-line prefer-const
  promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const goal = await getFitbitWeightGoal(accessToken, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        weightGoalCache.set(userId, { value: goal, expiresAt: Date.now() + TTL_24H });
      }
      return goal;
    } finally {
      if (weightGoalInFlight.get(inflightKey) === promise) {
        weightGoalInFlight.delete(inflightKey);
      }
    }
  })();

  weightGoalInFlight.set(inflightKey, promise);
  return promise;
}

// ─── Activity summary cache ─────────────────────────────────────────────────

const activityCache = new Map<string, CacheEntry<ActivitySummary>>();
const activityInFlight = new Map<string, Promise<ActivitySummary>>();

export async function getCachedActivitySummary(
  userId: string,
  targetDate: string,
  log?: Logger,
  criticality: FitbitCallCriticality = "optional",
): Promise<ActivitySummary> {
  const l = log ?? logger;
  const key = `${userId}:${targetDate}`;

  const cached = activityCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
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
      const activity = await getActivitySummary(accessToken, targetDate, l, userId, criticality);
      if (getUserGeneration(userId) === generationAtStart) {
        activityCache.set(key, { value: activity, expiresAt: Date.now() + TTL_5MIN });
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
 * Clears all profile, weight, weight-goal, and activity cache entries for the
 * given user, plus any in-flight dedup entries across all criticality tiers.
 * Called by the settings "Refresh from Fitbit" button.
 */
export function invalidateFitbitProfileCache(userId: string): void {
  userCacheGeneration.set(userId, getUserGeneration(userId) + 1);
  profileCache.delete(userId);
  weightGoalCache.delete(userId);

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
  for (const key of weightGoalInFlight.keys()) {
    if (key.startsWith(userPrefix)) weightGoalInFlight.delete(key);
  }
  for (const key of weightInFlight.keys()) {
    if (key.startsWith(userPrefix)) weightInFlight.delete(key);
  }
  for (const key of activityInFlight.keys()) {
    if (key.startsWith(userPrefix)) activityInFlight.delete(key);
  }
}
