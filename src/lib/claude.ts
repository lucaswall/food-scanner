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
      saturated_fat_g: {
        type: "number",
        description: "Estimated saturated fat in grams. Provide your best estimate; use null only if truly unknown.",
      },
      trans_fat_g: {
        type: "number",
        description: "Estimated trans fat in grams. Provide your best estimate; use null only if truly unknown.",
      },
      sugars_g: {
        type: "number",
        description: "Estimated sugars in grams. Provide your best estimate; use null only if truly unknown.",
      },
      calories_from_fat: {
        type: "number",
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
  description?: string
): Promise<FoodAnalysis> {
  try {
    logger.info(
      { imageCount: images.length, hasDescription: !!description },
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

    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function refineAnalysis(
  images: ImageInput[],
  previousAnalysis: FoodAnalysis,
  correction: string
): Promise<FoodAnalysis> {
  try {
    logger.info(
      { imageCount: images.length, hasCorrection: !!correction },
      "calling Claude API for food analysis refinement"
    );

    const refinementText = `I previously analyzed this food and got the following result:

Food: ${previousAnalysis.food_name}
Amount: ${previousAnalysis.amount} (unit_id: ${previousAnalysis.unit_id})
Calories: ${previousAnalysis.calories}
Protein: ${previousAnalysis.protein_g}g, Carbs: ${previousAnalysis.carbs_g}g, Fat: ${previousAnalysis.fat_g}g, Fiber: ${previousAnalysis.fiber_g}g, Sodium: ${previousAnalysis.sodium_mg}mg
Confidence: ${previousAnalysis.confidence}
Notes: ${previousAnalysis.notes}
Description: ${previousAnalysis.description}

The user has provided this correction: "${correction}"

Please re-analyze the food considering this correction and provide updated nutritional information.`;

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
              text: refinementText,
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
        "no tool_use block in Claude refinement response"
      );
      throw new ClaudeApiError("No tool_use block in response");
    }

    const analysis = validateFoodAnalysis(toolUseBlock.input);
    logger.info(
      { foodName: analysis.food_name, confidence: analysis.confidence },
      "food analysis refinement completed"
    );

    return analysis;
  } catch (error) {
    if (error instanceof ClaudeApiError) {
      throw error;
    }

    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Claude API refinement error"
    );
    throw new ClaudeApiError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
