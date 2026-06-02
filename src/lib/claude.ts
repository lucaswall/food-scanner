import Anthropic from "@anthropic-ai/sdk";
import * as Sentry from "@sentry/nextjs";
import type { FoodAnalysis, ConversationMessage, FoodLogEntryDetail } from "@/types";
import { getUnitLabel, MEAL_TYPE_LABELS, coerceServingUnit } from "@/types";
import { logger, startTimer } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { isValidDateFormat } from "@/lib/date-utils";
import { recordUsage } from "@/lib/claude-usage";
import { executeTool, SEARCH_FOOD_LOG_TOOL, GET_NUTRITION_SUMMARY_TOOL, GET_FASTING_INFO_TOOL, SEARCH_NUTRITION_LABELS_TOOL, SAVE_NUTRITION_LABEL_TOOL, MANAGE_NUTRITION_LABEL_TOOL } from "@/lib/chat-tools";
// buildUserProfile moved to @/lib/claude-prompts (used by getSystemPrompt)
import type { StreamEvent } from "@/lib/sse";

// Using base model alias — dated snapshots may not be available yet
export const CLAUDE_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const client = new Anthropic({
      apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
      timeout: 120000, // 120 second timeout — accommodates streaming with web search
      maxRetries: 2,
    });
    _client = Sentry.instrumentAnthropicAiClient(client);
  }
  return _client;
}

// ─── Prompt constants and builders — re-exported from claude-prompts.ts (barrel) ───
export {
  SYSTEM_PROMPT,
  CHAT_ROLE_INSTRUCTIONS,
  CHAT_SYSTEM_PROMPT,
  ANALYSIS_ROLE_INSTRUCTIONS,
  ANALYSIS_SYSTEM_PROMPT,
  EDIT_ROLE_INSTRUCTIONS,
  EDIT_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  getSystemPrompt,
  getAnalysisSystemPrompt,
  getChatSystemPrompt,
  getEditSystemPrompt,
  mapStopReasonToError,
} from "@/lib/claude-prompts";
// Import only what is directly referenced inside claude.ts function bodies
import {
  CHAT_SYSTEM_PROMPT,
  TRIAGE_SYSTEM_PROMPT,
  getAnalysisSystemPrompt,
  getChatSystemPrompt,
  getEditSystemPrompt,
} from "@/lib/claude-prompts";

// ─── Tool schemas — re-exported from claude-tools-schema.ts (barrel) ──────────
export {
  WEB_SEARCH_TOOL,
  REPORT_NUTRITION_TOOL,
  REPORT_SESSION_ITEMS_TOOL,
} from "@/lib/claude-tools-schema";
import {
  WEB_SEARCH_TOOL,
  REPORT_NUTRITION_TOOL,
  REPORT_SESSION_ITEMS_TOOL,
} from "@/lib/claude-tools-schema";

export interface ImageInput {
  base64: string;
  mimeType: string;
}

class ClaudeApiError extends Error {
  requestId?: string;
  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "CLAUDE_API_ERROR";
    this.requestId = requestId;
  }
}

/** Extract Anthropic request_id from an error, if available. */
function extractRequestId(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const e = error as Record<string, unknown>;
  // Anthropic SDK APIError exposes request_id directly
  if (typeof e.request_id === "string") return e.request_id;
  // SSE errors nest it inside error.error
  if (e.error !== null && typeof e.error === "object") {
    const body = e.error as Record<string, unknown>;
    if (typeof body.request_id === "string") return body.request_id;
  }
  return undefined;
}

/**
 * Returns true if the error is a Claude API overloaded error (HTTP 529).
 * Checks both the Anthropic SDK APIError status and duck-typing on the error body.
 */
export function isOverloadedError(error: unknown): boolean {
  // Check 1: Anthropic SDK APIError with status 529
  if (error instanceof Anthropic.APIError && error.status === 529) {
    return true;
  }
  // Check 2: Duck-typing — error body has type: 'overloaded_error'
  if (error !== null && typeof error === "object" && "error" in error) {
    const body = (error as Record<string, unknown>).error;
    if (body !== null && typeof body === "object" && "type" in (body as object)) {
      if ((body as Record<string, unknown>).type === "overloaded_error") {
        return true;
      }
      // Check 3: SSE streaming errors — nested one level deeper: { type: "error", error: { type: "overloaded_error" } }
      if ("error" in (body as object)) {
        const inner = (body as Record<string, unknown>).error;
        if (inner !== null && typeof inner === "object" && "type" in (inner as object)) {
          return (inner as Record<string, unknown>).type === "overloaded_error";
        }
      }
    }
  }
  return false;
}

/** Returns true if the error is a client-initiated abort (user navigated away, closed the app). */
function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.includes("aborted") || error.message.includes("Request was aborted");
  }
  return false;
}

const RETRY_DELAYS_MS = [2000, 5000, 10000] as const;

/**
 * Context management config applied to all API calls via the beta channel.
 * Clears tool-use history when the context grows large, keeping the conversation
 * manageable without client-side truncation. web_search is excluded so cached
 * search results survive the clear.
 */
const CONTEXT_MANAGEMENT = {
  betas: ["context-management-2025-06-27"] as Anthropic.Beta.AnthropicBeta[],
  context_management: {
    edits: [
      {
        type: "clear_tool_uses_20250919" as const,
        trigger: { type: "input_tokens" as const, value: 150000 },
        keep: { type: "tool_uses" as const, value: 2 },
        clear_at_least: { type: "input_tokens" as const, value: 10000 },
        exclude_tools: ["web_search"],
      },
    ],
  },
};

/**
 * Creates a Claude API stream with automatic retry on overloaded errors.
 * Uses the beta channel for server-side context management (clear_tool_uses).
 * Yields a retry text_delta event before each retry so the UI can show feedback.
 * Throws ClaudeApiError if all retries are exhausted or if a non-overloaded error occurs.
 *
 * Two-layer retry architecture:
 * - SDK retries (maxRetries: 2) handle HTTP-level failures: timeouts, 529 status, connection errors.
 * - This function's custom retry handles SSE-level overloaded errors that occur mid-stream.
 * These layers don't conflict — SDK retries fire before the stream starts, ours fire after.
 */
