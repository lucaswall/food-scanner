import type Anthropic from "@anthropic-ai/sdk";
import { searchFoods, getDailyNutritionSummary, getDateRangeNutritionSummary, getFoodLogHistory } from "@/lib/food-log";
import { getFastingWindow, getFastingWindows } from "@/lib/fasting";
import { getLumenGoalsByDate } from "@/lib/lumen";
import { getCalorieGoalsByDateRange } from "@/lib/nutrition-goals";
import { searchLabels, insertLabel, updateLabel, deleteLabel, findDuplicateLabel } from "@/lib/nutrition-labels";
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
        lines.push(`  • [id:${entry.customFoodId}] [entry:${entry.id}] ${entry.foodName}${timeStr} — ${entry.calories} cal, P:${entry.proteinG}g C:${entry.carbsG}g F:${entry.fatG}g`);
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
      return `• [id:${entry.customFoodId}] [entry:${entry.id}] ${entry.date} — ${entry.foodName} (${mealLabel}${timeStr}) — ${amountLabel}, ${entry.calories} cal, P:${entry.proteinG}g C:${entry.carbsG}g F:${entry.fatG}g`;
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

export const SEARCH_NUTRITION_LABELS_TOOL: Anthropic.Tool = {
  name: "search_nutrition_labels",
  description: "Search the user's saved nutrition label library for branded/packaged products. Returns matching labels with full nutrition data. Use this BEFORE estimating nutrition for any branded, packaged, or commercial food product.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false as const,
    required: ["keywords"],
    properties: {
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "1-5 lowercase search terms (brand name, product name, variant).",
      },
    },
  },
};

export const SAVE_NUTRITION_LABEL_TOOL: Anthropic.Tool = {
  name: "save_nutrition_label",
  description: "Save nutrition data extracted from a product label photo. Automatically detects and handles duplicates. Call this when you detect a nutrition facts label in the user's photos.",
  input_schema: {
    type: "object" as const,
    required: [
      "brand", "product_name", "variant", "serving_size_g", "serving_size_label",
      "calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg",
      "saturated_fat_g", "trans_fat_g", "sugars_g", "extra_nutrients", "notes",
    ],
    properties: {
      brand: { type: "string", description: "Brand name of the product." },
      product_name: { type: "string", description: "Product name." },
      variant: { type: ["string", "null"], description: "Product variant (e.g., 'Entera', 'Light'), or null." },
      serving_size_g: { type: "number", description: "Serving size in grams." },
      serving_size_label: { type: "string", description: "Serving size label as shown on the package (e.g., '1 vaso (200ml)')." },
      calories: { type: "number", description: "Calories per serving." },
      protein_g: { type: "number", description: "Protein in grams per serving." },
      carbs_g: { type: "number", description: "Carbohydrates in grams per serving." },
      fat_g: { type: "number", description: "Total fat in grams per serving." },
      fiber_g: { type: "number", description: "Dietary fiber in grams per serving." },
      sodium_mg: { type: "number", description: "Sodium in milligrams per serving." },
      saturated_fat_g: { type: ["number", "null"], description: "Saturated fat in grams, or null if not on label." },
      trans_fat_g: { type: ["number", "null"], description: "Trans fat in grams, or null if not on label." },
      sugars_g: { type: ["number", "null"], description: "Sugars in grams, or null if not on label." },
      extra_nutrients: {
        type: ["object", "null"],
        description: "Additional nutrients as key-value pairs (name → grams), or null.",
        additionalProperties: { type: "number" },
      },
      notes: { type: ["string", "null"], description: "Optional notes about the label." },
    },
  },
};

export const MANAGE_NUTRITION_LABEL_TOOL: Anthropic.Tool = {
  name: "manage_nutrition_label",
  description: "Update or delete a nutrition label entry. Use when the user explicitly asks to modify or remove a saved label.",
  input_schema: {
    type: "object" as const,
    required: ["action", "label_id", "update_fields"],
    properties: {
      action: {
        type: "string",
        enum: ["update", "delete"],
        description: "Action to perform: 'update' or 'delete'.",
      },
      label_id: { type: "number", description: "ID of the label to update or delete." },
      update_fields: {
        type: ["object", "null"],
        description: "Fields to update. Required when action is 'update', null when 'delete'.",
        properties: {
          brand: { type: "string" },
          product_name: { type: "string" },
          variant: { type: ["string", "null"] },
          serving_size_g: { type: "number" },
          serving_size_label: { type: "string" },
          calories: { type: "number" },
          protein_g: { type: "number" },
          carbs_g: { type: "number" },
          fat_g: { type: "number" },
          fiber_g: { type: "number" },
          sodium_mg: { type: "number" },
          saturated_fat_g: { type: ["number", "null"] },
          trans_fat_g: { type: ["number", "null"] },
          sugars_g: { type: ["number", "null"] },
          extra_nutrients: { type: ["object", "null"], additionalProperties: { type: "number" } },
          notes: { type: ["string", "null"] },
        },
      },
    },
  },
};

