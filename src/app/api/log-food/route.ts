import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, createNutritionLog, deleteNutritionLogs } from "@/lib/google-health";
import { mapHealthError } from "@/lib/health-error-response";
import { insertCustomFoodWithLogEntry, insertFoodLogEntry, getCustomFoodById, updateCustomFoodMetadata } from "@/lib/food-log";
import { isValidDateFormat, isValidTimeFormat } from "@/lib/date-utils";
import { isValidFoodAnalysisFields } from "@/lib/food-validation";
import type { FoodLogRequest, FoodLogResponse, ServingUnit } from "@/types";
import { MealType } from "@/types";
import { coerceServingUnit } from "@/types";

const VALID_MEAL_TYPE_IDS = [
  MealType.Breakfast,
  MealType.MorningSnack,
  MealType.Lunch,
  MealType.AfternoonSnack,
  MealType.Dinner,
  MealType.Anytime,
];

/**
 * Per-user clientToken idempotency cache.
 * Keyed by "userId:clientToken" → cached result.
 * TTL: 5 minutes per entry (resets on deploy — acceptable for a 2-user app).
 * Expired entries are swept on each write to prevent unbounded growth.
 */
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const idempotencyCache = new Map<
  string,
  { healthLogId?: string; foodLogId?: number; reusedFood: boolean; expiresAt: number }
>();

/** Drop all entries whose TTL has elapsed (O(n) sweep, called on each write). */
function sweepIdempotencyCache(): void {
  const now = Date.now();
  for (const [key, value] of idempotencyCache) {
    if (value.expiresAt <= now) {
      idempotencyCache.delete(key);
    }
  }
}

function getIdempotencyKey(userId: string, clientToken: string): string {
  return `${userId}:${clientToken}`;
}

function isValidClientToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128;
}

