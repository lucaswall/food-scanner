import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { successResponse, conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { upsertGlucoseReadings, getGlucoseReadings } from "@/lib/health-readings";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";
import type { GlucoseReadingInput } from "@/types";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_BATCH_SIZE = 1000;

const ZONE_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const RELATION_TO_MEAL_VALUES = new Set(["general", "fasting", "before_meal", "after_meal", "unknown"]);
const MEAL_TYPE_VALUES = new Set(["breakfast", "lunch", "dinner", "snack", "unknown"]);
const SPECIMEN_SOURCE_VALUES = new Set([
  "capillary_blood", "interstitial_fluid", "plasma", "serum", "tears", "whole_blood", "unknown",
]);

function getRateLimitKey(request: Request): string {
  const apiKey = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  return `v1:glucose-readings:${hashForRateLimit(apiKey)}`;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/v1/glucose-readings");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const { allowed } = checkRateLimit(getRateLimitKey(request), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("readings" in body) ||
    !Array.isArray((body as Record<string, unknown>).readings)
  ) {
    return errorResponse("VALIDATION_ERROR", "Missing or invalid 'readings' array in body", 400);
  }

  const rawReadings = (body as Record<string, unknown>).readings as unknown[];

  if (rawReadings.length > MAX_BATCH_SIZE) {
    return errorResponse("VALIDATION_ERROR", `Readings array exceeds maximum batch size of ${MAX_BATCH_SIZE}`, 400);
  }

  const validated: GlucoseReadingInput[] = [];

  for (let i = 0; i < rawReadings.length; i++) {
    const item = rawReadings[i];
    if (typeof item !== "object" || item === null) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i} must be an object`, 400);
    }
    const r = item as Record<string, unknown>;

    if (typeof r.measuredAt !== "string" || !ISO_8601_RE.test(r.measuredAt)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: measuredAt must be a valid ISO 8601 string`, 400);
    }
    if (typeof r.valueMgDl !== "number" || r.valueMgDl <= 0) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: valueMgDl must be a positive number`, 400);
    }
    if (r.relationToMeal !== undefined && r.relationToMeal !== null && !RELATION_TO_MEAL_VALUES.has(r.relationToMeal as string)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: invalid relationToMeal value`, 400);
    }
    if (r.mealType !== undefined && r.mealType !== null && !MEAL_TYPE_VALUES.has(r.mealType as string)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: invalid mealType value`, 400);
    }
    if (r.specimenSource !== undefined && r.specimenSource !== null && !SPECIMEN_SOURCE_VALUES.has(r.specimenSource as string)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: invalid specimenSource value`, 400);
    }
    if (typeof r.zoneOffset === "string" && !ZONE_OFFSET_RE.test(r.zoneOffset)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: zoneOffset must be in ±HH:MM format`, 400);
    }

    validated.push({
      measuredAt: r.measuredAt,
      valueMgDl: r.valueMgDl,
      zoneOffset: typeof r.zoneOffset === "string" ? r.zoneOffset : null,
      relationToMeal: typeof r.relationToMeal === "string" ? r.relationToMeal : null,
      mealType: typeof r.mealType === "string" ? r.mealType : null,
      specimenSource: typeof r.specimenSource === "string" ? r.specimenSource : null,
    });
  }

  try {
    const upserted = await upsertGlucoseReadings(authResult.userId, validated);
    log.debug({ action: "v1_glucose_post_success", count: upserted }, "glucose readings upserted");
    return successResponse({ upserted });
  } catch (error) {
    log.error(
      { action: "v1_glucose_post_error", error: error instanceof Error ? error.message : String(error) },
      "glucose readings upsert failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to save glucose readings", 500);
  }
}

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/glucose-readings");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const { allowed } = checkRateLimit(getRateLimitKey(request), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let fromDate: string;
  let toDate: string;

  if (date !== null) {
    if (!isValidDateFormat(date)) {
      return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
    }
    fromDate = date;
    toDate = date;
  } else if (from !== null || to !== null) {
    if (from === null) {
      return errorResponse("VALIDATION_ERROR", "Missing 'from' parameter (required when 'to' is provided)", 400);
    }
    if (to === null) {
      return errorResponse("VALIDATION_ERROR", "Missing 'to' parameter (required when 'from' is provided)", 400);
    }
    if (!isValidDateFormat(from)) {
      return errorResponse("VALIDATION_ERROR", "Invalid date format for 'from'. Use YYYY-MM-DD", 400);
    }
    if (!isValidDateFormat(to)) {
      return errorResponse("VALIDATION_ERROR", "Invalid date format for 'to'. Use YYYY-MM-DD", 400);
    }
    if (from > to) {
      return errorResponse("VALIDATION_ERROR", "'from' must not be after 'to' in date range", 400);
    }
    fromDate = from;
    toDate = to;
  } else {
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing query parameter: provide 'date' or 'from'/'to' range",
      400
    );
  }

  try {
    const readings = await getGlucoseReadings(authResult.userId, fromDate, toDate);
    log.debug({ action: "v1_glucose_get_success", count: readings.length }, "glucose readings retrieved");
    return conditionalResponse(request, readings);
  } catch (error) {
    log.error(
      { action: "v1_glucose_get_error", error: error instanceof Error ? error.message : String(error) },
      "glucose readings query failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve glucose readings", 500);
  }
}
