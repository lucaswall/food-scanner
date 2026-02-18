import type Anthropic from "@anthropic-ai/sdk";
import { searchFoods, getDailyNutritionSummary, getDateRangeNutritionSummary, getFoodLogHistory } from "@/lib/food-log";
import { getFastingWindow, getFastingWindows } from "@/lib/fasting";
import { getLumenGoalsByDate } from "@/lib/lumen";
import { getCalorieGoalsByDateRange } from "@/lib/nutrition-goals";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export const SEARCH_FOOD_LOG_TOOL: Anthropic.Tool = {
  name: "search_food_log",
  description: "Search the user's food log to find what they have eaten. Use this when the user references past meals, asks about foods they've eaten before, wants to see entries for a specific date or meal, or asks what they usually eat. Three mutually exclusive modes: (1) keywords only — returns the most frequently logged matches; (2) date only — returns entries for that date grouped by meal type; (3) from_date+to_date — returns entries in the range. Do NOT combine keywords with date parameters — keywords are ignored when a date is provided.",
  input_schema: {
    type: "object" as const,
    required: ["keywords", "date", "from_date", "to_date", "meal_type", "limit"],
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "1-5 lowercase single-word tokens identifying the food to search for. Follow the same keyword rules as report_nutrition: food type first, then key modifiers, main ingredients, preparation method. Use hyphens for compound concepts (e.g., sin-alcohol). Use singular form.",
      },
      date: {
        type: ["string", "null"],
        description: "Specific date in YYYY-MM-DD format",
      },
      from_date: {
        type: ["string", "null"],
        description: "Range start in YYYY-MM-DD format",
      },
      to_date: {
        type: ["string", "null"],
        description: "Range end in YYYY-MM-DD format",
      },
      meal_type: {
        anyOf: [
          {
            type: "string",
            enum: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "anytime"],
          },
          {
            type: "null",
          },
        ],
        description: "Filter by meal type",
      },
      limit: {
        type: ["number", "null"],
        description: "Maximum results, default 10",
      },
    },
  },
};

export const GET_NUTRITION_SUMMARY_TOOL: Anthropic.Tool = {
  name: "get_nutrition_summary",
  description: "Get the user's nutrition summary including total calories, protein, carbs, fat, fiber, and sodium. Always includes the user's calorie and macro goals when available, so you can tell them how they're tracking. Use this for questions about daily intake, goal progress, nutrition trends over time, or macro breakdowns. For a single date, returns per-meal breakdown. For a date range, returns daily totals with goals.",
  input_schema: {
    type: "object" as const,
    required: ["date", "from_date", "to_date"],
    properties: {
      date: {
        type: ["string", "null"],
        description: "Single date in YYYY-MM-DD format",
      },
      from_date: {
        type: ["string", "null"],
        description: "Range start in YYYY-MM-DD format",
      },
      to_date: {
        type: ["string", "null"],
        description: "Range end in YYYY-MM-DD format",
      },
    },
  },
};

export const GET_FASTING_INFO_TOOL: Anthropic.Tool = {
  name: "get_fasting_info",
  description: "Get the user's fasting window information. Shows when they last ate, when they first ate, and the fasting duration in between. Use this when the user asks about fasting, when they last ate, or wants to see fasting patterns over time. A null firstMealTime means the user is currently fasting (hasn't eaten yet today).",
  input_schema: {
    type: "object" as const,
    required: ["date", "from_date", "to_date"],
    properties: {
      date: {
        type: ["string", "null"],
        description: "Single date in YYYY-MM-DD format, defaults to today",
      },
      from_date: {
        type: ["string", "null"],
        description: "Range start in YYYY-MM-DD format",
      },
      to_date: {
        type: ["string", "null"],
        description: "Range end in YYYY-MM-DD format",
      },
    },
  },
};

const MEAL_TYPE_MAP: Record<string, number> = {
  breakfast: 1,
  morning_snack: 2,
  lunch: 3,
  afternoon_snack: 4,
  dinner: 5,
  anytime: 7,
};

