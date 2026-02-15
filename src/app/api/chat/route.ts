import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { freeChat } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";
import type { ConversationMessage } from "@/types";

const RATE_LIMIT_MAX = 30;
const MAX_MESSAGES = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: false });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`chat:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
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

  // Use client-provided date (browser timezone) or fall back to server date
  let currentDate = getTodayDate();
  if (typeof data.clientDate === "string" && isValidDateFormat(data.clientDate)) {
    currentDate = data.clientDate;
  }

  logger.info(
    {
      action: "chat_request",
      messageCount: messages.length,
    },
    "processing free chat request"
  );

  try {
    const result = await freeChat(
      messages,
      session!.userId,
      currentDate
    );

    logger.info(
      { action: "chat_success" },
      "free chat completed"
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof Error && error.name === "CLAUDE_API_ERROR") {
      logger.error(
        { action: "chat_error", error: error.message },
        "Claude API error"
      );
      return errorResponse(
        "CLAUDE_API_ERROR",
        "Failed to process chat message",
        500
      );
    }

    logger.error(
      { action: "chat_error", error: String(error) },
      "unexpected error"
    );
    return errorResponse(
      "CLAUDE_API_ERROR",
      "An unexpected error occurred",
      500
    );
  }
}
