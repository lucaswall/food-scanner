/**
 * Tool schemas for Claude API calls.
 * Extracted from claude.ts so the barrel (claude.ts) can re-export without
 * bundling all Claude API logic into every import site.
 *
 * This file must NOT import from @/lib/claude (no circular deps).
 */
import type Anthropic from "@anthropic-ai/sdk";

/** Server-side web search tool (GA release — no beta header required). */
export const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
} as const;

/** Tool schema for reporting a food analysis (single entry, create or edit). */
export const REPORT_NUTRITION_TOOL: Anthropic.Tool = {
  name: "report_nutrition",
  description:
    "Report the nutritional analysis of food for creating a new log entry or editing an existing one. Set editing_entry_id to the existing entry ID when editing, or null when creating new food.",
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
      serving_unit: {
        type: "string",
        enum: ["g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "serving"],
        description: "Serving unit. Choose the most natural unit for the food: g=grams (solid food by weight), oz=ounces, cup=cups (beverages, liquids), tbsp=tablespoons, tsp=teaspoons, ml=milliliters, slice=slices (pizza, bread), serving=servings (individual packaged items).",
      },
      calories: { type: "number" },
      protein_g: { type: "number" },
      carbs_g: { type: "number" },
      fat_g: { type: "number" },
      fiber_g: { type: "number" },
      sodium_mg: { type: "number" },
      saturated_fat_g: {
        type: "number",
        description: "Estimated saturated fat in grams. Always provide your best estimate.",
      },
      trans_fat_g: {
        type: "number",
        description: "Estimated trans fat in grams. Always provide your best estimate (0 if likely none).",
      },
      sugars_g: {
        type: "number",
        description: "Estimated sugars in grams. Always provide your best estimate.",
      },
      calories_from_fat: {
        type: "number",
        description: "Estimated calories from fat. Always provide your best estimate (fat_g × 9).",
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
      editing_entry_id: {
        type: ["number", "null"],
        description: "Set to the [entry:N] value from search_food_log results when the user asks to edit an existing entry (e.g. 'edit that', 'change the chicken to 200g', 'update my lunch'). Note: [entry:N] is the food log entry ID, different from [id:N] which is the food definition ID. Set to null when creating new food.",
      },
      date: {
        type: "string",
        description: "Date in YYYY-MM-DD format. Use today's date (provided in the conversation) for new entries unless the user explicitly mentions a different date. When editing an existing entry (editing_entry_id is set), use the original entry's date unless the user asks to change it.",
      },
      time: {
        type: ["string", "null"],
        description: "Meal time in HH:mm format (24h). Only set when the user explicitly mentions a time (e.g., 'I had this at 8:30', 'breakfast was at 7am'). Set to null otherwise — never guess the time.",
      },
      meal_type_id: {
        type: "number",
        description: "Meal type: 1=Breakfast, 2=Morning Snack, 3=Lunch, 4=Afternoon Snack, 5=Dinner, 7=Anytime. Always suggest based on current time, today's logged meals, and food type. When editing an existing entry, preserve the original value unless user asks to change it.",
      },
    },
    required: [
      "food_name",
      "amount",
      "serving_unit",
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
      "editing_entry_id",
      "date",
      "time",
      "meal_type_id",
    ],
  },
  input_examples: [
    {
      food_name: "Milanesa de pollo con puré",
      amount: 350, serving_unit: "g", calories: 620, protein_g: 38, carbs_g: 45, fat_g: 30,
      fiber_g: 3, sodium_mg: 680, saturated_fat_g: 8, trans_fat_g: 0.5, sugars_g: 2,
      calories_from_fat: 270, confidence: "high", notes: "Breaded chicken cutlet with mashed potatoes, typical Argentine portion",
      keywords: ["milanesa", "pollo", "pure"], description: "Breaded chicken cutlet with creamy mashed potatoes, golden brown coating",
      source_custom_food_id: null, editing_entry_id: null, date: "2026-03-28", time: null, meal_type_id: 3,
    },
    {
      food_name: "Café con leche",
      amount: 1, serving_unit: "cup", calories: 60, protein_g: 3, carbs_g: 5, fat_g: 3,
      fiber_g: 0, sodium_mg: 50, saturated_fat_g: 2, trans_fat_g: 0, sugars_g: 5,
      calories_from_fat: 27, confidence: "medium", notes: "Standard café con leche, assumed whole milk",
      keywords: ["cafe", "leche"], description: "Coffee with steamed whole milk in a standard cup",
      source_custom_food_id: 42, editing_entry_id: null, date: "2026-03-28", time: null, meal_type_id: 1,
    },
    {
      food_name: "Pizza de muzzarella (2 porciones)",
      amount: 2, serving_unit: "slice", calories: 540, protein_g: 22, carbs_g: 60, fat_g: 24,
      fiber_g: 3, sodium_mg: 1100, saturated_fat_g: 10, trans_fat_g: 0, sugars_g: 6,
      calories_from_fat: 216, confidence: "medium", notes: "Editing to change from 1 to 2 slices",
      keywords: ["pizza", "muzzarella"], description: "Two slices of classic Argentine muzzarella pizza",
      source_custom_food_id: null, editing_entry_id: 157, date: "2026-03-27", time: "21:00", meal_type_id: 5,
    },
  ],
};