function formatTime(time: string): string {
  // HH:mm:ss -> HH:mm
  return time.slice(0, 5);
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hours`;
  }
  return `${hours}h ${mins}m`;
}

async function executeSearchFoodLog(
  params: Record<string, unknown>,
  userId: string,
  currentDate: string,
  log?: Logger,
): Promise<string> {
  const { keywords, date, from_date, to_date, meal_type, limit } = params;
  const effectiveLimit = (limit != null ? Number(limit) : 10);

  // Validate keywords is a non-empty array when provided
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;

  // Validate at least one search parameter
  if (!hasKeywords && !date && !(from_date && to_date)) {
    throw new Error("At least one of keywords, date, or from_date+to_date must be provided");
  }

  // Case 1: keywords only (search by keyword matching)
  if (hasKeywords && !date && !from_date) {
    const keywordArray = (keywords as string[]).map(k => String(k).toLowerCase());
    const foods = await searchFoods(userId, keywordArray, { limit: effectiveLimit }, log);
    if (foods.length === 0) {
      return `No foods found matching keywords [${keywordArray.join(", ")}].`;
    }
    const lines = foods.map((food) => {
      const amountLabel = getUnitLabel(food.unitId, food.amount);
      const mealLabel = FITBIT_MEAL_TYPE_LABELS[food.mealTypeId] || "Unknown";
      return `• [id:${food.customFoodId}] ${food.foodName} — ${amountLabel}, ${food.calories} cal, P:${food.proteinG}g C:${food.carbsG}g F:${food.fatG}g (usually eaten at ${mealLabel})`;
    });
    return `Found ${foods.length} matching foods:\n${lines.join("\n")}`;
  }

  // Case 2: date only (or date + meal_type)
  if (date && typeof date === "string" && !from_date) {
    const summary = await getDailyNutritionSummary(userId, date, log);

    let filteredMeals = summary.meals;
    if (meal_type && typeof meal_type === "string") {
      const mealTypeId = MEAL_TYPE_MAP[meal_type];
      filteredMeals = summary.meals.filter((m) => m.mealTypeId === mealTypeId);
    }

    if (filteredMeals.length === 0) {
      return `No entries found for ${date}${meal_type ? ` at ${meal_type}` : ""}.`;
    }

    const lines: string[] = [];
    for (const meal of filteredMeals) {
      const mealLabel = FITBIT_MEAL_TYPE_LABELS[meal.mealTypeId] || "Unknown";
      lines.push(`\n${mealLabel}:`);
      for (const entry of meal.entries) {
        const timeStr = entry.time ? ` at ${formatTime(entry.time)}` : "";
        lines.push(`  • [id:${entry.customFoodId}] ${entry.foodName}${timeStr} — ${entry.calories} cal, P:${entry.proteinG}g C:${entry.carbsG}g F:${entry.fatG}g`);
      }
    }

    return `Food log for ${date}:${lines.join("\n")}`;
  }

  // Case 3: date range
  if (from_date && to_date && typeof from_date === "string" && typeof to_date === "string") {
    const entries = await getFoodLogHistory(userId, {
      startDate: from_date,
      endDate: to_date,
      limit: 100,
    }, log);

    const truncated = effectiveLimit < entries.length ? entries.slice(0, effectiveLimit) : entries;

    if (truncated.length === 0) {
      return `No entries found between ${from_date} and ${to_date}.`;
    }

    const lines = truncated.map((entry) => {
      const amountLabel = getUnitLabel(entry.unitId, entry.amount);
      const mealLabel = FITBIT_MEAL_TYPE_LABELS[entry.mealTypeId] || "Unknown";
      const timeStr = entry.time ? ` at ${formatTime(entry.time)}` : "";
      return `• [id:${entry.customFoodId}] ${entry.date} — ${entry.foodName} (${mealLabel}${timeStr}) — ${amountLabel}, ${entry.calories} cal, P:${entry.proteinG}g C:${entry.carbsG}g F:${entry.fatG}g`;
    });

    return `Found ${truncated.length} entries between ${from_date} and ${to_date}:\n${lines.join("\n")}`;
  }

  throw new Error("Invalid search_food_log parameters");
}

async function executeGetNutritionSummary(
  params: Record<string, unknown>,
  userId: string,
  currentDate: string,
  log?: Logger,
): Promise<string> {
  const { date, from_date, to_date } = params;

  // Validate at least one parameter
  if (!date && !(from_date && to_date)) {
    throw new Error("At least one of date or from_date+to_date must be provided");
  }

  // Case 1: single date
  if (date && typeof date === "string" && !from_date) {
    const summary = await getDailyNutritionSummary(userId, date, log);
    const goals = await getLumenGoalsByDate(userId, date);
    const calorieGoals = await getCalorieGoalsByDateRange(userId, date, date);
    const calorieGoal = calorieGoals.length > 0 ? calorieGoals[0].calorieGoal : null;

    const lines: string[] = [];
    lines.push(`Nutrition summary for ${date}:`);
    lines.push(`Total: ${summary.totals.calories} cal, P:${summary.totals.proteinG}g C:${summary.totals.carbsG}g F:${summary.totals.fatG}g, Fiber:${summary.totals.fiberG}g, Sodium:${summary.totals.sodiumMg}mg`);

    if (calorieGoal !== null && calorieGoal > 0) {
      const pct = Math.round((summary.totals.calories / calorieGoal) * 100);
      lines.push(`Calorie goal: ${calorieGoal} cal (${pct}% of goal)`);
    }

    if (goals) {
      const proteinPct = goals.proteinGoal > 0 ? Math.round((summary.totals.proteinG / goals.proteinGoal) * 100) : 0;
      const carbsPct = goals.carbsGoal > 0 ? Math.round((summary.totals.carbsG / goals.carbsGoal) * 100) : 0;
      const fatPct = goals.fatGoal > 0 ? Math.round((summary.totals.fatG / goals.fatGoal) * 100) : 0;
      lines.push(`Macro goals (${goals.dayType}): P:${goals.proteinGoal}g (${proteinPct}%) C:${goals.carbsGoal}g (${carbsPct}%) F:${goals.fatGoal}g (${fatPct}%)`);
    }

    // Add per-meal breakdown
    if (summary.meals.length > 0) {
      lines.push("\nBreakdown by meal:");
      for (const meal of summary.meals) {
        const mealLabel = FITBIT_MEAL_TYPE_LABELS[meal.mealTypeId] || "Unknown";
        lines.push(`  ${mealLabel}: ${meal.subtotal.calories} cal, P:${meal.subtotal.proteinG}g C:${meal.subtotal.carbsG}g F:${meal.subtotal.fatG}g`);
      }
    }

    return lines.join("\n");
  }

  // Case 2: date range
  if (from_date && to_date && typeof from_date === "string" && typeof to_date === "string") {
    const days = await getDateRangeNutritionSummary(userId, from_date, to_date, log);

    if (days.length === 0) {
      return `No nutrition data found between ${from_date} and ${to_date}.`;
    }

    const lines: string[] = [];
    lines.push(`Nutrition summary for ${from_date} to ${to_date}:`);

    for (const day of days) {
      let dayLine = `\n${day.date}: ${day.calories} cal, P:${day.proteinG}g C:${day.carbsG}g F:${day.fatG}g`;

      if (day.calorieGoal !== null && day.calorieGoal > 0) {
        const pct = Math.round((day.calories / day.calorieGoal) * 100);
        dayLine += ` (${pct}% of ${day.calorieGoal} cal goal)`;
      }

      if (day.proteinGoalG !== null && day.carbsGoalG !== null && day.fatGoalG !== null) {
        const proteinPct = day.proteinGoalG > 0 ? Math.round((day.proteinG / day.proteinGoalG) * 100) : 0;
        const carbsPct = day.carbsGoalG > 0 ? Math.round((day.carbsG / day.carbsGoalG) * 100) : 0;
        const fatPct = day.fatGoalG > 0 ? Math.round((day.fatG / day.fatGoalG) * 100) : 0;
        dayLine += ` | Macro goals: P:${proteinPct}% C:${carbsPct}% F:${fatPct}%`;
      }

      lines.push(dayLine);
    }

    return lines.join("\n");
  }

  throw new Error("Invalid get_nutrition_summary parameters");
}

async function executeGetFastingInfo(
  params: Record<string, unknown>,
  userId: string,
  currentDate: string,
  log?: Logger,
): Promise<string> {
  const { date, from_date, to_date } = params;

  // Case 1: single date (or default to current date)
  if (!from_date && !to_date) {
    const targetDate = (date && typeof date === "string") ? date : currentDate;
    const window = await getFastingWindow(userId, targetDate, log);

    if (!window) {
      return `No fasting data available for ${targetDate} (no meals logged on the previous day).`;
    }

    if (window.firstMealTime === null) {
      return `Fasting window for ${targetDate}:\nLast meal: ${formatTime(window.lastMealTime)} (previous day)\nStatus: Currently fasting (no meals logged yet today)`;
    }

    const duration = window.durationMinutes ? formatDuration(window.durationMinutes) : "N/A";
    return `Fasting window for ${targetDate}:\nLast meal: ${formatTime(window.lastMealTime)} (previous day)\nFirst meal: ${formatTime(window.firstMealTime)}\nDuration: ${duration}`;
  }

  // Case 2: date range
  if (from_date && to_date && typeof from_date === "string" && typeof to_date === "string") {
    const windows = await getFastingWindows(userId, from_date, to_date, log);

    if (windows.length === 0) {
      return `No fasting data available between ${from_date} and ${to_date}.`;
    }

    const lines: string[] = [];
    lines.push(`Fasting windows for ${from_date} to ${to_date}:`);

    for (const window of windows) {
      if (window.firstMealTime === null) {
        lines.push(`\n${window.date}: Currently fasting (last meal: ${formatTime(window.lastMealTime)} previous day)`);
      } else {
        const duration = window.durationMinutes ? formatDuration(window.durationMinutes) : "N/A";
        lines.push(`\n${window.date}: ${duration} (${formatTime(window.lastMealTime)} → ${formatTime(window.firstMealTime)})`);
      }
    }

    return lines.join("\n");
  }

  throw new Error("Invalid get_fasting_info parameters");
}

export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  userId: string,
  currentDate: string,
  log?: Logger
): Promise<string> {
  const l = log ?? logger;
  l.debug({ action: "execute_tool", tool: toolName, params }, "executing data tool");
  const result = await ((): Promise<string> => {
    switch (toolName) {
      case "search_food_log":
        return executeSearchFoodLog(params, userId, currentDate, l);
      case "get_nutrition_summary":
        return executeGetNutritionSummary(params, userId, currentDate, l);
      case "get_fasting_info":
        return executeGetFastingInfo(params, userId, currentDate, l);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  })();
  l.debug({ action: "execute_tool_result", tool: toolName, resultLength: result.length, result }, "data tool execution complete");
  return result;
}
