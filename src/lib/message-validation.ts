import { MAX_IMAGES, MAX_IMAGE_SIZE } from "@/lib/image-validation";
import type { ConversationMessage, ErrorCode } from "@/types";

const DEFAULT_MAX_MESSAGES = 30;

export type MessagesValidationResult =
  | { ok: true; messages: ConversationMessage[]; totalImageCount: number }
  | { ok: false; errorCode: ErrorCode; errorMessage: string; status: number };

/**
 * Validates a messages array from a chat request body.
 * Returns ok=true with typed messages + totalImageCount, or ok=false with error details.
 */
export function validateChatMessages(
  rawMessages: unknown,
  maxMessages = DEFAULT_MAX_MESSAGES,
  maxImages = MAX_IMAGES,
): MessagesValidationResult {
  if (!Array.isArray(rawMessages)) {
    return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: "messages must be an array", status: 400 };
  }

  if (rawMessages.length === 0) {
    return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: "messages array cannot be empty", status: 400 };
  }

  if (rawMessages.length > maxMessages) {
    return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages array exceeds maximum of ${maxMessages}`, status: 400 };
  }

  let totalImageCount = 0;

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}] must be an object`, status: 400 };
    }
    const message = msg as Record<string, unknown>;
    if (typeof message.role !== "string" || !["user", "assistant"].includes(message.role)) {
      return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].role must be "user" or "assistant"`, status: 400 };
    }
    if (typeof message.content !== "string") {
      return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].content must be a string`, status: 400 };
    }
    if (message.content.length > 2000) {
      return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].content exceeds maximum length of 2000 characters`, status: 400 };
    }

    // Validate per-message images (only valid on user messages)
    if (message.images !== undefined) {
      if (message.role !== "user") {
        return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images is only valid on user messages`, status: 400 };
      }
      if (!Array.isArray(message.images)) {
        return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images must be an array`, status: 400 };
      }
      for (let j = 0; j < message.images.length; j++) {
        if (typeof message.images[j] !== "string") {
          return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images[${j}] must be a base64 string`, status: 400 };
        }
        const imageStr = message.images[j] as string;
        if (imageStr.length === 0) {
          return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images[${j}] must not be empty`, status: 400 };
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageStr)) {
          return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images[${j}] is not valid base64`, status: 400 };
        }
        const decodedSize = Math.floor((imageStr.length * 3) / 4) -
          (imageStr.endsWith("==") ? 2 : imageStr.endsWith("=") ? 1 : 0);
        if (decodedSize > MAX_IMAGE_SIZE) {
          return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `messages[${i}].images[${j}] exceeds maximum size of 10MB`, status: 400 };
        }
      }
      totalImageCount += message.images.length;
    }
  }

  if (totalImageCount > maxImages) {
    return { ok: false, errorCode: "VALIDATION_ERROR", errorMessage: `total images across messages exceeds maximum of ${maxImages}`, status: 400 };
  }

  return { ok: true, messages: rawMessages as ConversationMessage[], totalImageCount };
}
