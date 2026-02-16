import Anthropic from "@anthropic-ai/sdk";
import type { ImageInput } from "@/lib/claude";
import type { LumenGoals } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { getDb } from "@/db/index";
import { lumenGoals } from "@/db/schema";
import { eq, and, between, asc } from "drizzle-orm";
import { recordUsage } from "@/lib/claude-usage";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: getRequiredEnv("ANTHROPIC_API_KEY"),
      timeout: 30000,
      maxRetries: 2,
    });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are a Lumen app screenshot parser.
Extract the macro nutrient targets shown in the Lumen app screenshot.
The screenshot shows target values (the numbers AFTER the slash) for protein, carbs, and fat goals.
Do NOT extract the consumed values (the numbers BEFORE the slash).
Also extract the day type (e.g., "High Carb", "Low Carb", "Moderate").`;

const REPORT_LUMEN_GOALS_TOOL: Anthropic.Tool = {
  name: "report_lumen_goals",
  description: "Report the macro nutrient targets from the Lumen app screenshot",
  input_schema: {
    type: "object" as const,
    properties: {
      day_type: {
        type: "string",
        description: "The day type label shown in the app (e.g., 'High Carb', 'Low Carb', 'Moderate')",
      },
      protein_goal: {
        type: "number",
        description: "The protein target in grams (the number AFTER the slash)",
      },
      carbs_goal: {
        type: "number",
        description: "The carbs target in grams (the number AFTER the slash)",
      },
      fat_goal: {
        type: "number",
        description: "The fat target in grams (the number AFTER the slash)",
      },
    },
    required: ["day_type", "protein_goal", "carbs_goal", "fat_goal"],
  },
};

export class LumenParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LUMEN_PARSE_ERROR";
  }
}

interface LumenGoalsParsed {
  dayType: string;
  proteinGoal: number;
  carbsGoal: number;
  fatGoal: number;
}

function validateLumenGoals(input: unknown): LumenGoalsParsed {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new LumenParseError("Invalid Lumen goals: input must be an object");
  }
  const data = input as Record<string, unknown>;

  if (typeof data.day_type !== "string" || data.day_type.trim().length === 0) {
    throw new LumenParseError("Invalid Lumen goals: day_type must be a non-empty string");
  }

  const numericFields = ["protein_goal", "carbs_goal", "fat_goal"] as const;

  for (const field of numericFields) {
    if (typeof data[field] !== "number") {
      throw new LumenParseError(`Invalid Lumen goals: ${field} must be a number`);
    }
    if ((data[field] as number) <= 0) {
      throw new LumenParseError(`Invalid Lumen goals: ${field} must be positive`);
    }
  }

  return {
    dayType: data.day_type as string,
    proteinGoal: data.protein_goal as number,
    carbsGoal: data.carbs_goal as number,
    fatGoal: data.fat_goal as number,
  };
}

export async function parseLumenScreenshot(
  image: ImageInput,
  userId?: string,
  log?: Logger,
): Promise<LumenGoalsParsed> {
  const l = log ?? logger;
  try {
    l.info({ imageCount: 1 }, "calling Claude API for Lumen screenshot parsing");

    const response = await getClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      tools: [REPORT_LUMEN_GOALS_TOOL],
      tool_choice: { type: "tool", name: "report_lumen_goals" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: image.mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: image.base64,
              },
            },
            {
              type: "text" as const,
              text: "Extract the macro nutrient targets from this Lumen app screenshot.",
            },
          ],
        },
      ],
    });

    const toolUseBlock = response.content.find(
      (block) => block.type === "tool_use"
    );

    if (!toolUseBlock || toolUseBlock.type !== "tool_use") {
      l.error(
        { contentTypes: response.content.map((b) => b.type) },
        "no tool_use block in Lumen parsing response"
      );
      throw new LumenParseError("No tool_use block in response");
    }

    const goals = validateLumenGoals(toolUseBlock.input);
    l.info(
      { dayType: goals.dayType, proteinGoal: goals.proteinGoal },
      "Lumen goals parsed successfully"
    );

    // Record usage (fire-and-forget)
    if (userId) {
      recordUsage(userId, response.model, "lumen-parsing", {
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

    return goals;
  } catch (error) {
    if (error instanceof LumenParseError) {
      throw error;
    }

    l.error(
      { error: error instanceof Error ? error.message : String(error) },
      "Lumen parsing API error"
    );
    throw new LumenParseError(
      `API request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function upsertLumenGoals(
  userId: string,
  date: string,
  data: LumenGoalsParsed,
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  await getDb()
    .insert(lumenGoals)
    .values({
      userId,
      date,
      dayType: data.dayType,
      proteinGoal: data.proteinGoal,
      carbsGoal: data.carbsGoal,
      fatGoal: data.fatGoal,
    })
    .onConflictDoUpdate({
      target: [lumenGoals.userId, lumenGoals.date],
      set: {
        dayType: data.dayType,
        proteinGoal: data.proteinGoal,
        carbsGoal: data.carbsGoal,
        fatGoal: data.fatGoal,
        updatedAt: new Date(),
      },
    });

  l.info({ userId, date, dayType: data.dayType }, "Lumen goals upserted");
}

export async function getLumenGoalsByDate(
  userId: string,
  date: string
): Promise<LumenGoals | null> {
  const rows = await getDb()
    .select({
      date: lumenGoals.date,
      dayType: lumenGoals.dayType,
      proteinGoal: lumenGoals.proteinGoal,
      carbsGoal: lumenGoals.carbsGoal,
      fatGoal: lumenGoals.fatGoal,
    })
    .from(lumenGoals)
    .where(and(eq(lumenGoals.userId, userId), eq(lumenGoals.date, date)));

  if (rows.length === 0) {
    return null;
  }

  return {
    date: rows[0].date,
    dayType: rows[0].dayType,
    proteinGoal: rows[0].proteinGoal,
    carbsGoal: rows[0].carbsGoal,
    fatGoal: rows[0].fatGoal,
  };
}

export async function getLumenGoalsByDateRange(
  userId: string,
  fromDate: string,
  toDate: string
): Promise<Array<{ date: string; proteinGoal: number; carbsGoal: number; fatGoal: number }>> {
  const rows = await getDb()
    .select({
      date: lumenGoals.date,
      proteinGoal: lumenGoals.proteinGoal,
      carbsGoal: lumenGoals.carbsGoal,
      fatGoal: lumenGoals.fatGoal,
    })
    .from(lumenGoals)
    .where(
      and(
        eq(lumenGoals.userId, userId),
        between(lumenGoals.date, fromDate, toDate)
      )
    )
    .orderBy(asc(lumenGoals.date));

  return rows;
}
