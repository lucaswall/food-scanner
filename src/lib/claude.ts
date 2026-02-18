import Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis, ConversationMessage } from "@/types";
import { getUnitLabel } from "@/types";
import { logger, startTimer } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { recordUsage } from "@/lib/claude-usage";
import { executeTool, SEARCH_FOOD_LOG_TOOL, GET_NUTRITION_SUMMARY_TOOL, GET_FASTING_INFO_TOOL } from "@/lib/chat-tools";
import type { StreamEvent } from "@/lib/sse";

export const CLAUDE_MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
      timeout: 60000, // 60 second timeout — accommodates web search latency
      maxRetries: 2,
    });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a nutrition analyst specializing in Argentine and Latin American cuisine.
Analyze food images and descriptions to provide accurate nutritional information.
Consider typical Argentine portions and preparation methods.
Choose the most natural measurement unit for each food (e.g., cups for beverages, grams for solid food, slices for pizza/bread).
Always estimate Tier 1 nutrients (saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat) when possible. Use null only when truly unknown.`;

const THINKING_INSTRUCTION = `Before calling any tool, emit a brief natural-language sentence describing what you're about to do (e.g., 'Let me check your food history...', 'Looking up nutrition info for this restaurant...', 'Checking your fasting patterns...'). This gives the user real-time feedback. Keep it to one short sentence per tool batch.`;

export const CHAT_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

You are a friendly nutrition advisor having a conversational interaction with the user. You have access to their food log, nutrition summaries, goals, and fasting data through the available tools.

You can help with:
- Analyzing food from descriptions or images and reporting nutrition information
- Refining existing food analyses when the user provides corrections
- Answering questions about what they've eaten (today, this week, any date)
- Checking progress against calorie and macro goals
- Suggesting meals based on their eating patterns and remaining goals
- Analyzing fasting patterns
- Providing general nutrition advice with their personal context

Follow these rules:
- When the user describes or shows food (with or without images), analyze it and call report_nutrition with complete nutritional information
- When refining an existing analysis, confirm changes with an updated summary of the meal
- Don't repeat information that hasn't changed — only mention what was updated
- When new photos are provided, they add to the existing meal unless the user explicitly says otherwise
- Corrections from the user override previous values
- When the user asks questions about their eating habits, nutrition, or goals, use the data tools (search_food_log, get_nutrition_summary, get_fasting_info) to look up their actual data before responding
- Base your answers on real data from the tools, not assumptions
- If the user's intent is ambiguous, ask clarifying questions before updating the analysis
- Be concise and conversational in your responses
- Use specific numbers from their data when available
- When suggesting meals, consider their typical eating patterns and current goal progress
- CRITICAL: Food is ONLY registered/logged when you call report_nutrition. Never say food is "registered", "logged", or "recorded" unless you have called report_nutrition in that same response. If report_nutrition was not called, the food has NOT been logged — do not claim otherwise.
- When the user references food from their history (via search_food_log results or past entries) and wants to log it again (e.g., "comí eso", "registra eso", "quiero lo mismo", "comí dos"), call report_nutrition immediately with the nutritional data from the history lookup. Do not ask for unnecessary confirmation — the user's intent to log is clear.
- Never ask which meal type before calling report_nutrition. The meal type is not a parameter of report_nutrition — meal assignment is handled by the user in the app UI after logging.
- When reporting food that came directly from search_food_log results without modification, set source_custom_food_id to the [id:N] value from the search result. When modifying nutrition values (half portion, different ingredients, different amount), set source_custom_food_id to null.
- ${THINKING_INSTRUCTION}

