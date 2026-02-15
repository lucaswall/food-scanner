import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { conversationalRefine } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import { MAX_IMAGES, MAX_IMAGE_SIZE } from "@/lib/image-validation";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";
import type { ConversationMessage, FoodAnalysis } from "@/types";

const RATE_LIMIT_MAX = 30;
const MAX_MESSAGES = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: false });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`chat-food:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  // Validate body is an object
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be an object", 400);
  }

  const data = body as Record<string, unknown>;

  // Validate messages array
  if (!Array.isArray(data.messages)) {
    return errorResponse("VALIDATION_ERROR", "messages must be an array", 400);
  }

  if (data.messages.length === 0) {
    return errorResponse("VALIDATION_ERROR", "messages array cannot be empty", 400);
  }

  if (data.messages.length > MAX_MESSAGES) {
    return errorResponse("VALIDATION_ERROR", `messages array exceeds maximum of ${MAX_MESSAGES}`, 400);
  }

  // Validate each message has required fields
  for (let i = 0; i < data.messages.length; i++) {
    const msg = data.messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return errorResponse("VALIDATION_ERROR", `messages[${i}] must be an object`, 400);
    }
    const message = msg as Record<string, unknown>;
    if (typeof message.role !== "string" || !["user", "assistant"].includes(message.role)) {
      return errorResponse("VALIDATION_ERROR", `messages[${i}].role must be "user" or "assistant"`, 400);
    }
    if (typeof message.content !== "string") {
      return errorResponse("VALIDATION_ERROR", `messages[${i}].content must be a string`, 400);
    }
  }

  const messages = data.messages as ConversationMessage[];

  // Parse optional initialAnalysis
  let initialAnalysis: FoodAnalysis | undefined;
  if (data.initialAnalysis !== undefined) {
    if (!data.initialAnalysis || typeof data.initialAnalysis !== "object" || Array.isArray(data.initialAnalysis)) {
      return errorResponse("VALIDATION_ERROR", "initialAnalysis must be an object", 400);
    }
    initialAnalysis = data.initialAnalysis as FoodAnalysis;
  }

  // Parse optional images array
  let images: Array<{ base64: string; mimeType: string }> = [];
  if (data.images !== undefined) {
    if (!Array.isArray(data.images)) {
      return errorResponse("VALIDATION_ERROR", "images must be an array", 400);
    }
    if (data.images.length > MAX_IMAGES) {
      return errorResponse("VALIDATION_ERROR", `images array exceeds maximum of ${MAX_IMAGES}`, 400);
    }
    for (let i = 0; i < data.images.length; i++) {
      if (typeof data.images[i] !== "string") {
        return errorResponse("VALIDATION_ERROR", `images[${i}] must be a base64 string`, 400);
      }
      const imageStr = data.images[i] as string;
      // Validate base64 format (only valid base64 characters, non-empty)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageStr)) {
        return errorResponse("VALIDATION_ERROR", `images[${i}] is not valid base64`, 400);
      }
      // Validate decoded size does not exceed MAX_IMAGE_SIZE
      const decodedSize = Math.floor((imageStr.length * 3) / 4) -
        (imageStr.endsWith("==") ? 2 : imageStr.endsWith("=") ? 1 : 0);
      if (decodedSize > MAX_IMAGE_SIZE) {
        return errorResponse("VALIDATION_ERROR", `images[${i}] exceeds maximum size of 10MB`, 400);
      }
    }
    // Convert base64 strings to ImageInput format
    images = data.images.map((base64) => ({
      base64: base64 as string,
      mimeType: "image/jpeg", // Default to JPEG for chat (images are already compressed client-side)
    }));
  }

  // Use client-provided date (browser timezone) or fall back to server date
  let currentDate = getTodayDate();
  if (typeof data.clientDate === "string" && isValidDateFormat(data.clientDate)) {
    currentDate = data.clientDate;
  }

  logger.info(
    {
      action: "chat_food_request",
      messageCount: messages.length,
      imageCount: images.length,
    },
    "processing conversational food chat request"
  );

  try {
    const result = await conversationalRefine(
      messages,
      images,
      session!.userId,
      currentDate,
      initialAnalysis
    );

    logger.info(
      { action: "chat_food_success", hasAnalysis: !!result.analysis },
      "conversational food chat completed"
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.name === "CLAUDE_API_ERROR") {
      logger.error(
        { action: "chat_food_error", error: error.message },
        "Claude API error"
      );
      return errorResponse(
        "CLAUDE_API_ERROR",
        "Failed to process chat message",
        500
      );
    }

    logger.error(
      { action: "chat_food_error", error: String(error) },
      "unexpected error"
    );
    return errorResponse(
      "CLAUDE_API_ERROR",
      "An unexpected error occurred",
      500
    );
  }
}
