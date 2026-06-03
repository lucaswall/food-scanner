import { mutate } from "swr";

export class ApiError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/**
 * Shared SWR config for SWR keys that hit Google Health-backed endpoints
 * (`/api/nutrition-goals`, `/api/health-profile`). Disables the default
 * `revalidateOnFocus` and uses a 30-minute dedupe window so tab-switching
 * doesn't burn the rate limit quota (port of FOO-1003 from the health API migration).
 *
 * Mutate-after-action calls (refresh button, profile change) bypass the
 * dedupe window — see `swr.mutate(...)` invocations.
 */
export const HEALTH_BACKED_SWR_CONFIG = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  dedupingInterval: 30 * 60 * 1000,
} as const;

export async function apiFetcher(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = body.error?.message || `HTTP ${response.status}`;
    const code = body.error?.code || "UNKNOWN_ERROR";
    throw new ApiError(message, code);
  }
  const result = await response.json();
  if (!result.success) {
    const message = result.error?.message || "Failed to load";
    const code = result.error?.code || "UNKNOWN_ERROR";
    throw new ApiError(message, code);
  }
  return result.data;
}

const FOOD_CACHE_PREFIXES = [
  "/api/nutrition-summary",
  "/api/food-history",
  "/api/common-foods",
  "/api/fasting",
  "/api/earliest-entry",
];

export function invalidateFoodCaches(): Promise<unknown[]> {
  return mutate(
    (key) =>
      typeof key === "string" &&
      FOOD_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

const LABEL_CACHE_PREFIXES = ["/api/nutrition-labels"];

export function invalidateLabelCaches(): Promise<unknown[]> {
  return mutate(
    (key) =>
      typeof key === "string" &&
      LABEL_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}

const SAVED_ANALYSES_CACHE_PREFIXES = ["/api/saved-analyses"];

export function invalidateSavedAnalysesCaches(): Promise<unknown[]> {
  return mutate(
    (key) =>
      typeof key === "string" &&
      SAVED_ANALYSES_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
}
