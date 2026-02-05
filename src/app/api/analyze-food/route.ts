import { getSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { analyzeFood } from "@/lib/claude";

const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
// Note: HEIC not included - client converts HEIC to JPEG before upload
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Type guard for File-like objects (works with both real Files and test mocks)
function isFileLike(value: unknown): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).type === "string" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).arrayBuffer === "function"
  );
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session.sessionId) {
    logger.warn({ action: "analyze_food_unauthorized" }, "no active session");
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (!session.expiresAt || session.expiresAt < Date.now()) {
    logger.warn({ action: "analyze_food_unauthorized" }, "session expired");
    return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
  }

  if (!session.fitbit) {
    logger.warn({ action: "analyze_food_no_fitbit" }, "Fitbit not connected");
    return errorResponse(
      "FITBIT_NOT_CONNECTED",
      "Fitbit account not connected",
      400
    );
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

  // Validate image count
  if (images.length === 0) {
    logger.warn({ action: "analyze_food_validation" }, "no images provided");
    return errorResponse(
      "VALIDATION_ERROR",
      "At least one image is required",
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
    // Convert images to base64
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

    const analysis = await analyzeFood(
      imageInputs,
      description || undefined
    );

    logger.info(
      { action: "analyze_food_success", foodName: analysis.food_name },
      "food analysis completed"
    );

    return successResponse(analysis);
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
