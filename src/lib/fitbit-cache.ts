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
const TTL_5MIN = 5 * 60 * 1000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
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

  const existing = profileInFlight.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const profile = await getFitbitProfile(accessToken, l, userId, criticality);
      profileCache.set(userId, { value: profile, expiresAt: Date.now() + TTL_24H });
      return profile;
    } finally {
      profileInFlight.delete(userId);
    }
  })();

  profileInFlight.set(userId, promise);
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

  const existing = weightInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const weight = await getFitbitLatestWeightKg(accessToken, targetDate, l, userId, criticality);
      weightCache.set(key, { value: weight, expiresAt: Date.now() + TTL_1H });
      return weight;
    } finally {
      weightInFlight.delete(key);
    }
  })();

  weightInFlight.set(key, promise);
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

  const existing = weightGoalInFlight.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const goal = await getFitbitWeightGoal(accessToken, l, userId, criticality);
      weightGoalCache.set(userId, { value: goal, expiresAt: Date.now() + TTL_24H });
      return goal;
    } finally {
      weightGoalInFlight.delete(userId);
    }
  })();

  weightGoalInFlight.set(userId, promise);
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

  const existing = activityInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const accessToken = await ensureFreshToken(userId, l);
      const activity = await getActivitySummary(accessToken, targetDate, l, userId, criticality);
      activityCache.set(key, { value: activity, expiresAt: Date.now() + TTL_5MIN });
      return activity;
    } finally {
      activityInFlight.delete(key);
    }
  })();

  activityInFlight.set(key, promise);
  return promise;
}

// ─── Cache invalidation ─────────────────────────────────────────────────────

/**
 * Clears all profile, weight, weight-goal, and activity cache entries for the
 * given user. Called by the settings "Refresh from Fitbit" button.
 */
export function invalidateFitbitProfileCache(userId: string): void {
  profileCache.delete(userId);
  weightGoalCache.delete(userId);

  // Clear all weight and activity entries that start with this userId
  for (const key of weightCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      weightCache.delete(key);
    }
  }
  for (const key of activityCache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      activityCache.delete(key);
    }
  }
}
