import { getSession, validateSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { conversationalRefine, validateFoodAnalysis } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import { MAX_IMAGES, MAX_IMAGE_SIZE } from "@/lib/image-validation";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";
import { createSSEResponse } from "@/lib/sse";
import type { ConversationMessage, FoodAnalysis } from "@/types";

const RATE_LIMIT_MAX = 30;
const MAX_MESSAGES = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/chat-food");
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

  // Validate each message has required fields and per-message images
  let totalImageCount = 0;
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
    if (message.content.length > 2000) {
      return errorResponse("VALIDATION_ERROR", `messages[${i}].content exceeds maximum length of 2000 characters`, 400);
    }

    // Validate per-message images (only valid on user messages)
    if (message.images !== undefined) {
      if (message.role !== "user") {
        return errorResponse("VALIDATION_ERROR", `messages[${i}].images is only valid on user messages`, 400);
      }
      if (!Array.isArray(message.images)) {
        return errorResponse("VALIDATION_ERROR", `messages[${i}].images must be an array`, 400);
      }
      for (let j = 0; j < message.images.length; j++) {
        if (typeof message.images[j] !== "string") {
          return errorResponse("VALIDATION_ERROR", `messages[${i}].images[${j}] must be a base64 string`, 400);
        }
        const imageStr = message.images[j] as string;
        if (imageStr.length === 0) {
          return errorResponse("VALIDATION_ERROR", `messages[${i}].images[${j}] must not be empty`, 400);
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageStr)) {
          return errorResponse("VALIDATION_ERROR", `messages[${i}].images[${j}] is not valid base64`, 400);
        }
        const decodedSize = Math.floor((imageStr.length * 3) / 4) -
          (imageStr.endsWith("==") ? 2 : imageStr.endsWith("=") ? 1 : 0);
        if (decodedSize > MAX_IMAGE_SIZE) {
          return errorResponse("VALIDATION_ERROR", `messages[${i}].images[${j}] exceeds maximum size of 10MB`, 400);
        }
      }
      totalImageCount += message.images.length;
    }
  }

  if (totalImageCount > MAX_IMAGES) {
    return errorResponse("VALIDATION_ERROR", `total images across messages exceeds maximum of ${MAX_IMAGES}`, 400);
  }

  const messages = data.messages as ConversationMessage[];

  // Parse and validate optional initialAnalysis
  let initialAnalysis: FoodAnalysis | undefined;
  if (data.initialAnalysis !== undefined) {
    try {
      initialAnalysis = validateFoodAnalysis(data.initialAnalysis);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "must be a valid food analysis object";
      return errorResponse("VALIDATION_ERROR", `initialAnalysis is invalid: ${detail}`, 400);
    }
  }

  // Use client-provided date (browser timezone) or fall back to server date
  let currentDate = getTodayDate();
  if (typeof data.clientDate === "string" && isValidDateFormat(data.clientDate)) {
    currentDate = data.clientDate;
  }

  log.info(
    {
      action: "chat_food_request",
      messageCount: messages.length,
      imageCount: totalImageCount,
    },
    "processing conversational food chat request"
  );

  const generator = conversationalRefine(
    messages,
    session!.userId,
    currentDate,
    initialAnalysis,
    request.signal,
    log,
  );

  log.info({ action: "chat_food_streaming" }, "starting SSE stream");
  return createSSEResponse(generator);
}
