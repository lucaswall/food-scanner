import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { successResponse, conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { upsertBloodPressureReadings, getBloodPressureReadings } from "@/lib/health-readings";
import { checkRateLimit } from "@/lib/rate-limit";
import { READINGS_LIMIT_EXCEEDED_MESSAGE, isValidReadingTimestamp, isPositiveIntUpTo, parseReadingsRange, READING_LIMITS } from "@/lib/reading-validation";
import type { BloodPressureReadingInput } from "@/types";

const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_BATCH_SIZE = 1000;

const ZONE_OFFSET_RE = /^[+-]\d{2}:\d{2}$/;
const BODY_POSITION_VALUES = new Set([
  "standing_up", "sitting_down", "lying_down", "reclining", "unknown",
]);
const MEASUREMENT_LOCATION_VALUES = new Set([
  "left_upper_arm", "right_upper_arm", "left_wrist", "right_wrist", "unknown",
]);

function getRateLimitKey(request: Request): string {
  const apiKey = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  return `v1:blood-pressure-readings:${hashForRateLimit(apiKey)}`;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/v1/blood-pressure-readings");
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

  const validated: BloodPressureReadingInput[] = [];

  for (let i = 0; i < rawReadings.length; i++) {
    const item = rawReadings[i];
    if (typeof item !== "object" || item === null) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i} must be an object`, 400);
    }
    const r = item as Record<string, unknown>;

    if (typeof r.measuredAt !== "string" || !isValidReadingTimestamp(r.measuredAt)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: measuredAt must be a valid ISO 8601 string`, 400);
    }
    if (!isPositiveIntUpTo(r.systolic, READING_LIMITS.bloodPressureMmHgMax)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: systolic must be a positive integer up to ${READING_LIMITS.bloodPressureMmHgMax}`, 400);
    }
    if (!isPositiveIntUpTo(r.diastolic, READING_LIMITS.bloodPressureMmHgMax)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: diastolic must be a positive integer up to ${READING_LIMITS.bloodPressureMmHgMax}`, 400);
    }
    if (r.heartRate !== undefined && r.heartRate !== null && !isPositiveIntUpTo(r.heartRate, READING_LIMITS.heartRateBpmMax)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: heartRate must be a positive integer up to ${READING_LIMITS.heartRateBpmMax}`, 400);
    }
    if (r.bodyPosition !== undefined && r.bodyPosition !== null && !BODY_POSITION_VALUES.has(r.bodyPosition as string)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: invalid bodyPosition value`, 400);
    }
    if (r.measurementLocation !== undefined && r.measurementLocation !== null && !MEASUREMENT_LOCATION_VALUES.has(r.measurementLocation as string)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: invalid measurementLocation value`, 400);
    }
    if (typeof r.zoneOffset === "string" && !ZONE_OFFSET_RE.test(r.zoneOffset)) {
      return errorResponse("VALIDATION_ERROR", `Reading at index ${i}: zoneOffset must be in ±HH:MM format`, 400);
    }

    validated.push({
      measuredAt: r.measuredAt,
      systolic: r.systolic,
      diastolic: r.diastolic,
      heartRate: typeof r.heartRate === "number" ? r.heartRate : null,
      zoneOffset: typeof r.zoneOffset === "string" ? r.zoneOffset : null,
      bodyPosition: typeof r.bodyPosition === "string" ? r.bodyPosition : null,
      measurementLocation: typeof r.measurementLocation === "string" ? r.measurementLocation : null,
    });
  }

  try {
    const upserted = await upsertBloodPressureReadings(authResult.userId, validated);
    log.debug({ action: "v1_bp_post_success", count: upserted }, "blood pressure readings upserted");
    return successResponse({ upserted });
  } catch (error) {
    log.error(
      { action: "v1_bp_post_error", error: error instanceof Error ? error.message : String(error) },
      "blood pressure readings upsert failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to save blood pressure readings", 500);
  }
}

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/blood-pressure-readings");
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
    const readings = await getBloodPressureReadings(authResult.userId, fromDate, toDate);
    log.debug({ action: "v1_bp_get_success", count: readings.length }, "blood pressure readings retrieved");
    return conditionalResponse(request, readings);
  } catch (error) {
    if (error instanceof Error && error.message === READINGS_LIMIT_EXCEEDED_MESSAGE) {
      return errorResponse("VALIDATION_ERROR", "Too many readings in range. Narrow the 'from'/'to' range.", 400);
    }
    log.error(
      { action: "v1_bp_get_error", error: error instanceof Error ? error.message : String(error) },
      "blood pressure readings query failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve blood pressure readings", 500);
  }
}
