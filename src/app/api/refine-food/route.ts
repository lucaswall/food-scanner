import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { refineAnalysis } from "@/lib/claude";
import type { FoodAnalysis } from "@/types";
import { isFileLike, MAX_IMAGES, MAX_IMAGE_SIZE, ALLOWED_TYPES } from "@/lib/image-validation";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isValidPreviousAnalysis(data: unknown): data is FoodAnalysis {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    typeof obj.food_name === "string" &&
    typeof obj.calories === "number" &&
    typeof obj.protein_g === "number" &&
    typeof obj.carbs_g === "number" &&
    typeof obj.fat_g === "number" &&
    typeof obj.fiber_g === "number" &&
    typeof obj.sodium_mg === "number" &&
    typeof obj.amount === "number" &&
    typeof obj.unit_id === "number" &&
    typeof obj.confidence === "string" &&
    typeof obj.notes === "string" &&
    Array.isArray(obj.keywords)
  );
}

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`refine-food:${session!.email}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid form data", 400);
  }

  const imagesRaw = formData.getAll("images");
  const images = imagesRaw.filter(isFileLike);
  if (images.length !== imagesRaw.length) {
    logger.warn({ action: "refine_food_validation" }, "non-file values in images");
    return errorResponse("VALIDATION_ERROR", "Invalid image data", 400);
  }

  if (images.length === 0) {
    logger.warn({ action: "refine_food_validation" }, "no images provided");
    return errorResponse("VALIDATION_ERROR", "At least one image is required", 400);
  }

  if (images.length > MAX_IMAGES) {
    logger.warn(
      { action: "refine_food_validation", imageCount: images.length },
      "too many images"
    );
    return errorResponse("VALIDATION_ERROR", `Maximum ${MAX_IMAGES} images allowed`, 400);
  }

  for (const image of images) {
    if (!ALLOWED_TYPES.includes(image.type)) {
      logger.warn(
        { action: "refine_food_validation", imageType: image.type },
        "invalid image type"
      );
      return errorResponse(
        "VALIDATION_ERROR",
        "Only JPEG, PNG, GIF, and WebP images are allowed",
        400
      );
    }

    if (image.size > MAX_IMAGE_SIZE) {
      logger.warn(
        { action: "refine_food_validation", imageSize: image.size },
        "image too large"
      );
      return errorResponse("VALIDATION_ERROR", "Each image must be under 10MB", 400);
    }
  }

  // Validate correction
  const correctionRaw = formData.get("correction");
  if (typeof correctionRaw !== "string" || correctionRaw.trim().length === 0) {
    logger.warn({ action: "refine_food_validation" }, "missing correction text");
    return errorResponse("VALIDATION_ERROR", "A correction text is required", 400);
  }
  const correction = correctionRaw.trim();

  // Validate previousAnalysis
  const previousAnalysisRaw = formData.get("previousAnalysis");
  if (typeof previousAnalysisRaw !== "string" || previousAnalysisRaw.length === 0) {
    logger.warn({ action: "refine_food_validation" }, "missing previousAnalysis");
    return errorResponse("VALIDATION_ERROR", "previousAnalysis is required", 400);
  }

  let previousAnalysis: FoodAnalysis;
  try {
    const parsed = JSON.parse(previousAnalysisRaw);
    if (!isValidPreviousAnalysis(parsed)) {
      logger.warn({ action: "refine_food_validation" }, "invalid previousAnalysis shape");
      return errorResponse("VALIDATION_ERROR", "previousAnalysis has invalid shape", 400);
    }
    previousAnalysis = parsed;
  } catch {
    logger.warn({ action: "refine_food_validation" }, "previousAnalysis is not valid JSON");
    return errorResponse("VALIDATION_ERROR", "previousAnalysis must be valid JSON", 400);
  }

  logger.info(
    {
      action: "refine_food_request",
      imageCount: images.length,
      hasCorrection: !!correction,
    },
    "processing food analysis refinement request"
  );

  try {
    const imageInputs = await Promise.all(
      images.map(async (image) => {
        const buffer = await image.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return {
          base64,
          mimeType: image.type,
        };
      })
    );

    const analysis = await refineAnalysis(imageInputs, previousAnalysis, correction);

    logger.info(
      { action: "refine_food_success", foodName: analysis.food_name },
      "food analysis refinement completed"
    );

    return successResponse(analysis);
  } catch (error) {
    if (error instanceof Error && error.name === "CLAUDE_API_ERROR") {
      logger.error(
        { action: "refine_food_error", error: error.message },
        "Claude API error during refinement"
      );
      return errorResponse("CLAUDE_API_ERROR", "Failed to refine food analysis", 500);
    }

    logger.error(
      { action: "refine_food_error", error: String(error) },
      "unexpected error during refinement"
    );
    return errorResponse("CLAUDE_API_ERROR", "An unexpected error occurred", 500);
  }
}