function isValidFoodLogRequest(body: unknown): body is FoodLogRequest {
  if (!body || typeof body !== "object") return false;
  const req = body as Record<string, unknown>;

  // mealTypeId, date, and time are always required
  if (typeof req.mealTypeId !== "number") return false;
  if (typeof req.date !== "string") return false;
  if (typeof req.time !== "string") return false;

  // Validate optional clientToken
  if (req.clientToken !== undefined && !isValidClientToken(req.clientToken)) return false;

  // Reuse flow: reuseCustomFoodId + mealTypeId + date + time needed, optional metadata
  if (req.reuseCustomFoodId !== undefined) {
    if (typeof req.reuseCustomFoodId !== "number" || req.reuseCustomFoodId <= 0) return false;
    // Validate optional metadata update fields
    if (req.newDescription !== undefined) {
      if (typeof req.newDescription !== "string" || req.newDescription.length > 2000) return false;
    }
    if (req.newNotes !== undefined) {
      if (typeof req.newNotes !== "string" || req.newNotes.length > 2000) return false;
    }
    if (req.newKeywords !== undefined) {
      if (!Array.isArray(req.newKeywords) || req.newKeywords.length > 20 || !req.newKeywords.every((k: unknown) => typeof k === "string" && (k as string).length <= 100)) return false;
    }
    if (req.newConfidence !== undefined && req.newConfidence !== "high" && req.newConfidence !== "medium" && req.newConfidence !== "low") return false;
    return true;
  }

  // New food flow: all FoodAnalysis fields required
  return isValidFoodAnalysisFields(req);
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/log-food");
  const session = await getSession();

  const validationError = validateSession(session, { requireHealth: true });
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!isValidFoodLogRequest(body)) {
    log.warn({ action: "log_food_validation" }, "invalid request body");
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing or invalid required fields",
      400
    );
  }

  // Round calories at the API boundary — Claude can return fractional values
  if (!body.reuseCustomFoodId) {
    body.calories = Math.round(body.calories);
  }

  if (!VALID_MEAL_TYPE_IDS.includes(body.mealTypeId)) {
    log.warn(
      { action: "log_food_validation", mealTypeId: body.mealTypeId },
      "invalid mealTypeId"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid mealTypeId. Must be 1 (Breakfast), 2 (Morning Snack), 3 (Lunch), 4 (Afternoon Snack), 5 (Dinner), or 7 (Anytime)",
      400
    );
  }

  if (!isValidDateFormat(body.date)) {
    log.warn({ action: "log_food_validation" }, "invalid date format");
    return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
  }

  if (!isValidTimeFormat(body.time)) {
    log.warn({ action: "log_food_validation" }, "invalid time format");
    return errorResponse("VALIDATION_ERROR", "Invalid time format. Use HH:mm or HH:mm:ss", 400);
  }

  if (body.zoneOffset !== undefined && !/^[+-]\d{2}:\d{2}$/.test(body.zoneOffset)) {
    log.warn({ action: "log_food_validation" }, "invalid zoneOffset format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid zoneOffset format. Use ±HH:MM (e.g., -03:00, +05:30)",
      400
    );
  }

  log.info(
    {
      action: "log_food_request",
      ...(body.reuseCustomFoodId
        ? { reuseCustomFoodId: body.reuseCustomFoodId }
        : { foodName: body.food_name }),
      mealTypeId: body.mealTypeId,
    },
    "processing food log request"
  );

  const isDryRun = process.env.HEALTH_DRY_RUN === "true";
  const userId = session!.userId;
  const clientToken = body.clientToken;

  // ── Idempotency check ─────────────────────────────────────────────────────
  if (clientToken) {
    const cacheKey = getIdempotencyKey(userId, clientToken);
    const cached = idempotencyCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      log.info({ action: "log_food_idempotent", clientToken }, "returning cached idempotent response");
      const response: FoodLogResponse = {
        success: true,
        healthLogId: cached.healthLogId,
        reusedFood: cached.reusedFood,
        foodLogId: cached.foodLogId,
      };
      return successResponse(response);
    }
  }

  try {
    const { date, time, zoneOffset } = body;
    let foodLogId: number | undefined;
    let healthLogId: string | undefined;

    if (body.reuseCustomFoodId) {
      // Reuse flow: use stored custom food nutrients
      const existingFood = await getCustomFoodById(userId, body.reuseCustomFoodId);
      if (!existingFood) {
        return errorResponse("VALIDATION_ERROR", "Custom food not found", 400);
      }

      // Cross-check: if client sent expectedCalories, verify the reused food is plausible
      const expectedCalories = (body as unknown as Record<string, unknown>).expectedCalories;
      if (typeof expectedCalories === "number" && expectedCalories > 0) {
        const calorieDiff = Math.abs(existingFood.calories - expectedCalories);
        if (calorieDiff > expectedCalories * 0.5) {
          log.warn(
            {
              action: "log_food_reuse_mismatch",
              reuseCustomFoodId: body.reuseCustomFoodId,
              existingFoodName: existingFood.foodName,
              existingCalories: existingFood.calories,
              expectedCalories,
            },
            "reuse calorie mismatch detected — sourceCustomFoodId likely hallucinated"
          );
          return errorResponse(
            "VALIDATION_ERROR",
            "Reused food does not match analysis. Please try logging again.",
            400
          );
        }
      }

      if (!isDryRun) {
        const accessToken = await ensureFreshToken(userId, log);
        // Build FoodAnalysis from stored custom food nutrients
        const foodAnalysis = {
          food_name: existingFood.foodName,
          amount: Number(existingFood.amount),
          unit_id: coerceServingUnit(existingFood.unitId),
          calories: existingFood.calories,
          protein_g: Number(existingFood.proteinG),
          carbs_g: Number(existingFood.carbsG),
          fat_g: Number(existingFood.fatG),
          fiber_g: Number(existingFood.fiberG),
          sodium_mg: Number(existingFood.sodiumMg),
          saturated_fat_g: existingFood.saturatedFatG != null ? Number(existingFood.saturatedFatG) : null,
          trans_fat_g: existingFood.transFatG != null ? Number(existingFood.transFatG) : null,
          sugars_g: existingFood.sugarsG != null ? Number(existingFood.sugarsG) : null,
          calories_from_fat: existingFood.caloriesFromFat != null ? Number(existingFood.caloriesFromFat) : null,
          confidence: (existingFood.confidence ?? "high") as "high" | "medium" | "low",
          notes: existingFood.notes ?? "",
          description: existingFood.description ?? "",
          keywords: existingFood.keywords ?? [],
        };
        const createResult = await createNutritionLog(accessToken, foodAnalysis, log, userId);
        healthLogId = createResult.healthLogId;
      }

      try {
        const logEntryResult = await insertFoodLogEntry(userId, {
          customFoodId: existingFood.id,
          mealTypeId: body.mealTypeId,
          amount: Number(existingFood.amount),
          unitId: coerceServingUnit(existingFood.unitId),
          date,
          time,
          zoneOffset,
          healthLogId: healthLogId ?? null,
        });
        foodLogId = logEntryResult.id;

        // Update custom food metadata if new values provided (fire-and-forget)
        const hasMetadataUpdates =
          body.newDescription !== undefined ||
          body.newNotes !== undefined ||
          body.newKeywords !== undefined ||
          body.newConfidence !== undefined;

        if (hasMetadataUpdates) {
          const metadataUpdate: {
            description?: string;
            notes?: string;
            keywords?: string[];
            confidence?: "high" | "medium" | "low";
          } = {};
          if (body.newDescription !== undefined) metadataUpdate.description = body.newDescription as string;
          if (body.newNotes !== undefined) metadataUpdate.notes = body.newNotes as string;
          if (body.newKeywords !== undefined) metadataUpdate.keywords = body.newKeywords as string[];
          if (body.newConfidence !== undefined) metadataUpdate.confidence = body.newConfidence as "high" | "medium" | "low";

          Promise.race([
            updateCustomFoodMetadata(userId, existingFood.id, metadataUpdate),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
          ]).catch((err) => {
            const isTimeout = err instanceof Error && err.message === "timeout";
            log.warn(
              { action: isTimeout ? "update_custom_food_metadata_timeout" : "update_custom_food_metadata_failed", error: err instanceof Error ? err.message : String(err) },
              isTimeout ? "Custom food metadata update timed out (non-blocking)" : "Failed to update custom food metadata (non-blocking)"
            );
          });
        }
      } catch (dbErr) {
        log.error(
          { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
          "DB write failed after health log creation, attempting compensation"
        );
        if (healthLogId && !isDryRun) {
          try {
            const accessToken = await ensureFreshToken(userId, log);
            await deleteNutritionLogs(accessToken, [healthLogId], log, userId);
            log.info({ action: "food_log_compensation", healthLogId }, "health log rolled back after DB failure");
          } catch (compensationErr) {
            log.error(
              { action: "food_log_compensation_failed", healthLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
              "CRITICAL: health log exists but DB write failed and compensation failed"
            );
            return errorResponse("PARTIAL_ERROR", "Food logged to Google Health but local save failed. Manual cleanup may be needed.", 500);
          }
        }
        return errorResponse("INTERNAL_ERROR", "Failed to save food log", 500);
      }

      // Store in idempotency cache if clientToken provided (reuse flow)
      if (clientToken) {
        sweepIdempotencyCache();
        const cacheKey = getIdempotencyKey(userId, clientToken);
        idempotencyCache.set(cacheKey, {
          healthLogId,
          foodLogId,
          reusedFood: true,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }

      const response: FoodLogResponse = {
        success: true,
        healthLogId,
        reusedFood: true,
        foodLogId,
        ...(isDryRun && { dryRun: true }),
      };

      log.info(
        { action: "log_food_success", healthLogId, reused: true, foodLogId, dryRun: isDryRun || undefined },
        isDryRun ? "food logged in dry-run mode (Health API skipped)" : "food logged successfully (reused)"
      );

      return successResponse(response);
    }

    // New food flow
    if (!isDryRun) {
      const accessToken = await ensureFreshToken(userId, log);
      const createResult = await createNutritionLog(
        accessToken,
        {
          food_name: body.food_name,
          amount: body.amount,
          unit_id: body.unit_id as ServingUnit,
          calories: body.calories,
          protein_g: body.protein_g,
          carbs_g: body.carbs_g,
          fat_g: body.fat_g,
          fiber_g: body.fiber_g,
          sodium_mg: body.sodium_mg,
          saturated_fat_g: body.saturated_fat_g ?? null,
          trans_fat_g: body.trans_fat_g ?? null,
          sugars_g: body.sugars_g ?? null,
          calories_from_fat: body.calories_from_fat ?? null,
          confidence: body.confidence,
          notes: body.notes ?? "",
          description: body.description ?? "",
          keywords: body.keywords ?? [],
        },
        log,
        userId,
      );
      healthLogId = createResult.healthLogId;
    }

    // Log to database — DB is authoritative, failures trigger compensation
    try {
      const dbResult = await insertCustomFoodWithLogEntry(
        userId,
        {
          foodName: body.food_name,
          amount: body.amount,
          unitId: body.unit_id as ServingUnit,
          calories: body.calories,
          proteinG: body.protein_g,
          carbsG: body.carbs_g,
          fatG: body.fat_g,
          fiberG: body.fiber_g,
          sodiumMg: body.sodium_mg,
          saturatedFatG: body.saturated_fat_g ?? null,
          transFatG: body.trans_fat_g ?? null,
          sugarsG: body.sugars_g ?? null,
          caloriesFromFat: body.calories_from_fat ?? null,
          confidence: body.confidence,
          notes: body.notes || null,
          description: body.description || null,
          keywords: body.keywords,
        },
        {
          mealTypeId: body.mealTypeId,
          amount: body.amount,
          unitId: body.unit_id as ServingUnit,
          date,
          time,
          zoneOffset,
          healthLogId: healthLogId ?? null,
        },
        log,
      );
      foodLogId = dbResult.foodLogId;
    } catch (dbErr) {
      log.error(
        { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "DB write failed after health log creation, attempting compensation"
      );
      if (healthLogId && !isDryRun) {
        try {
          const accessToken = await ensureFreshToken(userId, log);
          await deleteNutritionLogs(accessToken, [healthLogId], log, userId);
          log.info({ action: "food_log_compensation", healthLogId }, "health log rolled back after DB failure");
        } catch (compensationErr) {
          log.error(
            { action: "food_log_compensation_failed", healthLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
            "CRITICAL: health log exists but DB write failed and compensation failed"
          );
          return errorResponse("PARTIAL_ERROR", "Food logged to Google Health but local save failed. Manual cleanup may be needed.", 500);
        }
      }
      return errorResponse("INTERNAL_ERROR", "Failed to save food log", 500);
    }

    // Store in idempotency cache if clientToken provided
    if (clientToken) {
      sweepIdempotencyCache();
      const cacheKey = getIdempotencyKey(userId, clientToken);
      idempotencyCache.set(cacheKey, {
        healthLogId,
        foodLogId,
        reusedFood: false,
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      });
    }

    const response: FoodLogResponse = {
      success: true,
      healthLogId,
      reusedFood: false,
      foodLogId,
      ...(isDryRun && { dryRun: true }),
    };

    log.info(
      { action: "log_food_success", healthLogId, reused: false, foodLogId, dryRun: isDryRun || undefined },
      isDryRun ? "food logged in dry-run mode (Health API skipped)" : "food logged successfully"
    );

    return successResponse(response);
  } catch (error) {
    log.error(
      { action: "log_food_error", error: error instanceof Error ? error.message : String(error) },
      "Google Health API error",
    );
    return mapHealthError(error);
  }
}