async function executeSearchNutritionLabels(
  params: Record<string, unknown>,
  userId: string,
  log?: Logger,
): Promise<string> {
  const keywords = Array.isArray(params.keywords) ? (params.keywords as string[]) : [];
  const labels = await searchLabels(userId, keywords, log);
  if (labels.length === 0) {
    return "No matching nutrition labels found in your library.";
  }
  const lines = labels.map((label) => {
    const variant = label.variant ? ` (${label.variant})` : "";
    const savedDate = label.updatedAt.toISOString().slice(0, 10);
    return `[label:${label.id}] ${label.brand} - ${label.productName}${variant} | Serving: ${label.servingSizeLabel} | Cal: ${label.calories} | P: ${label.proteinG}g C: ${label.carbsG}g F: ${label.fatG}g | Saved: ${savedDate}`;
  });
  return lines.join("\n");
}

function withinTolerance(
  oldVal: number,
  newVal: number,
  pctThreshold: number,
  absThreshold: number,
): boolean {
  const absDiff = Math.abs(oldVal - newVal);
  if (absDiff <= absThreshold) return true;
  const base = Math.max(Math.abs(oldVal), 1);
  return absDiff / base <= pctThreshold;
}

async function executeSaveNutritionLabel(
  params: Record<string, unknown>,
  userId: string,
  log?: Logger,
): Promise<string> {
  const brand = String(params.brand);
  const productName = String(params.product_name);
  const variant = (params.variant as string | null) ?? null;
  const servingSizeG = Number(params.serving_size_g);

  const inputData = {
    brand,
    productName,
    variant,
    servingSizeG,
    servingSizeLabel: String(params.serving_size_label),
    calories: Number(params.calories),
    proteinG: Number(params.protein_g),
    carbsG: Number(params.carbs_g),
    fatG: Number(params.fat_g),
    fiberG: Number(params.fiber_g),
    sodiumMg: Number(params.sodium_mg),
    saturatedFatG: params.saturated_fat_g != null ? Number(params.saturated_fat_g) : null,
    transFatG: params.trans_fat_g != null ? Number(params.trans_fat_g) : null,
    sugarsG: params.sugars_g != null ? Number(params.sugars_g) : null,
    extraNutrients: (params.extra_nutrients as Record<string, number> | null) ?? null,
    source: "photo_scan",
    notes: (params.notes as string | null) ?? null,
  };

  const duplicates = await findDuplicateLabel(userId, brand, productName, variant, log);

  // Find a duplicate with matching variant (both null or same value)
  const sameVariant = duplicates.find((d) => {
    const dv = d.variant ?? null;
    const iv = variant ?? null;
    return dv === iv || (dv != null && iv != null && dv.toLowerCase() === iv.toLowerCase());
  });

  if (sameVariant) {
    // Normalize to per-100g for comparison
    const oldServing = sameVariant.servingSizeG > 0 ? sameVariant.servingSizeG : 100;
    const newServing = servingSizeG > 0 ? servingSizeG : 100;

    const oldCal100 = (sameVariant.calories * 100) / oldServing;
    const oldPro100 = (sameVariant.proteinG * 100) / oldServing;
    const oldCarb100 = (sameVariant.carbsG * 100) / oldServing;
    const oldFat100 = (sameVariant.fatG * 100) / oldServing;

    const newCal100 = (inputData.calories * 100) / newServing;
    const newPro100 = (inputData.proteinG * 100) / newServing;
    const newCarb100 = (inputData.carbsG * 100) / newServing;
    const newFat100 = (inputData.fatG * 100) / newServing;

    const calSame = withinTolerance(oldCal100, newCal100, 0.10, 25);
    const proSame = withinTolerance(oldPro100, newPro100, 0.10, 3);
    const carbSame = withinTolerance(oldCarb100, newCarb100, 0.10, 3);
    const fatSame = withinTolerance(oldFat100, newFat100, 0.10, 3);

    await updateLabel(userId, sameVariant.id, inputData, log);

    if (calSame && proSame && carbSame && fatSame) {
      return `Label updated (status: updated). Label ID: ${sameVariant.id}. Refreshed data for ${brand} - ${productName}.`;
    }

    const changes: string[] = [];
    if (!calSame) changes.push(`calories: ${Math.round(sameVariant.calories)} → ${inputData.calories}`);
    if (!proSame) changes.push(`protein: ${sameVariant.proteinG}g → ${inputData.proteinG}g`);
    if (!carbSame) changes.push(`carbs: ${sameVariant.carbsG}g → ${inputData.carbsG}g`);
    if (!fatSame) changes.push(`fat: ${sameVariant.fatG}g → ${inputData.fatG}g`);

    return `Label updated with changes (status: updated_changed). Label ID: ${sameVariant.id}. Changed: ${changes.join(", ")}.`;
  }

  // No matching variant — create new
  const inserted = await insertLabel(userId, inputData, log);
  return `Label saved (status: created). Label ID: ${inserted.id}. Saved ${brand} - ${productName}${variant ? ` (${variant})` : ""}.`;
}