export async function* createStreamWithRetry(
  streamParams: Parameters<Anthropic["messages"]["stream"]>[0],
  requestOptions: { signal?: AbortSignal | null } | null | undefined,
  log: Logger,
  maxRetries = 3,
): AsyncGenerator<StreamEvent, Anthropic.Message> {
  let attempt = 0;

  while (true) {
    try {
      const betaParams = {
        ...streamParams,
        ...CONTEXT_MANAGEMENT,
      } as Parameters<Anthropic["beta"]["messages"]["stream"]>[0];
      const stream = getClient().beta.messages.stream(
        betaParams,
        requestOptions ?? {},
      );
      const msg: Anthropic.Message = yield* streamTextDeltas(
        stream as unknown as { [Symbol.asyncIterator](): AsyncIterator<unknown>; finalMessage(): Promise<Anthropic.Message> }
      );
      return msg;
    } catch (error) {
      if (isOverloadedError(error) && attempt < maxRetries) {
        const delayMs = RETRY_DELAYS_MS[attempt] ?? 3000;
        log.warn({ action: "stream_retry", attempt, delayMs }, "Claude API overloaded, retrying stream");
        attempt++;
        yield { type: "text_delta", text: "\n\n*The AI service is momentarily busy, retrying...*\n\n" };
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (isOverloadedError(error)) {
        log.warn({ action: "stream_retry_exhausted", attempt }, "Claude API persistently overloaded, exhausted retries");
        throw new ClaudeApiError("The AI service is temporarily overloaded. Please try again in a moment.", extractRequestId(error));
      }
      throw error;
    }
  }
}

/** Build a debug payload summarizing a Claude API response */
function summarizeResponse(response: Anthropic.Message): Record<string, unknown> {
  const blockTypes = response.content.map((b) => b.type);
  const toolNames = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => b.name);
  return {
    stopReason: response.stop_reason,
    blockTypes,
    ...(toolNames.length > 0 && { toolNames }),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}

/** Serialize a single content block for logging, replacing base64 image data with a placeholder */
function serializeBlockForLog(block: Anthropic.ContentBlockParam | Anthropic.ContentBlock): unknown {
  if (typeof block === "string") return block;

  if (block.type === "image" && "source" in block) {
    const source = block.source as { type: string; media_type?: string; data?: string };
    return { type: "image", mediaType: source.media_type, dataLength: source.data?.length ?? 0 };
  }
  if (block.type === "text" && "text" in block) {
    return { type: "text", text: (block as { text: string }).text };
  }
  if (block.type === "tool_use") {
    const tb = block as Anthropic.ToolUseBlock;
    return { type: "tool_use", id: tb.id, name: tb.name, input: tb.input };
  }
  if (block.type === "tool_result") {
    const tr = block as { type: string; tool_use_id: string; content?: unknown; is_error?: boolean };
    return { type: "tool_result", toolUseId: tr.tool_use_id, content: tr.content, isError: tr.is_error };
  }
  // web_search_tool_result, server_tool_use, code execution results, etc. — pass through type only
  return { type: (block as { type: string }).type };
}

/** Serialize Anthropic messages for debug logging (strips base64 image data) */
function serializeMessagesForLog(messages: Anthropic.MessageParam[]): unknown[] {
  return messages.map((msg) => {
    if (typeof msg.content === "string") {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: (msg.content as Anthropic.ContentBlockParam[]).map(serializeBlockForLog),
    };
  });
}

/** Serialize a Claude response's content blocks for debug logging */
function serializeResponseContentForLog(response: Anthropic.Message): unknown[] {
  return response.content.map(serializeBlockForLog);
}

function normalizeKeywords(raw: string[]): string[] {
  const normalized = raw
    .flatMap(k => {
      const trimmed = k.trim().toLowerCase();
      if (trimmed.length === 0) return [];
      // Replace spaces with hyphens for compound concepts
      return [trimmed.replace(/\s+/g, "-")];
    })
    .filter((k, i, arr) => arr.indexOf(k) === i) // deduplicate
    .slice(0, 5); // cap at 5

  return normalized;
}

export function validateFoodAnalysis(input: unknown): FoodAnalysis {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ClaudeApiError("Invalid food analysis: input must be an object");
  }
  const data = input as Record<string, unknown>;

  if (typeof data.food_name !== "string" || data.food_name.length === 0) {
    throw new ClaudeApiError("Invalid food analysis: missing food_name");
  }

  const numericFields = [
    "amount", "calories", "protein_g",
    "carbs_g", "fat_g", "fiber_g", "sodium_mg",
  ] as const;

  // Coerce serving_unit from model output — tolerant, defaults to 'serving' on unknown values.
  // Also accepts unit_id (the field name used in FoodAnalysis objects from clients/DB).
  const rawServingUnit = data.serving_unit ?? data.unit_id;
  const unit_id = coerceServingUnit(rawServingUnit);
  if (typeof rawServingUnit !== "string" || unit_id !== rawServingUnit) {
    logger.warn(
      { action: "validation_coerce_serving_unit", received: rawServingUnit },
      "coerced invalid serving_unit to default"
    );
  }

  for (const field of numericFields) {
    if (typeof data[field] !== "number") {
      throw new ClaudeApiError(`Invalid food analysis: ${field} must be a number`);
    }
    if ((data[field] as number) < 0) {
      throw new ClaudeApiError(`Invalid food analysis: ${field} must not be negative`);
    }
  }

  if (data.amount === 0) {
    throw new ClaudeApiError("Invalid food analysis: amount must be positive");
  }

  const validConfidence = ["high", "medium", "low"];
  let confidence: string;
  if (validConfidence.includes(data.confidence as string)) {
    confidence = data.confidence as string;
  } else {
    logger.warn({ action: "validation_coerce_confidence", received: data.confidence }, "coerced invalid confidence to medium");
    confidence = "medium";
  }

  const notes = typeof data.notes === "string" ? data.notes : "";

  let rawKeywords: string[];
  if (typeof data.keywords === "string") {
    rawKeywords = [data.keywords];
  } else if (Array.isArray(data.keywords)) {
    rawKeywords = data.keywords.filter((k: unknown): k is string => typeof k === "string");
  } else {
    rawKeywords = [];
  }

  let keywords = normalizeKeywords(rawKeywords);
  if (keywords.length === 0) {
    // Derive from food_name: split on whitespace, lowercase, take first 3
    const foodName = data.food_name as string;
    keywords = normalizeKeywords(foodName.split(/\s+/).slice(0, 3));
    if (keywords.length === 0) {
      keywords = [foodName.split(/\s+/)[0].toLowerCase()];
    }
    logger.warn({ action: "validation_coerce_keywords", received: typeof data.keywords, foodName }, "coerced invalid keywords from food_name");
  }

  // Validate description - default to empty string if missing
  const description = typeof data.description === "string" ? data.description : "";
  if (data.description !== undefined && typeof data.description !== "string") {
    throw new ClaudeApiError("Invalid food analysis: description must be a string");
  }

  // Validate Tier 1 optional nutrients
  const tier1Fields = ["saturated_fat_g", "trans_fat_g", "sugars_g", "calories_from_fat"] as const;
  const tier1Values: Record<string, number | null> = {};

  for (const field of tier1Fields) {
    const value = data[field];
    if (value === undefined || value === null) {
      // Omitted or explicitly null → normalize to null
      tier1Values[field] = null;
    } else if (typeof value === "number") {
      // Present as number → validate non-negative
      if (value < 0) {
        throw new ClaudeApiError(`Invalid food analysis: ${field} must not be negative`);
      }
      tier1Values[field] = value;
    } else {
      // Present but not number or null → reject
      throw new ClaudeApiError(`Invalid food analysis: ${field} must be a number or null`);
    }
  }

  // Validate source_custom_food_id: number (>0) or null/undefined/0
  const rawSourceId = data.source_custom_food_id;
  if (rawSourceId !== undefined && rawSourceId !== null && typeof rawSourceId !== "number") {
    throw new ClaudeApiError("Invalid food analysis: source_custom_food_id must be a number or null");
  }
  const sourceCustomFoodId = typeof rawSourceId === "number" && rawSourceId > 0
    ? rawSourceId
    : undefined;

  // Validate editing_entry_id: positive integer or null/undefined/0 → omit
  const rawEditingEntryId = data.editing_entry_id;
  if (rawEditingEntryId !== undefined && rawEditingEntryId !== null && typeof rawEditingEntryId !== "number") {
    throw new ClaudeApiError("Invalid food analysis: editing_entry_id must be a number or null");
  }
  if (typeof rawEditingEntryId === "number" && rawEditingEntryId < 0) {
    throw new ClaudeApiError("Invalid food analysis: editing_entry_id must not be negative");
  }
  const editingEntryId = typeof rawEditingEntryId === "number" && rawEditingEntryId > 0
    ? rawEditingEntryId
    : undefined;

  // Validate optional time field: null/undefined (absent) or valid HH:mm string
  // Claude sometimes sends the string "null" instead of actual null — treat it as null
  const rawTime = data.time === "null" ? null : data.time;
  let validatedTime: string | null | undefined;
  if (rawTime === undefined) {
    validatedTime = undefined;
  } else if (rawTime === null) {
    validatedTime = null;
  } else if (typeof rawTime === "string") {
    if (!/^\d{2}:\d{2}$/.test(rawTime)) {
      throw new ClaudeApiError("Invalid food analysis: time must be in HH:mm format");
    }
    const [hh, mm] = rawTime.split(":").map(Number);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
      throw new ClaudeApiError("Invalid food analysis: time has invalid hour or minute value");
    }
    validatedTime = rawTime;
  } else {
    throw new ClaudeApiError("Invalid food analysis: time must be a string in HH:mm format or null");
  }

  // Validate optional date field: null/undefined (absent) or valid YYYY-MM-DD string
  // Claude sometimes sends the string "null" instead of actual null — treat it as null
  const rawDate = data.date === "null" ? null : data.date;
  let validatedDate: string | null | undefined;
  if (rawDate === undefined) {
    validatedDate = undefined;
  } else if (rawDate === null) {
    validatedDate = null;
  } else if (typeof rawDate === "string") {
    if (!isValidDateFormat(rawDate)) {
      throw new ClaudeApiError("Invalid food analysis: date must be in YYYY-MM-DD format with valid month/day");
    }
    validatedDate = rawDate;
  } else {
    throw new ClaudeApiError("Invalid food analysis: date must be a string in YYYY-MM-DD format or null");
  }

  // Validate optional meal_type_id field: null/undefined or one of valid meal type IDs
  const VALID_MEAL_TYPE_IDS = new Set([1, 2, 3, 4, 5, 7]);
  const rawMealTypeId = data.meal_type_id;
  let validatedMealTypeId: number | null | undefined;
  if (rawMealTypeId === undefined) {
    validatedMealTypeId = undefined;
  } else if (rawMealTypeId === null) {
    validatedMealTypeId = null;
  } else if (typeof rawMealTypeId === "number") {
    if (!VALID_MEAL_TYPE_IDS.has(rawMealTypeId)) {
      throw new ClaudeApiError("Invalid food analysis: meal_type_id must be 1, 2, 3, 4, 5, or 7");
    }
    validatedMealTypeId = rawMealTypeId;
  } else {
    throw new ClaudeApiError("Invalid food analysis: meal_type_id must be a number or null");
  }

  const result: FoodAnalysis = {
    food_name: data.food_name as string,
    amount: data.amount as number,
    unit_id,
    calories: data.calories as number,
    protein_g: data.protein_g as number,
    carbs_g: data.carbs_g as number,
    fat_g: data.fat_g as number,
    fiber_g: data.fiber_g as number,
    sodium_mg: data.sodium_mg as number,
    saturated_fat_g: tier1Values.saturated_fat_g,
    trans_fat_g: tier1Values.trans_fat_g,
    sugars_g: tier1Values.sugars_g,
    calories_from_fat: tier1Values.calories_from_fat,
    confidence: confidence as FoodAnalysis["confidence"],
    notes,
    keywords,
    description,
  };

  if (sourceCustomFoodId !== undefined) {
    result.sourceCustomFoodId = sourceCustomFoodId;
  }

  if (editingEntryId !== undefined) {
    result.editingEntryId = editingEntryId;
  }

  if (validatedDate !== undefined) {
    result.date = validatedDate;
  }

  if (validatedTime !== undefined) {
    result.time = validatedTime;
  }

  if (validatedMealTypeId !== undefined) {
    result.mealTypeId = validatedMealTypeId;
  }

  return result;
}