/** Tool schema for reporting all food items identified in a multi-capture triage session. */
export const REPORT_SESSION_ITEMS_TOOL: Anthropic.Tool = {
  name: "report_session_items",
  description:
    "Report all distinct food items identified across all captures in this session. Call this with the complete list of items found. When the user asks to modify the list (combine, split, remove, add, adjust), call this again with the updated list.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false as const,
    properties: {
      items: {
        type: "array",
        description: "All distinct food items identified across all captures in this session",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            food_name: {
              type: "string",
              description: "Clear name of the food in Spanish or English",
            },
            amount: {
              type: "number",
              description: "Estimated quantity in the chosen unit",
            },
            serving_unit: {
              type: "string",
              enum: ["g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "serving"],
              description: "Serving unit. Choose the most natural unit: g=grams, oz=ounces, cup=cups, tbsp=tablespoons, tsp=teaspoons, ml=milliliters, slice=slices, serving=servings.",
            },
            calories: { type: "number" },
            protein_g: { type: "number" },
            carbs_g: { type: "number" },
            fat_g: { type: "number" },
            fiber_g: { type: "number" },
            sodium_mg: { type: "number" },
            saturated_fat_g: {
              type: "number",
              description: "Estimated saturated fat in grams. Always provide your best estimate.",
            },
            trans_fat_g: {
              type: "number",
              description: "Estimated trans fat in grams. Always provide your best estimate (0 if likely none).",
            },
            sugars_g: {
              type: "number",
              description: "Estimated sugars in grams. Always provide your best estimate.",
            },
            calories_from_fat: {
              type: "number",
              description: "Estimated calories from fat (fat_g × 9). Always provide your best estimate.",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            notes: {
              type: "string",
              description: "Brief explanation of assumptions made, including portion/sharing context from notes",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "3 to 5 lowercase single-word tokens identifying this food for matching.",
            },
            description: {
              type: "string",
              description: "Describe the food in 1-2 concise sentences with visible ingredients, preparation method, and portion size.",
            },
            time: {
              type: "string",
              description: "Meal time in HH:mm format (24h) from the capture timestamp of the most relevant photo for this item.",
            },
            date: {
              type: "string",
              description: "Date in YYYY-MM-DD format from the capture date of the most relevant photo for this item.",
            },
            meal_type_id: {
              type: "number",
              description: "Meal type: 1=Breakfast, 2=Morning Snack, 3=Lunch, 4=Afternoon Snack, 5=Dinner, 7=Anytime. Assign based on capture time.",
            },
            capture_indices: {
              type: "array",
              items: { type: "number" },
              description: "Which capture indices (0-based) this item came from, for UI display purposes.",
            },
          },
          required: [
            "food_name",
            "amount",
            "serving_unit",
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
            "time",
            "date",
            "meal_type_id",
            "capture_indices",
          ],
        },
      },
    },
    required: ["items"],
  },
};