Web search guidelines:
- You have access to web search. Use it to look up nutrition info for specific restaurants, branded products, packaged foods with known labels, and unfamiliar regional dishes.
- Do NOT search for generic or common foods like "an apple", "grilled chicken with rice", or "scrambled eggs" — estimate those from your training data.
- When you use web search results, cite the source — mention where the nutrition info came from (e.g., "Based on McDonald's nutrition page...").
- If web search returns nothing useful, fall back to estimation from your training data and say so.`;

const BETA_HEADER = "code-execution-web-tools-2026-02-09";

export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
} as const;

export const REPORT_NUTRITION_TOOL: Anthropic.Tool = {
  name: "report_nutrition",
  description:
    "Report the nutritional analysis of the food shown in the images",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false as const,
    properties: {
      food_name: {
        type: "string",
        description: "Clear name of the food in Spanish or English",
      },
      amount: {
        type: "number",
        description: "Estimated quantity in the chosen unit (e.g., 150 for grams, 1 for cup, 2 for slices)",
      },
      unit_id: {
        type: "number",
        description: "Fitbit measurement unit ID. Use: 147=gram, 91=cup, 226=oz, 349=tbsp, 364=tsp, 209=ml, 311=slice, 304=serving. Choose the most natural unit for the food (e.g., cups for beverages, grams for solid food, slices for pizza/bread, serving for individual items).",
      },
      calories: { type: "number" },
      protein_g: { type: "number" },
      carbs_g: { type: "number" },
      fat_g: { type: "number" },
      fiber_g: { type: "number" },
      sodium_mg: { type: "number" },
      saturated_fat_g: {
        type: ["number", "null"],
        description: "Estimated saturated fat in grams. Provide your best estimate; use null only if truly unknown.",
      },
      trans_fat_g: {
        type: ["number", "null"],
        description: "Estimated trans fat in grams. Provide your best estimate; use null only if truly unknown.",
      },
      sugars_g: {
        type: ["number", "null"],
        description: "Estimated sugars in grams. Provide your best estimate; use null only if truly unknown.",
      },
      calories_from_fat: {
        type: ["number", "null"],
        description: "Estimated calories from fat. Provide your best estimate; use null only if truly unknown.",
      },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: {
        type: "string",
        description: "Brief explanation of assumptions made",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "3 to 5 lowercase single-word tokens (no spaces) identifying this food for matching against previously logged foods. Priority order: (1) food type (e.g., cerveza, pizza, ensalada), (2) key modifiers that affect nutrition (e.g., integral, descremado, light), (3) main ingredients not implied by food type (e.g., jamon, queso), (4) preparation method if nutritionally relevant (e.g., frito, hervido). For compound concepts use hyphens: sin-alcohol, sin-tacc. Use singular form. Exclude: brand names, packaging (lata, botella), country of origin, marketing terms (original, clasico). Example: 'Clausthaler Original cerveza sin alcohol en lata' → ['cerveza', 'sin-alcohol']. Example: 'Pizza de jamón y muzzarella' → ['pizza', 'jamon', 'muzzarella'].",
      },
      description: {
        type: "string",
        description: "Describe the food only in 1-2 concise sentences to distinguish this food from similar items. Include: visible ingredients, preparation/cooking method, portion size, and distinguishing visual characteristics (colors, textures). Do not describe hands, containers, plates, backgrounds, table settings, or other non-food elements.",
      },
      source_custom_food_id: {
        type: ["number", "null"],
        description: "ID of an existing custom food from search_food_log results. Set to the [id:N] value when reusing a food exactly as-is (same portion, same nutrition). Set to null when creating new food or when modifying nutrition values (e.g. half portion, different ingredients).",
      },
    },
    required: [
      "food_name",
      "amount",
      "unit_id",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
      "sodium_mg",
      "saturated_fat_g",
      "trans_fat_g",
      "sugars_g",
      "calories_from_fat",
      "confidence",
      "notes",
      "keywords",
      "description",
      "source_custom_food_id",
    ],
  },
};

export interface ImageInput {
  base64: string;
  mimeType: string;
}

class ClaudeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CLAUDE_API_ERROR";
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
    "amount", "unit_id", "calories", "protein_g",
    "carbs_g", "fat_g", "fiber_g", "sodium_mg",
  ] as const;

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
  if (!validConfidence.includes(data.confidence as string)) {
    throw new ClaudeApiError("Invalid food analysis: confidence must be high, medium, or low");
  }

  if (typeof data.notes !== "string") {
    throw new ClaudeApiError("Invalid food analysis: missing notes");
  }

  if (!Array.isArray(data.keywords)) {
    throw new ClaudeApiError("Invalid food analysis: keywords must be an array");
  }
  if (data.keywords.length === 0) {
    throw new ClaudeApiError("Invalid food analysis: keywords must have at least 1 element");
  }
  if (!data.keywords.every((k: unknown) => typeof k === "string")) {
    throw new ClaudeApiError("Invalid food analysis: all keywords must be strings");
  }

  const keywords = normalizeKeywords(data.keywords as string[]);
  if (keywords.length === 0) {
    throw new ClaudeApiError("Invalid food analysis: keywords must have at least 1 element");
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

  const result: FoodAnalysis = {
    food_name: data.food_name as string,
    amount: data.amount as number,
    unit_id: data.unit_id as number,
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
    confidence: data.confidence as FoodAnalysis["confidence"],
    notes: data.notes as string,
    keywords,
    description,
  };

  if (sourceCustomFoodId !== undefined) {
    result.sourceCustomFoodId = sourceCustomFoodId;
  }

  return result;
}

export const ANALYSIS_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

You have access to the user's food log, nutrition summaries, and fasting data through the available tools.

Follow these rules:
- For clearly described or photographed foods (e.g., "grilled chicken with rice", a photo of a salad), call report_nutrition immediately with complete nutritional information
- When the user references past meals, history, or goals (e.g., "same as yesterday", "half of what I had Monday"), use the data tools (search_food_log, get_nutrition_summary, get_fasting_info) to look up their actual data
- If the request is ambiguous and needs clarification, respond with text to ask the user
- Base your answers on real data from the tools, not assumptions
- CRITICAL: Food is ONLY registered/logged when you call report_nutrition. Never claim food is "registered", "logged", or "recorded" unless you have called report_nutrition in that same response.
- When reporting food that came directly from search_food_log results without modification, set source_custom_food_id to the [id:N] value from the search result. When modifying nutrition values, set source_custom_food_id to null.
- ${THINKING_INSTRUCTION}

Web search guidelines:
- You have access to web search. Use it to look up nutrition info for specific restaurants, branded products, packaged foods with known labels, and unfamiliar regional dishes.
- Do NOT search for generic or common foods like "an apple", "grilled chicken with rice", or "scrambled eggs" — estimate those from your training data.
- When you use web search results, cite the source — mention where the nutrition info came from (e.g., "Based on McDonald's nutrition page...").
- If web search returns nothing useful, fall back to estimation from your training data and say so.`;

