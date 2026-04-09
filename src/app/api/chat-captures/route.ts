import { getSession, validateSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { triageRefine, validateFoodAnalysis } from "@/lib/claude";
import { checkRateLimit } from "@/lib/rate-limit";
import { createSSEResponse } from "@/lib/sse";
import { validateChatMessages } from "@/lib/message-validation";
import type { FoodAnalysis } from "@/types";

const RATE_LIMIT_MAX = 30;
const MAX_MESSAGES = 30;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/chat-captures");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: false });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`chat-captures:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be an object", 400);
  }

  const data = body as Record<string, unknown>;

  // Validate messages
  const messagesResult = validateChatMessages(data.messages, MAX_MESSAGES);
  if (!messagesResult.ok) {
    return errorResponse(messagesResult.errorCode, messagesResult.errorMessage, messagesResult.status);
  }
  const { messages } = messagesResult;

  // Parse and validate optional initialItems
  let initialItems: FoodAnalysis[] | undefined;
  if (data.initialItems !== undefined) {
    if (!Array.isArray(data.initialItems)) {
      return errorResponse("VALIDATION_ERROR", "initialItems must be an array", 400);
    }
    const validatedItems: FoodAnalysis[] = [];
    for (const item of data.initialItems) {
      try {
        validatedItems.push(validateFoodAnalysis(item));
      } catch (error) {
        const detail = error instanceof Error ? error.message : "invalid item";
        return errorResponse("VALIDATION_ERROR", `initialItems contains invalid item: ${detail}`, 400);
      }
    }
    initialItems = validatedItems;
  }

  log.info(
    { action: "chat_captures_request", messageCount: messages.length, initialItemCount: initialItems?.length ?? 0 },
    "processing triage chat request"
  );

  const generator = triageRefine(messages, session!.userId, initialItems, request.signal, log);

  log.info({ action: "chat_captures_streaming" }, "starting SSE stream for triage chat");
  return createSSEResponse(generator);
}