const DATA_TOOLS = [
  SEARCH_FOOD_LOG_TOOL,
  GET_NUTRITION_SUMMARY_TOOL,
  GET_FASTING_INFO_TOOL,
  SEARCH_NUTRITION_LABELS_TOOL,
  SAVE_NUTRITION_LABEL_TOOL,
  MANAGE_NUTRITION_LABEL_TOOL,
];

/**
 * Build a date/time context block to append as the trailing block of the leading
 * user message. Keeping it out of the system prompt makes the system text stable
 * and cache-friendly (system changes only when the user profile changes, not daily).
 */
function buildDateContextBlock(
  currentDate: string,
  currentTime?: string,
): { type: "text"; text: string } {
  const text = currentTime
    ? `Today's date is: ${currentDate}. Current time: ${currentTime}`
    : `Today's date is: ${currentDate}`;
  return { type: "text" as const, text };
}

/** Build toolsWithCache: adds cache_control to the last tool (doesn't mutate originals) */
function buildToolsWithCache(
  tools: Array<Anthropic.Messages.ToolUnion>,
): Array<Anthropic.Messages.ToolUnion> {
  return tools.map((tool, index) =>
    index === tools.length - 1
      ? { ...tool, cache_control: { type: "ephemeral" as const } }
      : tool
  );
}

/**
 * Stream text deltas from a MessageStream, yielding StreamEvent for each delta.
 * Returns the complete final message after the stream is exhausted.
 */
async function* streamTextDeltas(
  stream: { [Symbol.asyncIterator](): AsyncIterator<unknown>; finalMessage(): Promise<Anthropic.Message> },
): AsyncGenerator<StreamEvent, Anthropic.Message> {
  // The SDK's _accumulateMessage doesn't copy container from message_delta events,
  // so we capture it from the raw event and patch the final message.
  let deltaContainer: Anthropic.Messages.Container | null = null;
  for await (const event of stream) {
    const e = event as Record<string, unknown>;
    if (
      e.type === "content_block_delta" &&
      e.delta !== null &&
      typeof e.delta === "object" &&
      (e.delta as Record<string, unknown>).type === "text_delta"
    ) {
      yield { type: "text_delta", text: (e.delta as { type: "text_delta"; text: string }).text };
    }
    if (e.type === "message_delta" && e.delta !== null && typeof e.delta === "object") {
      const delta = e.delta as Record<string, unknown>;
      if (delta.container !== undefined && delta.container !== null) {
        deltaContainer = delta.container as Anthropic.Messages.Container;
      }
    }
  }
  const msg = await stream.finalMessage() as Anthropic.Message;
  if (deltaContainer && !msg.container) {
    msg.container = deltaContainer;
  }
  return msg;
}

/**
 * Execute data tool blocks in parallel, returning tool_result entries.
 */
async function executeDataTools(
  dataToolBlocks: Anthropic.ToolUseBlock[],
  userId: string,
  currentDate: string,
  l: Logger,
): Promise<Array<{ type: "tool_result"; tool_use_id: string; content: string; is_error?: true }>> {
  return Promise.all(
    dataToolBlocks.map(async (toolUse) => {
      try {
        const result = await executeTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
          userId,
          currentDate,
          l,
        );
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: result,
        };
      } catch (error) {
        l.warn(
          { action: "tool_execution_error", tool: toolUse.name, error: error instanceof Error ? error.message : String(error) },
          "tool execution error"
        );
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true as const,
        };
      }
    })
  );
}

/**
 * Appends an assistant message to the conversation, merging with the previous
 * assistant message if one exists (prevents consecutive same-role messages
 * that the Anthropic API rejects, e.g. after pause_turn continuations).
 */
function appendAssistantContent(
  messages: Anthropic.MessageParam[],
  content: Anthropic.ContentBlock[],
): void {
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "assistant" && Array.isArray(lastMsg.content)) {
    lastMsg.content = [...(lastMsg.content as Anthropic.ContentBlock[]), ...content];
  } else {
    messages.push({ role: "assistant", content });
  }
}

/**
 * Core streaming tool loop. Yields StreamEvent objects as Claude processes requests.
 *
 * Yields:
 * - text_delta: as Claude emits text
 * - tool_start: when a tool is about to be executed
 * - usage: after each API call with token counts
 * - analysis: when report_nutrition is validated
 * - done: when the conversation is complete
 * - error: when max iterations exceeded or aborted
 */
