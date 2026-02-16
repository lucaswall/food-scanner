import { getDb } from "@/db/index";
import { claudeUsage } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

/**
 * Pricing per 1M tokens for each Claude model.
 *
 * Anthropic pricing (as of 2026-01):
 * - Sonnet 4/4.5: $3/M input, $15/M output
 * - Haiku 4.5: $0.80/M input, $4/M output
 * - Cache creation: 25% MORE than input price
 * - Cache read: 90% LESS than input price (10% of input)
 */
export const MODEL_PRICING: Record<
  string,
  { inputPricePerMToken: number; outputPricePerMToken: number }
> = {
  "claude-sonnet-4-20250514": {
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  "claude-sonnet-4-5-20250929": {
    inputPricePerMToken: 3,
    outputPricePerMToken: 15,
  },
  "claude-haiku-4-5-20251001": {
    inputPricePerMToken: 0.8,
    outputPricePerMToken: 4,
  },
};

interface UsageTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

interface Pricing {
  inputPricePerMToken: number;
  outputPricePerMToken: number;
}

/**
 * Compute the total cost in USD for a Claude API call.
 *
 * Cache token pricing:
 * - cache_creation: charged at 25% MORE than input price (1.25x)
 * - cache_read: charged at 90% LESS than input price (0.1x)
 *
 * @returns Cost as a string with 6 decimal places
 */
export function computeCost(usage: UsageTokens, pricing: Pricing): string {
  const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPricePerMToken;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPricePerMToken;

  // Cache creation tokens cost 25% MORE than input tokens
  const cacheCreationCost =
    ((usage.cacheCreationTokens ?? 0) / 1_000_000) *
    pricing.inputPricePerMToken *
    1.25;

  // Cache read tokens cost 90% LESS than input tokens (10% of input price)
  const cacheReadCost =
    ((usage.cacheReadTokens ?? 0) / 1_000_000) *
    pricing.inputPricePerMToken *
    0.1;

  const totalCost = inputCost + outputCost + cacheCreationCost + cacheReadCost;

  return totalCost.toFixed(6);
}

/**
 * Record a Claude API usage event in the database.
 * Fire-and-forget: catches and logs errors, never throws.
 *
 * @param userId User ID
 * @param model Claude model identifier (e.g., "claude-sonnet-4-20250514")
 * @param operation Operation type (e.g., "food-analysis", "lumen-parsing")
 * @param usage Token counts from the API response
 */
export async function recordUsage(
  userId: string,
  model: string,
  operation: string,
  usage: UsageTokens,
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  try {
    const pricing = MODEL_PRICING[model] ?? {
      inputPricePerMToken: 0,
      outputPricePerMToken: 0,
    };

    if (!MODEL_PRICING[model]) {
      l.warn(
        { model, operation, userId },
        "Unknown Claude model, using zero pricing"
      );
    }

    const costUsd = computeCost(usage, pricing);

    const db = getDb();
    await db
      .insert(claudeUsage)
      .values({
        userId,
        model,
        operation,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheCreationTokens: usage.cacheCreationTokens ?? 0,
        cacheReadTokens: usage.cacheReadTokens ?? 0,
        inputPricePerMToken: pricing.inputPricePerMToken.toString(),
        outputPricePerMToken: pricing.outputPricePerMToken.toString(),
        costUsd,
      })
      .returning({ id: claudeUsage.id });
  } catch (error) {
    l.error(
      { error, userId, model, operation },
      "Failed to record Claude usage"
    );
  }
}

export interface MonthlyClaudeUsage {
  month: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: string;
}

/**
 * Get aggregated monthly Claude usage for a user.
 *
 * @param userId User ID
 * @param months Number of months to retrieve (most recent first)
 * @returns Array of monthly usage records, ordered most-recent-first
 */
export async function getMonthlyUsage(
  userId: string,
  months: number
): Promise<MonthlyClaudeUsage[]> {
  const db = getDb();

  const rows = await db
    .select({
      month: sql<string>`to_char(date_trunc('month', ${claudeUsage.createdAt}), 'YYYY-MM')`,
      totalRequests: sql<number>`count(*)::int`,
      totalInputTokens: sql<number>`sum(${claudeUsage.inputTokens})::int`,
      totalOutputTokens: sql<number>`sum(${claudeUsage.outputTokens})::int`,
      totalCostUsd: sql<string>`sum(${claudeUsage.costUsd}::numeric)::text`,
    })
    .from(claudeUsage)
    .where(eq(claudeUsage.userId, userId))
    .groupBy(sql`date_trunc('month', ${claudeUsage.createdAt})`)
    .orderBy(sql`date_trunc('month', ${claudeUsage.createdAt}) desc`)
    .limit(months);

  return rows;
}