const DATA_TOOLS = [
  SEARCH_FOOD_LOG_TOOL,
  GET_NUTRITION_SUMMARY_TOOL,
  GET_FASTING_INFO_TOOL,
];

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

function estimateTokenCount(messages: Anthropic.MessageParam[]): number {
  let tokens = 0;

  for (const message of messages) {
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === "text") {
          // ~4 characters per token
          tokens += Math.ceil(block.text.length / 4);
        } else if (block.type === "image") {
          // ~1000 tokens per image
          tokens += 1000;
        } else if (block.type === "tool_use") {
          const toolBlock = block as Anthropic.ToolUseBlock;
          const inputStr = JSON.stringify(toolBlock.input);
          tokens += Math.ceil((toolBlock.name.length + inputStr.length) / 4);
        } else if (block.type === "tool_result") {
          const resultBlock = block as Anthropic.ToolResultBlockParam;
          if (typeof resultBlock.content === "string") {
            tokens += Math.ceil(resultBlock.content.length / 4);
          } else if (Array.isArray(resultBlock.content)) {
            for (const part of resultBlock.content) {
              if (part.type === "text") {
                tokens += Math.ceil(part.text.length / 4);
              }
            }
          }
        } else if (block.type === "server_tool_use") {
          // Server-side tools (web_search, bash_code_execution, etc.)
          const serverBlock = block as { type: string; name: string; input?: unknown };
          const inputStr = serverBlock.input ? JSON.stringify(serverBlock.input) : "";
          tokens += Math.ceil((serverBlock.name.length + inputStr.length) / 4);
        } else if (
          block.type === "web_search_tool_result" ||
          block.type === "bash_code_execution_tool_result" ||
          block.type === "text_editor_code_execution_tool_result"
        ) {
          // Server-side tool results — estimate ~500 tokens each
          tokens += 500;
        }
      }
    } else if (typeof message.content === "string") {
      tokens += Math.ceil(message.content.length / 4);
    }
  }

  return tokens;
}

export function truncateConversation(
  messages: Anthropic.MessageParam[],
  maxTokens: number,
  log?: Logger,
): Anthropic.MessageParam[] {
  const l = log ?? logger;
  const estimatedTokens = estimateTokenCount(messages);

  if (estimatedTokens <= maxTokens) {
    return messages;
  }

  // Keep first user message + last 4 messages
  if (messages.length <= 5) {
    return messages;
  }

  const firstMessage = messages[0];
  const lastFourMessages = messages.slice(-4);

  const result = [firstMessage, ...lastFourMessages];

  // Remove consecutive same-role messages (keep the later one)
  const filtered: Anthropic.MessageParam[] = [result[0]];
  for (let i = 1; i < result.length; i++) {
    if (result[i].role === filtered[filtered.length - 1].role) {
      // Drop the earlier one (replace it with the current one)
      filtered[filtered.length - 1] = result[i];
    } else {
      filtered.push(result[i]);
    }
  }

  l.debug(
    { action: "truncate_conversation", estimatedTokens, maxTokens, messagesBefore: messages.length, messagesAfter: filtered.length },
    "conversation truncated"
  );

  return filtered;
}