export async function* runToolLoop(
  messages: Anthropic.MessageParam[],
  userId: string,
  currentDate: string,
  options?: {
    systemPrompt?: string;
    tools?: Array<Anthropic.Messages.ToolUnion>;
    operation?: string;
    signal?: AbortSignal;
    log?: Logger;
    maxTokens?: number;
    containerId?: string;
  }
): AsyncGenerator<StreamEvent> {
  const l = options?.log ?? logger;
  const loopElapsed = startTimer();
  const systemPrompt = options?.systemPrompt ?? await getChatSystemPrompt(userId, currentDate);
  const tools = options?.tools ?? [WEB_SEARCH_TOOL, ...DATA_TOOLS];
  const operation = options?.operation ?? "food-chat";
  const maxTokens = options?.maxTokens ?? 2048;
  const toolsWithCache = buildToolsWithCache(tools);

  const conversationMessages: Anthropic.MessageParam[] = [...messages];
  const MAX_ITERATIONS = 5;
  let iteration = 0;
  let pendingAnalysis: FoodAnalysis | undefined;
  let containerId: string | undefined = options?.containerId;

  try {
    while (iteration < MAX_ITERATIONS) {
      if (options?.signal?.aborted) {
        yield { type: "error", message: "Request aborted by client" };
        return;
      }
      iteration++;

      l.info(
        { action: "claude_api_call", iteration, messageCount: conversationMessages.length },
        "calling Claude API in tool loop"
      );
      l.debug(
        { action: "tool_loop_request_detail", iteration, messages: serializeMessagesForLog(conversationMessages) },
        "tool loop full conversation state"
      );

      const iterElapsed = startTimer();
      // Stream text deltas in real time (with overload retry)
      const response = yield* createStreamWithRetry({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system: [
          {
            type: "text" as const,
            text: systemPrompt,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        tools: toolsWithCache,
        tool_choice: { type: "auto" },
        messages: conversationMessages,
        ...(containerId && { container: containerId }),
      }, { signal: options?.signal }, l);

      if (response.container) {
        containerId = response.container.id;
      }

      l.debug({ action: "tool_loop_api_call", iteration, durationMs: iterElapsed() }, "tool loop API call completed");
      l.debug({ action: "tool_loop_iteration", iteration, ...summarizeResponse(response) }, "tool loop iteration response");
      l.debug(
        { action: "tool_loop_response_content", iteration, content: serializeResponseContentForLog(response) },
        "tool loop response content"
      );

      // Yield usage event
      yield {
        type: "usage",
        data: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };

      // Record usage (fire-and-forget)
      if (userId) {
        recordUsage(userId, response.model, operation, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        }).catch((error) => {
          l.warn(
            { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
            "failed to record API usage"
          );
        });
      }

      if (response.stop_reason === "end_turn") {
        // Check for report_nutrition in end_turn (it can appear here too)
        const reportNutritionBlock = response.content.find(
          (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
        ) as Anthropic.ToolUseBlock | undefined;

        let analysis: FoodAnalysis | undefined;
        if (reportNutritionBlock) {
          try {
            analysis = validateFoodAnalysis(reportNutritionBlock.input);
          } catch (error) {
            l.warn(
              { action: "report_nutrition_validation_error", error: error instanceof Error ? error.message : String(error) },
              "invalid report_nutrition in end_turn, ignoring"
            );
          }
        }

        // Use pending analysis from earlier iteration if no analysis in final response
        if (!analysis && pendingAnalysis) {
          analysis = pendingAnalysis;
        }

        if (analysis) {
          yield { type: "analysis", analysis };
        }

        l.info({ action: "tool_loop_completed", iteration, hasAnalysis: !!analysis, exitReason: "end_turn", durationMs: loopElapsed() }, "tool loop completed");
        yield { type: "done" };
        return;
      }

      if (response.stop_reason === "tool_use") {
        // Extract all tool_use blocks (client-side tools only — not server_tool_use)
        const allToolUseBlocks = response.content.filter(
          (block) => block.type === "tool_use"
        ) as Anthropic.ToolUseBlock[];

        // Detect server_tool_use blocks (web search, code execution) — yield tool_start for user-facing ones
        const serverToolUseBlocks = response.content.filter(
          (block) => block.type === "server_tool_use"
        ) as Array<{ type: string; name: string; id: string }>;
        for (const block of serverToolUseBlocks) {
          // Only show web_search to the user — code execution is an internal filtering mechanism
          if (block.name === "web_search") {
            yield { type: "tool_start", tool: block.name };
          }
        }

        // Separate report_nutrition from data tools
        const reportNutritionBlocks = allToolUseBlocks.filter(
          (block) => block.name === "report_nutrition"
        );
        const dataToolBlocks = allToolUseBlocks.filter(
          (block) => block.name !== "report_nutrition"
        );

        // Yield tool_start for data tools
        for (const tool of dataToolBlocks) {
          yield { type: "tool_start", tool: tool.name };
        }

        // If report_nutrition is present, validate first block and store as pending analysis
        if (reportNutritionBlocks.length > 0) {
          try {
            pendingAnalysis = validateFoodAnalysis(reportNutritionBlocks[0].input);
            l.info(
              { action: "report_nutrition_captured", foodName: pendingAnalysis.food_name, blockCount: reportNutritionBlocks.length, sourceCustomFoodId: pendingAnalysis.sourceCustomFoodId ?? null },
              "captured report_nutrition from tool loop"
            );
          } catch (error) {
            l.warn(
              { action: "report_nutrition_validation_error", error: error instanceof Error ? error.message : String(error) },
              "invalid report_nutrition in tool loop, ignoring"
            );
          }
        }

        l.debug(
          {
            action: "tool_loop_tool_calls",
            iteration,
            toolCount: allToolUseBlocks.length,
            dataToolCount: dataToolBlocks.length,
            tools: allToolUseBlocks.map((b) => ({ name: b.name })),
          },
          "executing tools"
        );

        // Add assistant message with tool_use blocks (merges if last message is already assistant, e.g. after pause_turn)
        appendAssistantContent(conversationMessages, response.content);

        // Build tool results
        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: true;
        }> = [];

        // Add synthetic result for each report_nutrition block so Claude doesn't think they failed
        for (const block of reportNutritionBlocks) {
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: "Nutrition analysis recorded.",
          });
        }

        // Execute data tools in parallel
        const dataToolResults = await executeDataTools(dataToolBlocks, userId, currentDate, l);
        toolResults.push(...dataToolResults);

        l.debug(
          {
            action: "tool_loop_tool_results",
            iteration,
            results: toolResults.map((r) => ({
              toolUseId: r.tool_use_id,
              content: r.content,
              isError: r.is_error,
            })),
          },
          "tool results sent back to Claude"
        );

        // Add user message with all tool_result blocks
        conversationMessages.push({
          role: "user",
          content: toolResults,
        });

        // Continue loop
        continue;
      }

      if (response.stop_reason === "pause_turn") {
        // Code execution or web search dynamic filtering paused a long-running turn.
        // Send the response back as-is so Claude can continue (merges if last is already assistant).
        l.info({ action: "pause_turn", iteration }, "pause_turn received, continuing Claude's turn");
        // Emit tool_start for server-side web search so the UI shows progress
        for (const block of response.content) {
          if (block.type === "server_tool_use" && (block as { name: string }).name === "web_search") {
            yield { type: "tool_start", tool: "web_search" };
          }
        }
        appendAssistantContent(conversationMessages, response.content);
        continue;
      }

      if ((response.stop_reason as string) === "model_context_window_exceeded") {
        l.warn(
          { action: "context_window_exceeded", iteration },
          "model_context_window_exceeded — conversation too long"
        );
        yield { type: "error", message: "The conversation is too long. Please start a new analysis." };
        return;
      }

      // Handle other stop reasons gracefully (refusal, max_tokens, etc.)
      l.warn(
        { action: "tool_loop_unexpected_stop_reason", stop_reason: response.stop_reason, iteration },
        "unexpected stop_reason, returning partial response"
      );

      // Check for analysis in partial response
      const partialReportBlock = response.content.find(
        (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
      ) as Anthropic.ToolUseBlock | undefined;

      let partialAnalysis: FoodAnalysis | undefined;
      if (partialReportBlock) {
        try {
          partialAnalysis = validateFoodAnalysis(partialReportBlock.input);
        } catch {
          // ignore
        }
      }
      if (!partialAnalysis && pendingAnalysis) {
        partialAnalysis = pendingAnalysis;
      }

      if (partialAnalysis) {
        yield { type: "analysis", analysis: partialAnalysis };
      }
      yield { type: "done" };
      return;
    }

    // Exceeded max iterations
    l.warn({ action: "tool_loop_max_iterations", iteration, durationMs: loopElapsed() }, "tool loop exceeded maximum iterations");

    if (pendingAnalysis) {
      // We have a usable analysis despite exceeding iterations — yield it and finish
      yield { type: "analysis", analysis: pendingAnalysis };
      yield { type: "done" };
    } else {
      yield { type: "error", message: "Maximum tool iterations exceeded" };
    }

  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    // Client-initiated aborts (user navigated away) — yield error event, don't throw to Sentry
    if (isAbortError(error)) {
      l.info({ action: "tool_loop_aborted" }, "tool loop aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }

    l.warn(
      { action: "tool_loop_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API tool loop error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}

/**
 * Analyze food from images/description. Returns a streaming generator of StreamEvent.
 *
 * Yields:
 * - Fast path (report_nutrition immediate): analysis + done
 * - Slow path (data tools needed): tool loop events (text_delta, tool_start, usage, analysis, done)
 * - Text only: needs_chat + done
 */
export async function* analyzeFood(
  images: ImageInput[],
  description: string | undefined,
  userId: string,
  currentDate: string,
  log?: Logger,
  signal?: AbortSignal,
  currentTime?: string,
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info(
      { action: "analyze_food_start", imageCount: images.length, hasDescription: !!description },
      "calling Claude API for food analysis"
    );

    const allTools = [WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS];
    const toolsWithCache = buildToolsWithCache(allTools);
    const systemPrompt = await getAnalysisSystemPrompt(userId, currentDate);
    const hasImages = images.length > 0;

    const userMessage: Anthropic.MessageParam = {
      role: "user",
      content: [
        ...images.map((img) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: img.base64,
          },
        })),
        {
          type: "text" as const,
          text: description || "Analyze this food.",
          // Add cache_control breakpoint on the stable description block (post-image, pre-date)
          // so the image prefix is cached. Skip for text-only requests (no images to cache).
          ...(hasImages && { cache_control: { type: "ephemeral" as const } }),
        },
        buildDateContextBlock(currentDate, currentTime),
      ],
    };

    l.debug(
      {
        action: "analyze_food_request_detail",
        systemPrompt,
        userDescription: description || "Analyze this food.",
        imageCount: images.length,
        imageMimeTypes: images.map((img) => img.mimeType),
      },
      "Claude API request detail"
    );

    // Stream text deltas from the initial response (with overload retry)
    const response = yield* createStreamWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: toolsWithCache,
      tool_choice: { type: "auto" },
      messages: [userMessage],
    }, { signal }, l);

    l.debug({ action: "analyze_food_response", ...summarizeResponse(response) }, "Claude API response received");
    l.debug(
      { action: "analyze_food_response_content", content: serializeResponseContentForLog(response) },
      "Claude API response content"
    );

    if ((response.stop_reason as string) === "model_context_window_exceeded") {
      l.warn(
        { action: "analyze_food_context_window_exceeded" },
        "model_context_window_exceeded on initial analyzeFood call"
      );
      throw new ClaudeApiError("The conversation is too long to analyze. Please start a new session.");
    }

    if (response.stop_reason === "refusal") {
      l.warn(
        { action: "analyze_food_refusal" },
        "Claude refused to analyze the food content"
      );
      throw new ClaudeApiError("The request was flagged by our safety systems and cannot be processed.");
    }

    // Check data tools first — when both report_nutrition AND data tools appear in the same
    // response, the slow path must run so all tools are executed and every tool_use in the
    // assistant turn has a matching tool_result (Anthropic API requirement).
    const dataToolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name !== "report_nutrition"
    ) as Anthropic.ToolUseBlock[];

    // Check if report_nutrition was called directly (fast path — only when NO data tools present)
    const reportNutritionBlock = response.content.find(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
    ) as Anthropic.ToolUseBlock | undefined;

    if (reportNutritionBlock && dataToolUseBlocks.length === 0 && response.stop_reason !== "pause_turn") {
      // Fast path: Claude called report_nutrition directly (no data tools in same response)
      // Record usage (fire-and-forget)
      recordUsage(userId, response.model, "food-analysis", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        l.warn(
          { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });

      const analysis = validateFoodAnalysis(reportNutritionBlock.input);
      // Fast path: no data tools called, so sourceCustomFoodId is always a hallucination — strip it
      if (analysis.sourceCustomFoodId != null) {
        l.warn(
          { action: "analyze_food_strip_source_id", sourceCustomFoodId: analysis.sourceCustomFoodId, foodName: analysis.food_name },
          "stripping hallucinated sourceCustomFoodId from fast-path analysis (no search_food_log was called)"
        );
        delete analysis.sourceCustomFoodId;
      }
      l.info(
        { action: "analyze_food_fast_path", foodName: analysis.food_name, confidence: analysis.confidence, durationMs: elapsed() },
        "food analysis completed (fast path)"
      );
      yield {
        type: "usage",
        data: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };
      yield { type: "analysis", analysis };
      yield { type: "done" };
      return;
    }

    if (dataToolUseBlocks.length > 0 || response.stop_reason === "pause_turn") {
      // Slow path: data tools were used or server-side tools paused the turn
      l.info(
        { action: "analyze_food_tool_loop", dataToolCount: dataToolUseBlocks.length, stopReason: response.stop_reason },
        "running tool loop for data tools in food analysis"
      );

      // Mirror runToolLoop: if response also contains report_nutrition alongside data tools,
      // capture the analysis and add a synthetic tool_result so every tool_use in the
      // assistant turn has a matching tool_result (Anthropic API requirement).
      const initialReportNutritionBlocks = response.content.filter(
        (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
      ) as Anthropic.ToolUseBlock[];

      let slowPathPendingAnalysis: FoodAnalysis | undefined;
      if (initialReportNutritionBlocks.length > 0) {
        try {
          slowPathPendingAnalysis = validateFoodAnalysis(initialReportNutritionBlocks[0].input);
          l.info(
            { action: "analyze_food_slow_path_report_nutrition", foodName: slowPathPendingAnalysis.food_name },
            "captured report_nutrition alongside data tools in slow path"
          );
        } catch (err) {
          l.warn(
            { action: "analyze_food_slow_path_report_nutrition_invalid", error: err instanceof Error ? err.message : String(err) },
            "invalid report_nutrition in slow path, ignoring"
          );
        }
      }

      // Yield tool_start for each data tool
      for (const tool of dataToolUseBlocks) {
        yield { type: "tool_start", tool: tool.name };
      }

      // Yield tool_start for server-side web search (pause_turn with no client-side tools)
      if (response.stop_reason === "pause_turn") {
        for (const block of response.content) {
          if (block.type === "server_tool_use" && (block as { name: string }).name === "web_search") {
            yield { type: "tool_start", tool: "web_search" };
          }
        }
      }

      // Yield usage for initial call
      yield {
        type: "usage",
        data: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };

      // Record usage (fire-and-forget)
      recordUsage(userId, response.model, "food-analysis", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        l.warn(
          { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });

      // Execute the initial data tools (may be empty for pause_turn with server-side tools only)
      const dataToolResults = await executeDataTools(dataToolUseBlocks, userId, currentDate, l);

      // Build tool results: synthetic results for any report_nutrition blocks + actual data tool results
      const allInitialToolResults = [
        ...initialReportNutritionBlocks.map((block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: "Nutrition analysis recorded.",
        })),
        ...dataToolResults,
      ];

      // Build updated conversation: original user message + initial assistant response + tool results
      const updatedMessages: Anthropic.MessageParam[] = [
        userMessage,
        { role: "assistant", content: response.content },
        ...(allInitialToolResults.length > 0 ? [{ role: "user" as const, content: allInitialToolResults }] : []),
      ];

      // Continue with the tool loop — wrap iteration to detect text-only completion
      let accumulatedText = "";
      let sawAnalysis = false;
      // Track whether search_food_log was called — only then can sourceCustomFoodId be trusted
      let sawSearchFoodLog = dataToolUseBlocks.some((b) => b.name === "search_food_log");
      const toolLoop = runToolLoop(updatedMessages, userId, currentDate, {
        systemPrompt,
        tools: allTools,
        operation: "food-analysis",
        signal,
        log: l,
        containerId: response.container?.id,
      });

      for await (const event of toolLoop) {
        if (event.type === "text_delta") {
          accumulatedText += event.text;
          yield event;
        } else if (event.type === "tool_start") {
          // Reset — prior text was intermediate thinking, not the final response
          accumulatedText = "";
          if (event.tool === "search_food_log") sawSearchFoodLog = true;
          yield event;
        } else if (event.type === "analysis") {
          // Strip sourceCustomFoodId if search_food_log was never called — Claude can't know valid IDs
          if (event.analysis.sourceCustomFoodId != null && !sawSearchFoodLog) {
            l.warn(
              { action: "analyze_food_strip_source_id", sourceCustomFoodId: event.analysis.sourceCustomFoodId, foodName: event.analysis.food_name },
              "stripping hallucinated sourceCustomFoodId from analysis (no search_food_log was called)"
            );
            delete event.analysis.sourceCustomFoodId;
          }
          sawAnalysis = true;
          yield event;
        } else if (event.type === "done") {
          // If the tool loop didn't produce analysis, fall back to analysis captured from the
          // initial response (e.g. report_nutrition + data tool in the same first response).
          if (!sawAnalysis && slowPathPendingAnalysis) {
            yield { type: "analysis", analysis: slowPathPendingAnalysis };
          } else if (!sawAnalysis && accumulatedText.trim()) {
            // If no analysis was produced and we have text, emit needs_chat
            yield { type: "needs_chat", message: accumulatedText };
          }
          yield event;
        } else {
          yield event;
        }
      }

      l.info({ action: "analyze_food_slow_path_done", durationMs: elapsed() }, "food analysis completed (via tool loop)");
      return;
    }

    // Text-only fallback: Claude responded with text, no tool calls
    // Record usage (fire-and-forget)
    recordUsage(userId, response.model, "food-analysis", {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    }).catch((error) => {
      l.warn(
        { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
        "failed to record API usage"
      );
    });

    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    ) as Anthropic.TextBlock[];
    const message = textBlocks.map((block) => block.text).join("\n");

    l.info({ action: "analyze_food_needs_chat", durationMs: elapsed() }, "food analysis needs chat transition");
    yield {
      type: "usage",
      data: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };
    yield { type: "needs_chat", message };
    yield { type: "done" };

  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    if (isAbortError(error)) {
      l.info({ action: "analyze_food_aborted" }, "food analysis aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }

    l.warn(
      { action: "analyze_food_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}

/**
 * Converts ConversationMessage[] to Anthropic.MessageParam[] with:
 * - Image blocks before text for user messages with images
 * - [Current values: ...] analysis injection for assistant messages with analysis
 */
export function convertMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

    // Attach per-message images (images before text is Anthropic best practice)
    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      content.push(
        ...msg.images.map((base64) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/jpeg" as const,
            data: base64,
          },
        }))
      );
    }

    // Add the text content (skip empty strings — tool_use-only assistant turns have no text)
    if (msg.content) {
      content.push({ type: "text" as const, text: msg.content });
    }

    // Append structured analysis summary for assistant messages with analysis
    if (msg.role === "assistant" && msg.analysis) {
      const a = msg.analysis;
      const amtLabel = getUnitLabel(a.unit_id, a.amount);
      let summary = `[Current values: food_name=${a.food_name}, amount=${amtLabel}, calories=${a.calories}, protein_g=${a.protein_g}, carbs_g=${a.carbs_g}, fat_g=${a.fat_g}, fiber_g=${a.fiber_g}, sodium_mg=${a.sodium_mg}`;
      if (a.saturated_fat_g != null) summary += `, saturated_fat_g=${a.saturated_fat_g}`;
      if (a.trans_fat_g != null) summary += `, trans_fat_g=${a.trans_fat_g}`;
      if (a.sugars_g != null) summary += `, sugars_g=${a.sugars_g}`;
      if (a.calories_from_fat != null) summary += `, calories_from_fat=${a.calories_from_fat}`;
      if (a.date != null) summary += `, date=${a.date}`;
      if (a.mealTypeId != null) summary += `, meal_type_id=${a.mealTypeId}`;
      if (a.time != null) summary += `, time=${a.time}`;
      summary += `, confidence=${a.confidence}]`;
      content.push({ type: "text" as const, text: summary });
    }

    return { role: msg.role, content };
  });
}

/**
 * Conversational food refinement. Returns a streaming generator of StreamEvent.
 *
 * Yields:
 * - text_delta: as Claude emits text
 * - analysis: if report_nutrition is called
 * - tool_start: if data tools are invoked (delegates to runToolLoop)
 * - usage: after each API call
 * - done: when the conversation turn is complete
 */
export async function* conversationalRefine(
  messages: ConversationMessage[],
  userId?: string,
  currentDate?: string,
  initialAnalysis?: FoodAnalysis,
  signal?: AbortSignal,
  log?: Logger,
  currentTime?: string,
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    const totalImages = messages.reduce((sum, m) => sum + (m.images?.length ?? 0), 0);
    l.info(
      { action: "refine_food_start", messageCount: messages.length, imageCount: totalImages },
      "calling Claude API for conversational refinement"
    );

    // Convert ConversationMessage[] to Anthropic SDK message format
    let anthropicMessages: Anthropic.MessageParam[] = convertMessages(messages);

    l.debug(
      { action: "conversational_refine_messages", messageCount: anthropicMessages.length, hasImages: totalImages > 0, hasInitialAnalysis: !!initialAnalysis },
      "conversation prepared for Claude API"
    );
    l.debug(
      { action: "conversational_refine_messages_detail", messages: serializeMessagesForLog(anthropicMessages) },
      "full conversation messages for Claude API"
    );

    // Inject date block into the leading user message (keeps system prompt stable for caching)
    if (currentDate && anthropicMessages.length > 0 && anthropicMessages[0].role === "user") {
      const firstMsg = anthropicMessages[0];
      const content = Array.isArray(firstMsg.content)
        ? [...(firstMsg.content as Anthropic.ContentBlockParam[])]
        : [];
      // Add cache_control to last stable block when first user message contains images
      const hasImagesInFirst = content.some((b) => b.type === "image");
      if (hasImagesInFirst && content.length > 0) {
        const lastIdx = content.length - 1;
        content[lastIdx] = { ...content[lastIdx], cache_control: { type: "ephemeral" as const } } as Anthropic.ContentBlockParam;
      }
      content.push(buildDateContextBlock(currentDate, currentTime));
      anthropicMessages = [{ ...firstMsg, content }, ...anthropicMessages.slice(1)];
    }

    // Build system prompt (date-free — date goes in the leading user message for cache stability)
    let systemPrompt = (userId && currentDate)
      ? await getChatSystemPrompt(userId, currentDate)
      : CHAT_SYSTEM_PROMPT;
    if (initialAnalysis) {
      const amountLabel = getUnitLabel(initialAnalysis.unit_id, initialAnalysis.amount);
      const mealTypeLabel = initialAnalysis.mealTypeId != null ? `${initialAnalysis.mealTypeId}` : "null (not set)";
      const timeLabel = initialAnalysis.time != null ? initialAnalysis.time : "null (not set)";
      systemPrompt += `\n\nThe initial analysis of this meal is:
- Food: ${initialAnalysis.food_name}
- Amount: ${amountLabel}
- Calories: ${initialAnalysis.calories}
- Protein: ${initialAnalysis.protein_g}g, Carbs: ${initialAnalysis.carbs_g}g, Fat: ${initialAnalysis.fat_g}g
- Fiber: ${initialAnalysis.fiber_g}g, Sodium: ${initialAnalysis.sodium_mg}mg
- Meal type: ${mealTypeLabel}
- Time: ${timeLabel}
- Confidence: ${initialAnalysis.confidence}
- Notes: ${initialAnalysis.notes}
Use this as the baseline. When the user makes corrections, call report_nutrition with the updated values.`;
    }

    const allTools = [WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS];
    const toolsWithCache = buildToolsWithCache(allTools);

    l.debug(
      { action: "conversational_refine_request_detail", systemPrompt },
      "Claude API chat request system prompt"
    );

    // Stream text deltas from the initial response (with overload retry)
    const response = yield* createStreamWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: toolsWithCache,
      tool_choice: { type: "auto" },
      messages: anthropicMessages,
    }, { signal }, l);

    l.debug({ action: "conversational_refine_response", ...summarizeResponse(response) }, "Claude API response received");
    l.debug(
      { action: "conversational_refine_response_content", content: serializeResponseContentForLog(response) },
      "Claude API chat response content"
    );

    if ((response.stop_reason as string) === "model_context_window_exceeded") {
      l.warn(
        { action: "conversational_refine_context_window_exceeded" },
        "model_context_window_exceeded on initial conversationalRefine call"
      );
      throw new ClaudeApiError("The conversation is too long to continue. Please start a new session.");
    }

    if (response.stop_reason === "refusal") {
      l.warn(
        { action: "conversational_refine_refusal" },
        "Claude refused the conversational refinement request"
      );
      throw new ClaudeApiError("The request was flagged by our safety systems and cannot be processed.");
    }

    // Check if Claude used any data tools (not report_nutrition)
    const dataToolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name !== "report_nutrition"
    ) as Anthropic.ToolUseBlock[];

    // If data tools were used or server-side tools paused the turn, run the tool loop
    if ((dataToolUseBlocks.length > 0 || response.stop_reason === "pause_turn") && userId && currentDate) {
      l.info(
        { action: "refine_food_tool_loop", dataToolCount: dataToolUseBlocks.length, stopReason: response.stop_reason },
        "running tool loop for data tools in conversational refinement"
      );

      // Yield tool_start for each data tool
      for (const tool of dataToolUseBlocks) {
        yield { type: "tool_start", tool: tool.name };
      }

      // Yield tool_start for server-side web search (pause_turn with no client-side tools)
      if (response.stop_reason === "pause_turn") {
        for (const block of response.content) {
          if (block.type === "server_tool_use" && (block as { name: string }).name === "web_search") {
            yield { type: "tool_start", tool: "web_search" };
          }
        }
      }

      // Yield usage for initial call
      yield {
        type: "usage",
        data: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        },
      };

      // Record usage (fire-and-forget)
      if (userId) {
        recordUsage(userId, response.model, "food-chat", {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        }).catch((error) => {
          l.warn(
            { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
            "failed to record API usage"
          );
        });
      }

      // Mirror runToolLoop: if response also contains report_nutrition alongside data tools,
      // capture the analysis and add a synthetic tool_result so every tool_use has a result.
      const initialReportNutritionBlocksRefine = response.content.filter(
        (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
      ) as Anthropic.ToolUseBlock[];

      let refineSlowPathPendingAnalysis: FoodAnalysis | undefined;
      if (initialReportNutritionBlocksRefine.length > 0) {
        try {
          refineSlowPathPendingAnalysis = validateFoodAnalysis(initialReportNutritionBlocksRefine[0].input);
          l.info(
            { action: "conversational_refine_slow_path_report_nutrition", foodName: refineSlowPathPendingAnalysis.food_name },
            "captured report_nutrition alongside data tools in conversationalRefine slow path"
          );
        } catch (err) {
          l.warn(
            { action: "conversational_refine_slow_path_report_nutrition_invalid", error: err instanceof Error ? err.message : String(err) },
            "invalid report_nutrition in conversationalRefine slow path, ignoring"
          );
        }
      }

      // Execute initial data tools (may be empty for pause_turn with server-side tools only)
      const dataToolResultsRefine = await executeDataTools(dataToolUseBlocks, userId, currentDate, l);

      // Build tool results: synthetic results for report_nutrition blocks + actual data tool results
      const allRefineInitialToolResults = [
        ...initialReportNutritionBlocksRefine.map((block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: "Nutrition analysis recorded.",
        })),
        ...dataToolResultsRefine,
      ];

      // Build updated conversation
      const updatedMessages: Anthropic.MessageParam[] = [
        ...anthropicMessages,
        { role: "assistant", content: response.content },
        ...(allRefineInitialToolResults.length > 0 ? [{ role: "user" as const, content: allRefineInitialToolResults }] : []),
      ];

      // Continue with tool loop — iterate to inject pendingAnalysis if the loop ends without one
      const refineToolLoop = runToolLoop(updatedMessages, userId, currentDate, {
        systemPrompt,
        tools: allTools,
        operation: "food-chat",
        signal,
        log: l,
        containerId: response.container?.id,
      });
      let sawRefineAnalysis = false;
      for await (const event of refineToolLoop) {
        if (event.type === "analysis") {
          sawRefineAnalysis = true;
          yield event;
        } else if (event.type === "done") {
          // Fall back to analysis captured from the initial response if the loop didn't yield one
          if (!sawRefineAnalysis && refineSlowPathPendingAnalysis) {
            yield { type: "analysis", analysis: refineSlowPathPendingAnalysis };
          }
          yield event;
        } else {
          yield event;
        }
      }

      l.info({ action: "conversational_refine_done_via_tool_loop", durationMs: elapsed() }, "conversational refinement completed via tool loop");
      return;
    } else if (dataToolUseBlocks.length > 0) {
      l.warn(
        { action: "refine_food_tool_calls_skipped", toolNames: dataToolUseBlocks.map((b) => b.name) },
        "data tool calls skipped: userId or currentDate missing from conversationalRefine"
      );
    }

    // No data tools — handle report_nutrition and/or text response
    const reportNutritionBlock = response.content.find(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
    ) as Anthropic.ToolUseBlock | undefined;

    let analysis: FoodAnalysis | undefined;
    if (reportNutritionBlock) {
      analysis = validateFoodAnalysis(reportNutritionBlock.input);
      l.info(
        { action: "conversational_refine_with_analysis", foodName: analysis.food_name, confidence: analysis.confidence, durationMs: elapsed() },
        "conversational refinement with analysis completed"
      );
    } else {
      l.info({ action: "conversational_refine_text_only", durationMs: elapsed() }, "conversational refinement completed (text only)");
    }

    // Record usage (fire-and-forget)
    if (userId) {
      recordUsage(userId, response.model, "food-chat", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        l.warn(
          { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });
    }

    yield {
      type: "usage",
      data: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };

    if (analysis) {
      yield { type: "analysis", analysis };
    }
    yield { type: "done" };

  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    if (isAbortError(error)) {
      l.info({ action: "conversational_refine_aborted" }, "conversational refinement aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }

    l.warn(
      { action: "conversational_refine_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API conversational refinement error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}


/**
 * Edit an existing food log entry via conversational AI. Returns a streaming generator of StreamEvent.
 *
 * Yields:
 * - text_delta: as Claude emits text
 * - analysis: if report_nutrition is called with corrected values
 * - tool_start: if data/search tools are invoked
 * - usage: after each API call
 * - done: when the conversation turn is complete
 */
export async function* editAnalysis(
  messages: ConversationMessage[],
  entry: FoodLogEntryDetail,
  userId: string,
  currentDate: string,
  signal?: AbortSignal,
  log?: Logger,
  initialAnalysis?: FoodAnalysis,
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info({ action: "edit_analysis_start", messageCount: messages.length }, "calling Claude API for food edit");

    // Convert messages to Anthropic format with image support and analysis injection
    let anthropicMessages: Anthropic.MessageParam[] = convertMessages(messages);

    // Build system prompt with EDIT_SYSTEM_PROMPT + entry context + date
    const amountLabel = getUnitLabel(entry.unitId, entry.amount);
    // Build system prompt (date-free — date goes in the leading user message for cache stability)
    let systemPrompt = await getEditSystemPrompt(userId, currentDate);
    const tier1Lines: string[] = [];
    if (entry.saturatedFatG != null) tier1Lines.push(`- Saturated Fat: ${entry.saturatedFatG}g`);
    if (entry.transFatG != null) tier1Lines.push(`- Trans Fat: ${entry.transFatG}g`);
    if (entry.sugarsG != null) tier1Lines.push(`- Sugars: ${entry.sugarsG}g`);
    if (entry.caloriesFromFat != null) tier1Lines.push(`- Calories from Fat: ${entry.caloriesFromFat}`);

    systemPrompt += `\n\nExisting food log entry being edited:
- Food: ${entry.foodName}
- Amount: ${amountLabel}
- Calories: ${entry.calories}
- Protein: ${entry.proteinG}g, Carbs: ${entry.carbsG}g, Fat: ${entry.fatG}g
- Fiber: ${entry.fiberG}g, Sodium: ${entry.sodiumMg}mg${tier1Lines.length > 0 ? `\n${tier1Lines.join("\n")}` : ""}
- Date: ${entry.date}${entry.time ? `, Time: ${entry.time}` : ""}
- Confidence: ${entry.confidence}${entry.notes ? `\n- Notes: ${entry.notes}` : ""}

Help the user make corrections. Call report_nutrition with the corrected values.`;

    if (initialAnalysis) {
      const initAmtLabel = getUnitLabel(initialAnalysis.unit_id, initialAnalysis.amount);
      const editMealTypeLabel = initialAnalysis.mealTypeId != null ? `${initialAnalysis.mealTypeId}` : "null (not set)";
      const editTimeLabel = initialAnalysis.time != null ? initialAnalysis.time : "null (not set)";
      systemPrompt += `\n\nThe current analysis being refined is:
- Food: ${initialAnalysis.food_name}
- Amount: ${initAmtLabel}
- Calories: ${initialAnalysis.calories}
- Protein: ${initialAnalysis.protein_g}g, Carbs: ${initialAnalysis.carbs_g}g, Fat: ${initialAnalysis.fat_g}g
- Fiber: ${initialAnalysis.fiber_g}g, Sodium: ${initialAnalysis.sodium_mg}mg
- Meal type: ${editMealTypeLabel}
- Time: ${editTimeLabel}
- Confidence: ${initialAnalysis.confidence}
- Notes: ${initialAnalysis.notes}
Use this as the baseline. When the user makes corrections, call report_nutrition with the updated values.`;
    }

    // Inject date block into the leading user message (keeps system prompt stable for caching)
    if (anthropicMessages.length > 0 && anthropicMessages[0].role === "user") {
      const firstMsg = anthropicMessages[0];
      const content = Array.isArray(firstMsg.content)
        ? [...(firstMsg.content as Anthropic.ContentBlockParam[])]
        : [];
      // Add cache_control to last stable block when first user message contains images
      const hasImagesInFirst = content.some((b) => b.type === "image");
      if (hasImagesInFirst && content.length > 0) {
        const lastIdx = content.length - 1;
        content[lastIdx] = { ...content[lastIdx], cache_control: { type: "ephemeral" as const } } as Anthropic.ContentBlockParam;
      }
      content.push(buildDateContextBlock(currentDate));
      anthropicMessages = [{ ...firstMsg, content }, ...anthropicMessages.slice(1)];
    }

    const allTools = [WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS];

    yield* runToolLoop(anthropicMessages, userId, currentDate, {
      systemPrompt,
      tools: allTools,
      operation: "food-edit",
      signal,
      log: l,
    });

    l.info({ action: "edit_analysis_done", durationMs: elapsed() }, "food edit analysis completed");
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }
    if (isAbortError(error)) {
      l.info({ action: "edit_analysis_aborted" }, "food edit analysis aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }
    l.warn(
      { action: "edit_analysis_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API edit analysis error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}

// ─── Triage: Multi-capture session analysis ────────────────────────────────


/**
 * Validate an array of items from report_session_items tool output.
 * Reuses validateFoodAnalysis() for each item, filtering out invalid ones.
 * Strips capture_indices (UI-only, not part of FoodAnalysis).
 */
export function validateSessionItems(input: unknown): FoodAnalysis[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const results: FoodAnalysis[] = [];
  for (const item of input) {
    try {
      const analysis = validateFoodAnalysis(item);
      results.push(analysis);
    } catch {
      logger.warn({ action: "validate_session_item_skip", item }, "skipping invalid session item");
    }
  }
  return results;
}

/**
 * Build an Anthropic user message for triage: all images grouped by capture with context text.
 */
function buildTriageUserMessage(
  images: ImageInput[],
  captureMetadata: { captureId: string; imageIndices: number[]; note: string | null; capturedAt: string }[],
): Anthropic.MessageParam {
  const contentBlocks: Anthropic.ContentBlockParam[] = [];

  // Add all image blocks grouped by capture, with a text label before each capture
  for (let i = 0; i < captureMetadata.length; i++) {
    const capture = captureMetadata[i];
    const captureImages = capture.imageIndices.map((idx) => images[idx]).filter(Boolean);

    // Text label for the capture
    const noteText = capture.note ? ` — Note: "${capture.note}"` : "";
    contentBlocks.push({
      type: "text" as const,
      text: `[Capture ${i + 1} — ${capture.capturedAt}${noteText}]`,
    });

    // Image blocks for this capture
    for (const img of captureImages) {
      contentBlocks.push({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: img.base64,
        },
      });
    }
  }

  contentBlocks.push({
    type: "text" as const,
    text: "Please identify all distinct food items across these captures and call report_session_items with the complete list.",
  });

  return { role: "user", content: contentBlocks };
}

/**
 * Analyze a collection of food captures to identify all distinct items.
 * Streams session_items event when report_session_items is called.
 */
export async function* triageCaptures(
  images: ImageInput[],
  captureMetadata: { captureId: string; imageIndices: number[]; note: string | null; capturedAt: string }[],
  userId: string,
  currentDate: string,
  log?: Logger,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info(
      { action: "triage_captures_start", imageCount: images.length, captureCount: captureMetadata.length },
      "calling Claude API for session triage"
    );

    // System prompt is date-free for cache stability; date block goes in user message
    const systemPrompt = TRIAGE_SYSTEM_PROMPT;
    const toolsWithCache = buildToolsWithCache([REPORT_SESSION_ITEMS_TOOL]);
    const baseUserMessage = buildTriageUserMessage(images, captureMetadata);
    // Append date as trailing block (after all capture content)
    const userMessageContent = [
      ...(baseUserMessage.content as Anthropic.ContentBlockParam[]),
      buildDateContextBlock(currentDate),
    ];
    const userMessage: Anthropic.MessageParam = { role: "user", content: userMessageContent };

    l.debug(
      { action: "triage_captures_request", captureCount: captureMetadata.length, imageCount: images.length },
      "Claude API triage request"
    );

    const response = yield* createStreamWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: toolsWithCache,
      tool_choice: { type: "auto" },
      messages: [userMessage],
    }, { signal }, l);

    l.debug({ action: "triage_captures_response", ...summarizeResponse(response) }, "Claude API triage response received");

    // Yield usage
    yield {
      type: "usage",
      data: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };

    // Record usage (fire-and-forget)
    recordUsage(userId, response.model, "triage-captures", {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    }).catch((error) => {
      l.warn(
        { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
        "failed to record API usage"
      );
    });

    // Check for error stop_reasons
    if ((response.stop_reason as string) === "model_context_window_exceeded") {
      l.warn({ action: "triage_captures_context_window_exceeded" }, "model_context_window_exceeded on triageCaptures");
      yield { type: "error", message: "The request exceeded the context window. Please try with fewer captures." };
      return;
    }
    if (response.stop_reason === "refusal") {
      l.warn({ action: "triage_captures_refusal" }, "Claude refused to process the captures");
      yield { type: "error", message: "The request was flagged by our safety systems and cannot be processed." };
      return;
    }
    if (response.stop_reason === "max_tokens") {
      l.warn({ action: "triage_captures_max_tokens" }, "max_tokens on triageCaptures");
      yield { type: "error", message: "The response exceeded the maximum length. Please try with fewer captures." };
      return;
    }

    // Find report_session_items tool call
    const reportBlock = response.content.find(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_session_items"
    ) as Anthropic.ToolUseBlock | undefined;

    if (reportBlock) {
      const input = reportBlock.input as { items?: unknown };
      const items = validateSessionItems(input.items);
      l.info(
        { action: "triage_captures_result", itemCount: items.length, durationMs: elapsed() },
        "triage captures completed"
      );
      yield { type: "session_items", items };
    } else {
      l.warn({ action: "triage_captures_no_tool_call", stopReason: response.stop_reason }, "Claude did not call report_session_items");
      yield { type: "session_items", items: [] };
    }

    yield { type: "done" };

  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }
    if (isAbortError(error)) {
      l.info({ action: "triage_captures_aborted" }, "triage captures aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }
    l.warn(
      { action: "triage_captures_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API triage captures error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}

/**
 * Convert ConversationMessage[] to Anthropic messages for triage refinement.
 * For assistant messages with sessionItems, appends a structured item summary.
 */
function convertTriageMessages(messages: ConversationMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

    if (msg.role === "user" && msg.images && msg.images.length > 0) {
      content.push(
        ...msg.images.map((base64) => ({
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: "image/jpeg" as const,
            data: base64,
          },
        }))
      );
    }

    if (msg.content) {
      content.push({ type: "text" as const, text: msg.content });
    }

    // For assistant messages with sessionItems, inject structured item summary
    if (msg.role === "assistant" && msg.sessionItems && msg.sessionItems.length > 0) {
      const itemLines = msg.sessionItems.map((item, i) => {
        const mealLabel = item.mealTypeId != null ? (MEAL_TYPE_LABELS[item.mealTypeId] ?? `type ${item.mealTypeId}`) : "unset";
        return `  ${i + 1}. ${item.food_name} — ${item.calories} cal, ${item.amount} ${item.unit_id}, meal: ${mealLabel}, time: ${item.time ?? "unset"}`;
      });
      const summary = `[Current session items:\n${itemLines.join("\n")}\n]`;
      content.push({ type: "text" as const, text: summary });
    }

    return { role: msg.role, content };
  });
}

/**
 * Conversational triage refinement. Allows the user to modify the list of session items.
 * Streams session_items event when report_session_items is called.
 */
export async function* triageRefine(
  messages: ConversationMessage[],
  userId: string,
  initialItems?: FoodAnalysis[],
  signal?: AbortSignal,
  log?: Logger,
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info(
      { action: "triage_refine_start", messageCount: messages.length, initialItemCount: initialItems?.length ?? 0 },
      "calling Claude API for triage refinement"
    );

    const anthropicMessages = convertTriageMessages(messages);

    let systemPrompt = TRIAGE_SYSTEM_PROMPT;

    // Inject initial items as baseline context in the system prompt
    if (initialItems && initialItems.length > 0) {
      const itemLines = initialItems.map((item, i) => {
        const mealLabel = item.mealTypeId != null ? (MEAL_TYPE_LABELS[item.mealTypeId] ?? `type ${item.mealTypeId}`) : "unset";
        return `  ${i + 1}. ${item.food_name} — ${item.calories} cal, time: ${item.time ?? "unset"}, meal: ${mealLabel}`;
      });
      systemPrompt += `\n\nCurrent session items baseline:\n${itemLines.join("\n")}\n\nWhen the user requests changes, call report_session_items with the updated complete list.`;
    }

    const toolsWithCache = buildToolsWithCache([REPORT_SESSION_ITEMS_TOOL]);

    const response = yield* createStreamWithRetry({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system: [
        {
          type: "text" as const,
          text: systemPrompt,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: toolsWithCache,
      tool_choice: { type: "auto" },
      messages: anthropicMessages,
    }, { signal }, l);

    l.debug({ action: "triage_refine_response", ...summarizeResponse(response) }, "Claude API triage refine response received");

    // Yield usage
    yield {
      type: "usage",
      data: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
    };

    // Record usage (fire-and-forget)
    recordUsage(userId, response.model, "triage-refine", {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    }).catch((error) => {
      l.warn(
        { action: "record_usage_failed", error: error instanceof Error ? error.message : String(error), userId },
        "failed to record API usage"
      );
    });

    // Check for error stop_reasons
    if ((response.stop_reason as string) === "model_context_window_exceeded") {
      l.warn({ action: "triage_refine_context_window_exceeded" }, "model_context_window_exceeded on triageRefine");
      yield { type: "error", message: "The conversation is too long to process. Please start a new session." };
      return;
    }
    if (response.stop_reason === "refusal") {
      l.warn({ action: "triage_refine_refusal" }, "Claude refused to process the triage request");
      yield { type: "error", message: "The request was flagged by our safety systems and cannot be processed." };
      return;
    }
    if (response.stop_reason === "max_tokens") {
      l.warn({ action: "triage_refine_max_tokens" }, "max_tokens on triageRefine");
      yield { type: "error", message: "The response exceeded the maximum length. Please try again." };
      return;
    }

    // Find report_session_items tool call
    const reportBlock = response.content.find(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_session_items"
    ) as Anthropic.ToolUseBlock | undefined;

    if (reportBlock) {
      const input = reportBlock.input as { items?: unknown };
      const items = validateSessionItems(input.items);
      l.info(
        { action: "triage_refine_result", itemCount: items.length, durationMs: elapsed() },
        "triage refinement completed with items"
      );
      yield { type: "session_items", items };
    } else {
      l.info({ action: "triage_refine_text_only", durationMs: elapsed() }, "triage refinement completed (text only)");
    }

    yield { type: "done" };

  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }
    if (isAbortError(error)) {
      l.info({ action: "triage_refine_aborted" }, "triage refinement aborted by client");
      yield { type: "error", message: "Request aborted by client" };
      return;
    }
    l.warn(
      { action: "triage_refine_error", error: error instanceof Error ? error.message : String(error) },
      "Claude API triage refine error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`,
      extractRequestId(error)
    );
  }
}
