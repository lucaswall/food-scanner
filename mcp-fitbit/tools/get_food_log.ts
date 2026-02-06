/**
 * fitbit_get_food_log - Get food log for a date
 * GET /1/user/-/foods/log/date/{date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_food_log',
  description:
    'Get the food log for a specific date. Returns all logged food items with nutritional details ' +
    '(calories, protein, carbs, fat, fiber, sodium), daily goals, and summary totals.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date in yyyy-MM-dd format (e.g., 2025-01-15). Use "today" for current date.',
      },
    },
    required: ['date'],
  },
} as const;

interface GetFoodLogInput {
  date: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getFoodLog(args: GetFoodLogInput): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const data = await fitbitGet(`/1/user/-/foods/log/date/${date}.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting food log: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
