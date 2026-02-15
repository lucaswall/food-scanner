import { mutate } from "swr";

export class ApiError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function apiFetcher(url: string) {
  const response = await fetch(url);
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