/**
 * Stream text deltas from a MessageStream, yielding StreamEvent for each delta.
 * Returns the complete final message after the stream is exhausted.
 */
async function* streamTextDeltas(
  stream: { [Symbol.asyncIterator](): AsyncIterator<unknown>; finalMessage(): Promise<Anthropic.Message | Anthropic.Beta.Messages.BetaMessage> },
): AsyncGenerator<StreamEvent, Anthropic.Message> {
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
  }
  return await stream.finalMessage() as Anthropic.Message;
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
          { tool: toolUse.name, error: error instanceof Error ? error.message : String(error) },
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
  }
): AsyncGenerator<StreamEvent> {
  const l = options?.log ?? logger;
  const loopElapsed = startTimer();
  let systemPrompt = options?.systemPrompt ?? CHAT_SYSTEM_PROMPT;
  if (!options?.systemPrompt && currentDate) {
    systemPrompt += `\n\nToday's date is: ${currentDate}`;
  }
  const tools = options?.tools ?? [WEB_SEARCH_TOOL, ...DATA_TOOLS];
  const operation = options?.operation ?? "food-chat";
  const maxTokens = options?.maxTokens ?? 2048;
  const toolsWithCache = buildToolsWithCache(tools);

  const conversationMessages: Anthropic.MessageParam[] = [...messages];
  const MAX_ITERATIONS = 5;
  let iteration = 0;
  let pendingAnalysis: FoodAnalysis | undefined;

  try {
    while (iteration < MAX_ITERATIONS) {
      if (options?.signal?.aborted) {
        yield { type: "error", message: "Request aborted by client" };
        return;
      }
      iteration++;

      l.info(
        { iteration, messageCount: conversationMessages.length },
        "calling Claude API in tool loop"
      );
      l.debug(
        { action: "tool_loop_request_detail", iteration, messages: serializeMessagesForLog(conversationMessages) },
        "tool loop full conversation state"
      );

      const iterElapsed = startTimer();
      const stream = getClient().beta.messages.stream({
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        betas: [BETA_HEADER],
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
      }, { signal: options?.signal });

      // Stream text deltas in real time
      const response = yield* streamTextDeltas(stream);

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
            { error: error instanceof Error ? error.message : String(error), userId },
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
          analysis = validateFoodAnalysis(reportNutritionBlock.input);
        }

        // Use pending analysis from earlier iteration if no analysis in final response
        if (!analysis && pendingAnalysis) {
          analysis = pendingAnalysis;
        }

        if (analysis) {
          yield { type: "analysis", analysis };
        }

        l.info({ iteration, hasAnalysis: !!analysis, exitReason: "end_turn", durationMs: loopElapsed() }, "tool loop completed");
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
        const reportNutritionBlock = allToolUseBlocks.find(
          (block) => block.name === "report_nutrition"
        );
        const dataToolBlocks = allToolUseBlocks.filter(
          (block) => block.name !== "report_nutrition"
        );

        // Yield tool_start for data tools
        for (const tool of dataToolBlocks) {
          yield { type: "tool_start", tool: tool.name };
        }

        // If report_nutrition is present, validate and store as pending analysis
        if (reportNutritionBlock) {
          try {
            pendingAnalysis = validateFoodAnalysis(reportNutritionBlock.input);
            l.info(
              { foodName: pendingAnalysis.food_name },
              "captured report_nutrition from tool loop"
            );
          } catch (error) {
            l.warn(
              { error: error instanceof Error ? error.message : String(error) },
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

        // Add assistant message with tool_use blocks
        conversationMessages.push({
          role: "assistant",
          content: response.content,
        });

        // Build tool results
        const toolResults: Array<{
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error?: true;
        }> = [];

        // Add synthetic result for report_nutrition so Claude doesn't think it failed
        if (reportNutritionBlock) {
          toolResults.push({
            type: "tool_result" as const,
            tool_use_id: reportNutritionBlock.id,
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
        // Send the response back as-is so Claude can continue.
        l.info({ iteration }, "pause_turn received, continuing Claude's turn");
        conversationMessages.push({
          role: "assistant",
          content: response.content,
        });
        continue;
      }

      // Handle other stop reasons gracefully (refusal, max_tokens, etc.)
      l.warn(
        { stop_reason: response.stop_reason, iteration },
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
    l.warn({ iteration, durationMs: loopElapsed() }, "tool loop exceeded maximum iterations");

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

    l.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API tool loop error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
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
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info(
      { imageCount: images.length, hasDescription: !!description },
      "calling Claude API for food analysis"
    );

    const allTools = [WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS];
    const toolsWithCache = buildToolsWithCache(allTools);
    const systemPrompt = `${ANALYSIS_SYSTEM_PROMPT}\n\nToday's date is: ${currentDate}`;

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
        },
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

    const stream = getClient().beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      betas: [BETA_HEADER],
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
    }, { signal });

    // Stream text deltas from the initial response
    const response = yield* streamTextDeltas(stream);

    l.debug({ action: "analyze_food_response", ...summarizeResponse(response) }, "Claude API response received");
    l.debug(
      { action: "analyze_food_response_content", content: serializeResponseContentForLog(response) },
      "Claude API response content"
    );

    // Check if report_nutrition was called directly (fast path)
    const reportNutritionBlock = response.content.find(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name === "report_nutrition"
    ) as Anthropic.ToolUseBlock | undefined;

    if (reportNutritionBlock) {
      // Fast path: Claude called report_nutrition directly
      // Record usage (fire-and-forget)
      recordUsage(userId, response.model, "food-analysis", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        l.warn(
          { error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });

      const analysis = validateFoodAnalysis(reportNutritionBlock.input);
      l.info(
        { foodName: analysis.food_name, confidence: analysis.confidence, durationMs: elapsed() },
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

    // Check if Claude used any data tools (not report_nutrition)
    const dataToolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name !== "report_nutrition"
    ) as Anthropic.ToolUseBlock[];

    if (dataToolUseBlocks.length > 0) {
      // Slow path: data tools were used in the initial response
      l.info(
        { dataToolCount: dataToolUseBlocks.length },
        "running tool loop for data tools in food analysis"
      );

      // Yield tool_start for each data tool
      for (const tool of dataToolUseBlocks) {
        yield { type: "tool_start", tool: tool.name };
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
          { error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });

      // Execute the initial data tools
      const toolResults = await executeDataTools(dataToolUseBlocks, userId, currentDate, l);

      // Build updated conversation: original user message + initial assistant response + tool results
      const updatedMessages: Anthropic.MessageParam[] = [
        userMessage,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];

      // Continue with the tool loop — wrap iteration to detect text-only completion
      let accumulatedText = "";
      let sawAnalysis = false;
      const toolLoop = runToolLoop(updatedMessages, userId, currentDate, {
        systemPrompt,
        tools: allTools,
        operation: "food-analysis",
        signal,
        log: l,
      });

      for await (const event of toolLoop) {
        if (event.type === "text_delta") {
          accumulatedText += event.text;
          yield event;
        } else if (event.type === "tool_start") {
          // Reset — prior text was intermediate thinking, not the final response
          accumulatedText = "";
          yield event;
        } else if (event.type === "analysis") {
          sawAnalysis = true;
          yield event;
        } else if (event.type === "done") {
          // If no analysis was produced and we have text, emit needs_chat
          if (!sawAnalysis && accumulatedText.trim()) {
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
        { error: error instanceof Error ? error.message : String(error), userId },
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

    l.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
  images: ImageInput[],
  userId?: string,
  currentDate?: string,
  initialAnalysis?: FoodAnalysis,
  signal?: AbortSignal,
  log?: Logger
): AsyncGenerator<StreamEvent> {
  const l = log ?? logger;
  const elapsed = startTimer();
  try {
    l.info(
      { messageCount: messages.length, imageCount: images.length },
      "calling Claude API for conversational refinement"
    );

    // Find the index of the last user message to attach images
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    // Convert ConversationMessage[] to Anthropic SDK message format
    let anthropicMessages: Anthropic.MessageParam[] = messages.map((msg, index) => {
      const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];

      // Attach images to the last user message
      if (msg.role === "user" && index === lastUserIndex && images.length > 0) {
        content.push(
          ...images.map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: img.mimeType as
                | "image/jpeg"
                | "image/png"
                | "image/gif"
                | "image/webp",
              data: img.base64,
            },
          }))
        );
      }

      // Add the text content
      content.push({
        type: "text" as const,
        text: msg.content,
      });

      // Append structured analysis summary for assistant messages with analysis
      if (msg.role === "assistant" && msg.analysis) {
        const a = msg.analysis;
        const amtLabel = getUnitLabel(a.unit_id, a.amount);
        let summary = `[Current values: food_name=${a.food_name}, amount=${amtLabel}, calories=${a.calories}, protein_g=${a.protein_g}, carbs_g=${a.carbs_g}, fat_g=${a.fat_g}, fiber_g=${a.fiber_g}, sodium_mg=${a.sodium_mg}`;
        // Include Tier 1 nutrients only if present
        if (a.saturated_fat_g != null) summary += `, saturated_fat_g=${a.saturated_fat_g}`;
        if (a.trans_fat_g != null) summary += `, trans_fat_g=${a.trans_fat_g}`;
        if (a.sugars_g != null) summary += `, sugars_g=${a.sugars_g}`;
        if (a.calories_from_fat != null) summary += `, calories_from_fat=${a.calories_from_fat}`;
        summary += `, confidence=${a.confidence}]`;
        content.push({
          type: "text" as const,
          text: summary,
        });
      }

      return {
        role: msg.role,
        content,
      };
    });

    // Truncate conversation if needed (150K tokens threshold)
    const preCount = anthropicMessages.length;
    anthropicMessages = truncateConversation(anthropicMessages, 150000, l);
    l.debug(
      { action: "conversational_refine_messages", messageCount: anthropicMessages.length, truncated: anthropicMessages.length < preCount, hasImages: images.length > 0, hasInitialAnalysis: !!initialAnalysis },
      "conversation prepared for Claude API"
    );
    l.debug(
      { action: "conversational_refine_messages_detail", messages: serializeMessagesForLog(anthropicMessages) },
      "full conversation messages for Claude API"
    );

    // Build system prompt with date and initial analysis context
    let systemPrompt = CHAT_SYSTEM_PROMPT;
    if (currentDate) {
      systemPrompt += `\n\nToday's date is: ${currentDate}`;
    }
    if (initialAnalysis) {
      const amountLabel = getUnitLabel(initialAnalysis.unit_id, initialAnalysis.amount);
      systemPrompt += `\n\nThe initial analysis of this meal is:
- Food: ${initialAnalysis.food_name}
- Amount: ${amountLabel}
- Calories: ${initialAnalysis.calories}
- Protein: ${initialAnalysis.protein_g}g, Carbs: ${initialAnalysis.carbs_g}g, Fat: ${initialAnalysis.fat_g}g
- Fiber: ${initialAnalysis.fiber_g}g, Sodium: ${initialAnalysis.sodium_mg}mg
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

    const stream = getClient().beta.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      betas: [BETA_HEADER],
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
    }, { signal });

    // Stream text deltas from the initial response
    const response = yield* streamTextDeltas(stream);

    l.debug({ action: "conversational_refine_response", ...summarizeResponse(response) }, "Claude API response received");
    l.debug(
      { action: "conversational_refine_response_content", content: serializeResponseContentForLog(response) },
      "Claude API chat response content"
    );

    // Check if Claude used any data tools (not report_nutrition)
    const dataToolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use" && (block as Anthropic.ToolUseBlock).name !== "report_nutrition"
    ) as Anthropic.ToolUseBlock[];

    // If data tools were used, run the tool loop
    if (dataToolUseBlocks.length > 0 && userId && currentDate) {
      l.info(
        { dataToolCount: dataToolUseBlocks.length },
        "running tool loop for data tools in conversational refinement"
      );

      // Yield tool_start for each data tool
      for (const tool of dataToolUseBlocks) {
        yield { type: "tool_start", tool: tool.name };
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
            { error: error instanceof Error ? error.message : String(error), userId },
            "failed to record API usage"
          );
        });
      }

      // Execute initial data tools
      const toolResults = await executeDataTools(dataToolUseBlocks, userId, currentDate, l);

      // Build updated conversation
      const updatedMessages: Anthropic.MessageParam[] = [
        ...anthropicMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ];

      // Continue with tool loop
      yield* runToolLoop(updatedMessages, userId, currentDate, {
        systemPrompt,
        tools: allTools,
        operation: "food-chat",
        signal,
        log: l,
      });

      l.info({ action: "conversational_refine_done_via_tool_loop", durationMs: elapsed() }, "conversational refinement completed via tool loop");
      return;
    } else if (dataToolUseBlocks.length > 0) {
      l.warn(
        { toolNames: dataToolUseBlocks.map((b) => b.name) },
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
          { error: error instanceof Error ? error.message : String(error), userId },
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

    l.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API conversational refinement error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
