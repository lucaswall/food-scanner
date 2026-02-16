import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { analyzeFood } from "@/lib/claude";
import { isFileLike, MAX_IMAGES, MAX_IMAGE_SIZE, ALLOWED_TYPES } from "@/lib/image-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`analyze-food:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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
    logger.warn({ action: "analyze_food_validation" }, "non-file values in images");
    return errorResponse("VALIDATION_ERROR", "Invalid image data", 400);
  }

  const descriptionRaw = formData.get("description");
  if (descriptionRaw !== null && typeof descriptionRaw !== "string") {
    logger.warn({ action: "analyze_food_validation" }, "description is not a string");
    return errorResponse("VALIDATION_ERROR", "Description must be text", 400);
  }
  const description = descriptionRaw;

  const clientDateRaw = formData.get("clientDate");
  const currentDate = typeof clientDateRaw === "string" && isValidDateFormat(clientDateRaw)
    ? clientDateRaw
    : getTodayDate();

  // Validate: at least one image or a description is required
  if (images.length === 0 && (!description || description.trim().length === 0)) {
    logger.warn({ action: "analyze_food_validation" }, "no images or description provided");
    return errorResponse(
      "VALIDATION_ERROR",
      "At least one image or a description is required",
      400
    );
  }

  if (images.length > MAX_IMAGES) {
    logger.warn(
      { action: "analyze_food_validation", imageCount: images.length },
      "too many images"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      `Maximum ${MAX_IMAGES} images allowed`,
      400
    );
  }

  // Validate each image
  for (const image of images) {
    if (!ALLOWED_TYPES.includes(image.type)) {
      logger.warn(
        { action: "analyze_food_validation", imageType: image.type },
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
        { action: "analyze_food_validation", imageSize: image.size },
        "image too large"
      );
      return errorResponse(
        "VALIDATION_ERROR",
        "Each image must be under 10MB",
        400
      );
    }
  }

  logger.info(
    {
      action: "analyze_food_request",
      imageCount: images.length,
      hasDescription: !!description,
    },
    "processing food analysis request"
  );

  try {
    // Convert images to base64 (resilient to individual image failures)
    const imageResults = await Promise.allSettled(
      images.map(async (image) => {
        const buffer = await image.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        return {
          base64,
          mimeType: image.type,
        };
      })
    );

    // Filter out failed images and keep only successful ones
    const imageInputs = imageResults
      .map((result, index) => {
        if (result.status === "rejected") {
          logger.warn(
            { action: "analyze_food_image_processing", imageIndex: index },
            `Failed to process image ${index}: ${result.reason}`
          );
          return null;
        }
        return {
          base64: result.value.base64,
          mimeType: result.value.mimeType,
        };
      })
      .filter((input): input is { base64: string; mimeType: string } => input !== null);

    // If all images failed and there's no description, return an error
    if (imageInputs.length === 0 && (!description || description.trim().length === 0)) {
      logger.warn({ action: "analyze_food_validation" }, "all images failed to process and no description");
      return errorResponse(
        "VALIDATION_ERROR",
        "Failed to process images. Please try again with different photos.",
        400
      );
    }

    const result = await analyzeFood(
      imageInputs,
      description || undefined,
      session!.userId,
      currentDate
    );

    if (result.type === "analysis") {
      logger.info(
        { action: "analyze_food_success", foodName: result.analysis.food_name },
        "food analysis completed"
      );
    } else {
      logger.info(
        { action: "analyze_food_needs_chat" },
        "food analysis needs chat transition"
      );
    }

    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.name === "CLAUDE_API_ERROR") {
      logger.error(
        { action: "analyze_food_error", error: error.message },
        "Claude API error"
      );
      return errorResponse(
        "CLAUDE_API_ERROR",
        "Failed to analyze food image",
        500
      );
    }

    logger.error(
      { action: "analyze_food_error", error: String(error) },
      "unexpected error"
    );
    return errorResponse(
      "CLAUDE_API_ERROR",
      "An unexpected error occurred",
      500
    );
  }
}
