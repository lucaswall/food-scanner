import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getUserGoalSettings, updateUserGoalSettings } from "@/lib/users";
import { invalidateUserDailyGoalsForSettingsChange } from "@/lib/daily-goals";
import { getTodayDate } from "@/lib/date-utils";
import type { ActivityLevel } from "@/types";

/** ActivityLevel values — mirrors the union in @/types (added by schema migration). */
const ACTIVITY_LEVEL_VALUES = [
  "sedentary",
  "light",
  "moderate",
  "very_active",
  "extra_active",
] as const;

function isActivityLevel(v: unknown): v is ActivityLevel {
  return typeof v === "string" && (ACTIVITY_LEVEL_VALUES as readonly string[]).includes(v);
}

interface DailyGoalsSettingsResponse {
  activityLevel: ActivityLevel | null;
  goalWeightKg: number | null;
  goalRateKgPerWeek: number | null;
}

/** Cast a Drizzle numeric column value (string | null) to number | null. */
function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function buildResponse(raw: {
  activityLevel: ActivityLevel | null;
  goalWeightKg: string | null;
  goalRateKgPerWeek: string | null;
}): DailyGoalsSettingsResponse {
  return {
    activityLevel: raw.activityLevel,
    goalWeightKg: toNumberOrNull(raw.goalWeightKg),
    goalRateKgPerWeek: toNumberOrNull(raw.goalRateKgPerWeek),
  };
}

export async function GET() {
  const log = createRequestLogger("GET", "/api/daily-goals-settings");
  const session = await getSession();
  const validationError = validateSession(session);
  if (validationError) return validationError;

  const raw = await getUserGoalSettings(session!.userId);

  log.debug(
    { action: "daily_goals_settings_get", userId: session!.userId },
    "daily goals settings fetched",
  );

  const response = successResponse(buildResponse(raw));
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}

export async function PATCH(request: Request) {
  const log = createRequestLogger("PATCH", "/api/daily-goals-settings");
  const session = await getSession();
  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const raw = body as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be a JSON object", 400);
  }

  const update: {
    activityLevel?: ActivityLevel | null;
    goalWeightKg?: number | null;
    goalRateKgPerWeek?: number | null;
  } = {};

  // Validate activityLevel if provided
  if ("activityLevel" in raw) {
    const v = raw.activityLevel;
    if (v !== null && v !== undefined && !isActivityLevel(v)) {
      return errorResponse(
        "VALIDATION_ERROR",
        `activityLevel must be one of: ${ACTIVITY_LEVEL_VALUES.join(", ")}`,
        400,
      );
    }
    update.activityLevel = v === undefined ? null : (v as ActivityLevel | null);
  }

  // Validate goalWeightKg if provided
  if ("goalWeightKg" in raw) {
    const v = raw.goalWeightKg;
    if (v !== null && v !== undefined) {
      if (typeof v !== "number" || !isFinite(v) || v <= 0 || v > 500) {
        return errorResponse(
          "VALIDATION_ERROR",
          "goalWeightKg must be a finite number > 0 and <= 500",
          400,
        );
      }
      update.goalWeightKg = v;
    } else {
      update.goalWeightKg = null;
    }
  }

  // Validate goalRateKgPerWeek if provided
  if ("goalRateKgPerWeek" in raw) {
    const v = raw.goalRateKgPerWeek;
    if (v !== null && v !== undefined) {
      if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 5) {
        return errorResponse(
          "VALIDATION_ERROR",
          "goalRateKgPerWeek must be a finite number >= 0 and <= 5",
          400,
        );
      }
      update.goalRateKgPerWeek = v;
    } else {
      update.goalRateKgPerWeek = null;
    }
  }

  if (Object.keys(update).length === 0) {
    const current = await getUserGoalSettings(session!.userId);
    log.debug(
      { action: "daily_goals_settings_patch_noop", userId: session!.userId },
      "PATCH with empty body — no settings changed",
    );
    return successResponse(buildResponse(current));
  }

  const updated = await updateUserGoalSettings(session!.userId, update);
  await invalidateUserDailyGoalsForSettingsChange(session!.userId, getTodayDate());

  log.info(
    {
      action: "daily_goals_settings_patch",
      userId: session!.userId,
      fields: Object.keys(update),
    },
    "daily goals settings updated; daily goals invalidated",
  );

  return successResponse(buildResponse(updated));
}
