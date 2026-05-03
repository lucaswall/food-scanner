import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getCachedFitbitProfile,
  getCachedFitbitWeightKg,
  getCachedFitbitWeightGoal,
  invalidateFitbitProfileCache,
} from "@/lib/fitbit-cache";
import { getTodayDate } from "@/lib/date-utils";
import type { FitbitProfileData } from "@/types";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/fitbit/profile");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const shouldRefresh = searchParams.get("refresh") === "1";

  if (shouldRefresh) {
    invalidateFitbitProfileCache(session!.userId);
  }

  try {
    const todayDate = getTodayDate();

    const [profile, weightLog, weightGoal] = await Promise.all([
      getCachedFitbitProfile(session!.userId, log),
      getCachedFitbitWeightKg(session!.userId, todayDate, log),
      getCachedFitbitWeightGoal(session!.userId, log),
    ]);

    const data: FitbitProfileData = {
      ageYears: profile.ageYears,
      sex: profile.sex,
      heightCm: profile.heightCm,
      weightKg: weightLog?.weightKg ?? null,
      weightLoggedDate: weightLog?.loggedDate ?? null,
      goalType: weightGoal?.goalType ?? null,
      lastSyncedAt: Date.now(),
    };

    log.info(
      { action: "fitbit_profile_success", userId: session!.userId },
      "Fitbit profile retrieved",
    );

    const response = successResponse(data);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      {
        action: "fitbit_profile_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "Fitbit profile fetch failed",
    );

    if (error instanceof Error) {
      if (error.message === "FITBIT_CREDENTIALS_MISSING") {
        return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 424);
      }
      if (error.message === "FITBIT_TOKEN_INVALID") {
        return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
      }
      if (error.message === "FITBIT_SCOPE_MISSING") {
        return errorResponse(
          "FITBIT_SCOPE_MISSING",
          "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.",
          403,
        );
      }
      if (error.message === "FITBIT_RATE_LIMIT") {
        return errorResponse("FITBIT_RATE_LIMIT", "Fitbit API rate limited. Please try again later.", 429);
      }
      if (error.message === "FITBIT_TIMEOUT") {
        return errorResponse("FITBIT_TIMEOUT", "Request to Fitbit timed out. Please try again.", 504);
      }
      if (error.message === "FITBIT_REFRESH_TRANSIENT") {
        return errorResponse("FITBIT_REFRESH_TRANSIENT", "Temporary Fitbit error. Please try again.", 502);
      }
      if (error.message === "FITBIT_TOKEN_SAVE_FAILED") {
        return errorResponse("FITBIT_TOKEN_SAVE_FAILED", "Failed to save Fitbit tokens. Please try again.", 500);
      }
      if (error.message === "FITBIT_API_ERROR") {
        return errorResponse("FITBIT_API_ERROR", "Fitbit API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch Fitbit profile", 500);
  }
}
