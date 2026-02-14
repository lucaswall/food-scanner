import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { parseLumenScreenshot, upsertLumenGoals, getLumenGoalsByDate, LumenParseError } from "@/lib/lumen";
import { isFileLike, MAX_IMAGE_SIZE, ALLOWED_TYPES } from "@/lib/image-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return errorResponse("VALIDATION_ERROR", "Missing date parameter", 400);
  }

  if (!isValidDateFormat(date)) {
    logger.warn({ action: "lumen_goals_validation" }, "invalid date format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid date format. Use YYYY-MM-DD",
      400
    );
  }

  try {
    const goals = await getLumenGoalsByDate(session!.userId, date);

    logger.info(
      {
        action: "lumen_goals_get_success",
        date,
        hasGoals: goals !== null,
      },
      "lumen goals retrieved"
    );

    const response = successResponse({ goals });
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "lumen goals retrieval failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve Lumen goals", 500);
  }
}

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`lumen-goals:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid form data", 400);
  }

  const imageRaw = formData.get("image");
  if (!imageRaw || !isFileLike(imageRaw)) {
    logger.warn({ action: "lumen_goals_validation" }, "missing or invalid image");
    return errorResponse("VALIDATION_ERROR", "Image is required", 400);
  }

  const image = imageRaw;

  // Validate image type
  if (!ALLOWED_TYPES.includes(image.type)) {
    logger.warn(
      { action: "lumen_goals_validation", imageType: image.type },
      "invalid image type"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Only JPEG, PNG, GIF, and WebP images are allowed",
      400
    );
  }

  // Validate image size
  if (image.size > MAX_IMAGE_SIZE) {
    logger.warn(
      { action: "lumen_goals_validation", imageSize: image.size },
      "image too large"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Image must be under 10MB",
      400
    );
  }

  // Get optional date from FormData (default to today)
  const dateRaw = formData.get("date");
  let date: string;

  if (dateRaw === null) {
    date = getTodayDate();
  } else if (typeof dateRaw === "string") {
    if (!isValidDateFormat(dateRaw)) {
      logger.warn({ action: "lumen_goals_validation" }, "invalid date format");
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid date format. Use YYYY-MM-DD",
        400
      );
    }
    date = dateRaw;
  } else {
    return errorResponse("VALIDATION_ERROR", "Date must be a string", 400);
  }

  logger.info(
    {
      action: "lumen_goals_parse_request",
      imageType: image.type,
      imageSize: image.size,
      date,
    },
    "processing Lumen screenshot parsing request"
  );

  try {
    // Convert image to base64
    const buffer = await image.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    const parsed = await parseLumenScreenshot(
      {
        base64,
        mimeType: image.type,
      },
      session!.userId
    );

    await upsertLumenGoals(session!.userId, date, parsed);

    logger.info(
      { action: "lumen_goals_parse_success", dayType: parsed.dayType, date },
      "Lumen goals parsed and saved"
    );

    return successResponse({
      date,
      ...parsed,
    });
  } catch (error) {
    if (error instanceof LumenParseError) {
      logger.error(
        { action: "lumen_goals_parse_error", error: error.message },
        "Lumen parsing error"
      );
      return errorResponse(
        "LUMEN_PARSE_ERROR",
        "Failed to parse Lumen screenshot",
        422
      );
    }

    logger.error(
      { action: "lumen_goals_parse_error", error: String(error) },
      "unexpected error"
    );
    return errorResponse(
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      500
    );
  }
}
