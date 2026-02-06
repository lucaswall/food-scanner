import Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
      timeout: 30000, // 30 second timeout as per ROADMAP.md
    });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a nutrition analyst specializing in Argentine and Latin American cuisine.
Analyze food images and descriptions to provide accurate nutritional information.
Consider typical Argentine portions and preparation methods.
Choose the most natural measurement unit for each food (e.g., cups for beverages, grams for solid food, slices for pizza/bread).`;

const REPORT_NUTRITION_TOOL: Anthropic.Tool = {
  name: "report_nutrition",
  description:
    "Report the nutritional analysis of the food shown in the images",
  input_schema: {
    type: "object" as const,
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
      confidence: { type: "string", enum: ["high", "medium", "low"] },
      notes: {
        type: "string",
        description: "Brief explanation of assumptions made",
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
      "confidence",
      "notes",
    ],
  },
};

interface ImageInput {
  base64: string;
  mimeType: string;
}

class ClaudeApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CLAUDE_API_ERROR";
  }
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
    confidence: data.confidence as FoodAnalysis["confidence"],
    notes: data.notes as string,
  };
}

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "APIConnectionTimeoutError" ||
      error.message.includes("timed out") ||
      error.message.includes("timeout"))
  );
}

function isRateLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "RateLimitError" ||
      ("status" in error && (error as { status?: number }).status === 429))
  );
}

export async function analyzeFood(
  images: ImageInput[],
  description?: string
): Promise<FoodAnalysis> {
  const maxRetries = 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      logger.info(
        { imageCount: images.length, hasDescription: !!description, attempt },
        "calling Claude API for food analysis"
      );

      const response = await getClient().messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: [REPORT_NUTRITION_TOOL],
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

      return analysis;
    } catch (error) {
      if (error instanceof ClaudeApiError) {
        throw error;
      }

      if (isTimeoutError(error) && attempt < maxRetries) {
        logger.warn({ attempt }, "Claude API timeout, retrying");
        lastError = error as Error;
        continue;
      }

      if (isRateLimitError(error) && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn({ attempt, delay }, "Claude API rate limited, retrying");
        lastError = error as Error;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
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

  // This should only be reached if all retries exhausted due to timeouts
  throw new ClaudeApiError(
    `API request failed after retries: ${lastError?.message || "unknown error"}`
  );
}
