import Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 30000, // 30 second timeout as per ROADMAP.md
});

const SYSTEM_PROMPT = `You are a nutrition analyst specializing in Argentine and Latin American cuisine.
Analyze food images and descriptions to provide accurate nutritional information.
Consider typical Argentine portions and preparation methods.`;

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
      portion_size_g: {
        type: "number",
        description: "Estimated weight in grams",
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
      "portion_size_g",
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

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "APIConnectionTimeoutError" ||
      error.message.includes("timed out") ||
      error.message.includes("timeout"))
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

      const response = await client.messages.create({
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

      const analysis = toolUseBlock.input as FoodAnalysis;
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
