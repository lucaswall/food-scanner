import { getSession, validateSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { conversationalRefine, validateFoodAnalysis } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";
import { createSSEResponse } from "@/lib/sse";
import { validateChatMessages } from "@/lib/message-validation";
import type { FoodAnalysis } from "@/types";

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
  const messagesResult = validateChatMessages(data.messages, MAX_MESSAGES);
  if (!messagesResult.ok) {
    return errorResponse(messagesResult.errorCode, messagesResult.errorMessage, messagesResult.status);
  }
  const { messages, totalImageCount } = messagesResult;

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
