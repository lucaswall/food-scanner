import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { conversationalRefine } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import type { ConversationMessage } from "@/types";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
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

  // Parse optional images array
  let images: Array<{ base64: string; mimeType: string }> = [];
  if (data.images !== undefined) {
    if (!Array.isArray(data.images)) {
      return errorResponse("VALIDATION_ERROR", "images must be an array", 400);
    }
    for (let i = 0; i < data.images.length; i++) {
      if (typeof data.images[i] !== "string") {
        return errorResponse("VALIDATION_ERROR", `images[${i}] must be a base64 string`, 400);
      }
    }
    // Convert base64 strings to ImageInput format
    images = data.images.map((base64) => ({
      base64: base64 as string,
      mimeType: "image/jpeg", // Default to JPEG for chat (images are already compressed client-side)
    }));
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
      session!.userId
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
