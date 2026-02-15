import Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis, ConversationMessage } from "@/types";
import { getUnitLabel } from "@/types";
import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { recordUsage } from "@/lib/claude-usage";
import { executeTool, SEARCH_FOOD_LOG_TOOL, GET_NUTRITION_SUMMARY_TOOL, GET_FASTING_INFO_TOOL } from "@/lib/chat-tools";

const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
      timeout: 30000, // 30 second timeout as per ROADMAP.md
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
- When suggesting meals, consider their typical eating patterns and current goal progress`;

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

function validateFoodAnalysis(input: unknown): FoodAnalysis {
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

  return {
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
}

export async function analyzeFood(
  images: ImageInput[],
  description?: string,
  userId?: string
): Promise<FoodAnalysis> {
  try {
    logger.info(
      { imageCount: images.length, hasDescription: !!description },
      "calling Claude API for food analysis"
    );

    // Add cache_control to last tool (don't mutate original)
    const toolsWithCache = [{
      ...REPORT_NUTRITION_TOOL,
      cache_control: { type: "ephemeral" as const },
    }];

    const response = await getClient().messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text" as const,
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" as const },
        },
      ],
      tools: toolsWithCache,
      tool_choice: { type: "tool", name: "report_nutrition" },
      messages: [
        {
          role: "user",
          content: [
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
            })),
            {
              type: "text" as const,
              text: description || "Analyze this food.",
            },
          ],
        },
      ],
    });

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      logger.error(
        { contentTypes: response.content.map((b) => b.type) },
        "no tool_use block in Claude response"
      );
      throw new ClaudeApiError("No tool_use block in response");
    }

    const analysis = validateFoodAnalysis(toolUseBlock.input);
    logger.info(
      { foodName: analysis.food_name, confidence: analysis.confidence },
      "food analysis completed"
    );

    // Record usage (fire-and-forget)
    if (userId) {
      recordUsage(userId, response.model, "food-analysis", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });
    }

    return analysis;
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function conversationalRefine(
  messages: ConversationMessage[],
  images: ImageInput[],
  userId?: string,
  currentDate?: string,
  initialAnalysis?: FoodAnalysis
): Promise<{ message: string; analysis?: FoodAnalysis }> {
  try {
    logger.info(
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
    anthropicMessages = truncateConversation(anthropicMessages, 150000);

    // Build system prompt with initial analysis context if available
    let systemPrompt = CHAT_SYSTEM_PROMPT;
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

    const allTools = [REPORT_NUTRITION_TOOL, ...DATA_TOOLS];

    // Add cache_control to last tool (don't mutate originals)
    const toolsWithCache = allTools.map((tool, index) =>
      index === allTools.length - 1
        ? { ...tool, cache_control: { type: "ephemeral" as const } }
        : tool
    );

    const response = await getClient().messages.create({
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
    });

    // Check if Claude used any data tools (not report_nutrition)
    const dataToolUseBlocks = response.content.filter(
      (block) => block.type === "tool_use" && block.name !== "report_nutrition"
    );

    // If data tools were used, run the tool loop with the initial response
    if (dataToolUseBlocks.length > 0 && userId && currentDate) {
      logger.info(
        { dataToolCount: dataToolUseBlocks.length },
        "running tool loop for data tools in conversational refinement"
      );

      return runToolLoop(anthropicMessages, userId, currentDate, {
        systemPrompt,
        tools: allTools,
        operation: "food-chat",
        initialResponse: response,
      });
    }

    // Extract text blocks into message string
    const textBlocks = response.content.filter(
      (block) => block.type === "text"
    ) as Anthropic.TextBlock[];
    const message = textBlocks.map((block) => block.text).join("\n");

    // Check for tool_use block (report_nutrition)
    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use" && block.name === "report_nutrition"
    );

    let analysis: FoodAnalysis | undefined;
    if (toolUseBlock && toolUseBlock.type === "tool_use") {
      analysis = validateFoodAnalysis(toolUseBlock.input);
      logger.info(
        { foodName: analysis.food_name, confidence: analysis.confidence },
        "conversational refinement with analysis completed"
      );
    } else {
      logger.info("conversational refinement completed (text only)");
    }

    // Record usage (fire-and-forget)
    if (userId) {
      recordUsage(userId, response.model, "food-chat", {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      }).catch((error) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error), userId },
          "failed to record API usage"
        );
      });
    }

    return { message, analysis };
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API conversational refinement error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

const DATA_TOOLS = [
  SEARCH_FOOD_LOG_TOOL,
  GET_NUTRITION_SUMMARY_TOOL,
  GET_FASTING_INFO_TOOL,
];

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
        }
      }
    } else if (typeof message.content === "string") {
      tokens += Math.ceil(message.content.length / 4);
    }
  }

  return tokens;
}

function truncateConversation(
  messages: Anthropic.MessageParam[],
  maxTokens: number
): Anthropic.MessageParam[] {
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

  return [firstMessage, ...lastFourMessages];
}


export async function runToolLoop(
  messages: Anthropic.MessageParam[],
  userId: string,
  currentDate: string,
  options?: {
    systemPrompt?: string;
    tools?: Anthropic.Tool[];
    operation?: string;
    initialResponse?: Anthropic.Message;
  }
): Promise<{ message: string; analysis?: FoodAnalysis }> {
  const systemPrompt = options?.systemPrompt ?? CHAT_SYSTEM_PROMPT;
  const tools = options?.tools ?? DATA_TOOLS;
  const operation = options?.operation ?? "food-chat";

  // Add cache_control to last tool (don't mutate originals)
  const toolsWithCache = tools.map((tool, index) =>
    index === tools.length - 1
      ? { ...tool, cache_control: { type: "ephemeral" as const } }
      : tool
  );

  const conversationMessages: Anthropic.MessageParam[] = [...messages];
  const MAX_ITERATIONS = 5;
  let iteration = 0;
  let pendingResponse = options?.initialResponse;
  let lastResponse: Anthropic.Message | undefined;

  try {
    while (iteration < MAX_ITERATIONS) {
      iteration++;

      let response: Anthropic.Message;
      if (pendingResponse) {
        response = pendingResponse;
        pendingResponse = undefined;
      } else {
        logger.info(
          { iteration, messageCount: conversationMessages.length },
          "calling Claude API in tool loop"
        );

        response = await getClient().messages.create({
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
          messages: conversationMessages,
        });
      }

      lastResponse = response;

      // Record usage (fire-and-forget)
      if (userId) {
        recordUsage(userId, response.model, operation, {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        }).catch((error) => {
          logger.warn(
            { error: error instanceof Error ? error.message : String(error), userId },
            "failed to record API usage"
          );
        });
      }

      if (response.stop_reason === "end_turn") {
        // Extract text and optional analysis
        const textBlocks = response.content.filter(
          (block) => block.type === "text"
        ) as Anthropic.TextBlock[];
        const message = textBlocks.map((block) => block.text).join("\n");

        const toolUseBlock = response.content.find(
          (block) => block.type === "tool_use" && block.name === "report_nutrition"
        );

        let analysis: FoodAnalysis | undefined;
        if (toolUseBlock && toolUseBlock.type === "tool_use") {
          analysis = validateFoodAnalysis(toolUseBlock.input);
        }

        logger.info({ iteration, hasAnalysis: !!analysis }, "tool loop completed");
        return { message, analysis };
      }

      if (response.stop_reason === "tool_use") {
        // Extract all tool_use blocks
        const toolUseBlocks = response.content.filter(
          (block) => block.type === "tool_use"
        ) as Anthropic.ToolUseBlock[];

        logger.info(
          { iteration, toolCount: toolUseBlocks.length },
          "executing tools"
        );

        // Add assistant message with tool_use blocks
        conversationMessages.push({
          role: "assistant",
          content: response.content,
        });

        // Execute all tools in parallel (catch errors per-tool to return is_error results)
        const toolResults = await Promise.all(
          toolUseBlocks.map(async (toolUse) => {
            try {
              const result = await executeTool(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                userId,
                currentDate
              );

              return {
                type: "tool_result" as const,
                tool_use_id: toolUse.id,
                content: result,
              };
            } catch (error) {
              logger.warn(
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

        // Add user message with all tool_result blocks
        conversationMessages.push({
          role: "user",
          content: toolResults,
        });

        // Continue loop
        continue;
      }

      // Handle other stop reasons gracefully (refusal, model_context_window_exceeded, max_tokens, etc.)
      // Extract text blocks and return partial response
      logger.warn(
        { stop_reason: response.stop_reason, iteration },
        "unexpected stop_reason, returning partial response"
      );

      const textBlocks = response.content.filter(
        (block) => block.type === "text"
      ) as Anthropic.TextBlock[];
      const message = textBlocks.map((block) => block.text).join("\n");

      const toolUseBlock = response.content.find(
        (block) => block.type === "tool_use" && block.name === "report_nutrition"
      );

      let analysis: FoodAnalysis | undefined;
      if (toolUseBlock && toolUseBlock.type === "tool_use") {
        analysis = validateFoodAnalysis(toolUseBlock.input);
      }

      return { message, analysis };
    }

    // Exceeded max iterations - return last response
    logger.warn({ iteration }, "tool loop exceeded maximum iterations");

    if (lastResponse) {
      const textBlocks = lastResponse.content.filter(
        (block) => block.type === "text"
      ) as Anthropic.TextBlock[];
      const message = textBlocks.map((block) => block.text).join("\n");

      const toolUseBlock = lastResponse.content.find(
        (block) => block.type === "tool_use" && block.name === "report_nutrition"
      );

      let analysis: FoodAnalysis | undefined;
      if (toolUseBlock && toolUseBlock.type === "tool_use") {
        analysis = validateFoodAnalysis(toolUseBlock.input);
      }

      return { message, analysis };
    }

    return { message: "", analysis: undefined };
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API tool loop error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
