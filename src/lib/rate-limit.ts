import { logger } from "@/lib/logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 1000;
const CLEANUP_INTERVAL = 100;
let callCount = 0;

function cleanExpiredEntries(now: number): void {
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestResetAt = Infinity;
  for (const [k, v] of store) {
    if (v.resetAt < oldestResetAt) {
      oldestResetAt = v.resetAt;
      oldestKey = k;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export function _getStoreSize(): number {
  return store.size;
}

export function _getMaxStoreSize(): number {
  return MAX_STORE_SIZE;
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();

  callCount++;
  if (callCount % CLEANUP_INTERVAL === 0 || store.size > MAX_STORE_SIZE) {
    cleanExpiredEntries(now);
  }

  // Hard cap: evict oldest entries if still over limit after cleanup
  while (store.size >= MAX_STORE_SIZE) {
    evictOldest();
  }

  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  entry.count++;
  if (entry.count > maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  const remaining = maxRequests - entry.count;
  const usagePct = (entry.count / maxRequests) * 100;
  if (usagePct >= 80) {
    logger.debug({ action: "rate_limit_warning", key, usagePct: Math.round(usagePct), remaining }, "rate limit nearing threshold");
  }

  return { allowed: true, remaining };
}
