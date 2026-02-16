import { logger } from "@/lib/logger";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();
const MAX_STORE_SIZE = 1000;

function cleanExpiredEntries(now: number): void {
  for (const [k, v] of store) {
    if (v.resetAt <= now) store.delete(k);
  }
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; remaining: number } {
  const now = Date.now();

  if (store.size > MAX_STORE_SIZE) {
    cleanExpiredEntries(now);
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
