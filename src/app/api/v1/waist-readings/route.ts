import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { successResponse, conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { upsertWaistReadings, getWaistReadings } from "@/lib/health-readings";
import { checkRateLimit } from "@/lib/rate-limit";
import { READINGS_LIMIT_EXCEEDED_MESSAGE, isValidReadingTimestamp, isPositiveNumberUpTo, parseReadingsRange, READING_LIMITS } from "@/lib/reading-validation";
import type { WaistReadingInput } from "@/types";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_BATCH_SIZE = 1000;

const ZONE_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;

function getRateLimitKey(request: Request): string {
  const apiKey = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  return `v1:waist-readings:${hashForRateLimit(apiKey)}`;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/v1/waist-readings");
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

  const validated: WaistReadingInput[] = [];

  for (let i = 0; i < rawReadings.length; i++) {
    const item = rawReadings[i];
    if (typeof item !== "object" || item === null) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i} must be an object`, 400);
    }
    const r = item as Record<string, unknown>;

    if (typeof r.measuredAt !== "string" || !isValidReadingTimestamp(r.measuredAt)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: measuredAt must be a valid ISO 8601 string`, 400);
    }
    if (!isPositiveNumberUpTo(r.valueCm, READING_LIMITS.waistCmMax)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: valueCm must be a positive number up to ${READING_LIMITS.waistCmMax}`, 400);
    }
    if (typeof r.zoneOffset === "string" && !ZONE_OFFSET_RE.test(r.zoneOffset)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: zoneOffset must be in ±HH:MM format`, 400);
    }

    validated.push({
      measuredAt: r.measuredAt,
      valueCm: r.valueCm,
      zoneOffset: typeof r.zoneOffset === "string" ? r.zoneOffset : null,
    });
  }

  try {
    const upserted = await upsertWaistReadings(authResult.userId, validated);
    log.debug({ action: "v1_waist_post_success", count: upserted }, "waist readings upserted");
    return successResponse({ upserted });
  } catch (error) {
    log.error(
      { action: "v1_waist_post_error", error: error instanceof Error ? error.message : String(error) },
      "waist readings upsert failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to save waist readings", 500);
  }
}

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/waist-readings");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const { allowed } = checkRateLimit(getRateLimitKey(request), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const { searchParams } = new URL(request.url);
  const range = parseReadingsRange(searchParams);
  if ("error" in range) {
    return errorResponse("VALIDATION_ERROR", range.error, 400);
  }
  const fromDate = range.from;
  const toDate = range.to;

  try {
    const readings = await getWaistReadings(authResult.userId, fromDate, toDate);
    log.debug({ action: "v1_waist_get_success", count: readings.length }, "waist readings retrieved");
    return conditionalResponse(request, readings);
  } catch (error) {
    if (error instanceof Error && error.message === READINGS_LIMIT_EXCEEDED_MESSAGE) {
      return errorResponse("VALIDATION_ERROR", "Too many readings in range. Narrow the 'from'/'to' range.", 400);
    }
    log.error(
      { action: "v1_waist_get_error", error: error instanceof Error ? error.message : String(error) },
      "waist readings query failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve waist readings", 500);
  }
}