async function executeManageNutritionLabel(
  params: Record<string, unknown>,
  userId: string,
  log?: Logger,
): Promise<string> {
  const action = String(params.action);
  const labelId = Number(params.label_id);

  if (action === "delete") {
    const deleted = await deleteLabel(userId, labelId, log);
    if (!deleted) return `Label not found (ID: ${labelId}).`;
    return `Deleted label [label:${labelId}].`;
  }

  if (action === "update") {
    const updateFields = (params.update_fields as Record<string, unknown>) ?? {};
    const data: Record<string, unknown> = {};
    if (updateFields.brand !== undefined) data.brand = String(updateFields.brand);
    if (updateFields.product_name !== undefined) data.productName = String(updateFields.product_name);
    if (updateFields.variant !== undefined) data.variant = updateFields.variant;
    if (updateFields.serving_size_g !== undefined) data.servingSizeG = Number(updateFields.serving_size_g);
    if (updateFields.serving_size_label !== undefined) data.servingSizeLabel = String(updateFields.serving_size_label);
    if (updateFields.calories !== undefined) data.calories = Number(updateFields.calories);
    if (updateFields.protein_g !== undefined) data.proteinG = Number(updateFields.protein_g);
    if (updateFields.carbs_g !== undefined) data.carbsG = Number(updateFields.carbs_g);
    if (updateFields.fat_g !== undefined) data.fatG = Number(updateFields.fat_g);
    if (updateFields.fiber_g !== undefined) data.fiberG = Number(updateFields.fiber_g);
    if (updateFields.sodium_mg !== undefined) data.sodiumMg = Number(updateFields.sodium_mg);
    if (updateFields.saturated_fat_g !== undefined) data.saturatedFatG = updateFields.saturated_fat_g != null ? Number(updateFields.saturated_fat_g) : null;
    if (updateFields.trans_fat_g !== undefined) data.transFatG = updateFields.trans_fat_g != null ? Number(updateFields.trans_fat_g) : null;
    if (updateFields.sugars_g !== undefined) data.sugarsG = updateFields.sugars_g != null ? Number(updateFields.sugars_g) : null;
    if (updateFields.extra_nutrients !== undefined) data.extraNutrients = updateFields.extra_nutrients;
    if (updateFields.notes !== undefined) data.notes = updateFields.notes;

    try {
      const updated = await updateLabel(userId, labelId, data as Parameters<typeof updateLabel>[2], log);
      const variant = updated.variant ? ` (${updated.variant})` : "";
      return `Updated label [label:${updated.id}]: ${updated.brand} - ${updated.productName}${variant} | Cal: ${updated.calories} | P: ${updated.proteinG}g C: ${updated.carbsG}g F: ${updated.fatG}g.`;
    } catch (error) {
      if (error instanceof Error && error.message === "Label not found") {
        return `Label not found (ID: ${labelId}).`;
      }
      throw error;
    }
  }

  throw new Error(`Unknown manage_nutrition_label action: ${action}`);
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
      case "search_nutrition_labels":
        return executeSearchNutritionLabels(params, userId, l);
      case "save_nutrition_label":
        return executeSaveNutritionLabel(params, userId, l);
      case "manage_nutrition_label":
        return executeManageNutritionLabel(params, userId, l);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  })();
  l.debug({ action: "execute_tool_result", tool: toolName, resultLength: result.length }, "data tool execution complete");
  return result;
}
