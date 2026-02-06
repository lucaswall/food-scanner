/**
 * fitbit_get_food_goals - Get daily food/calorie goals
 * GET /1/user/-/foods/log/goal.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_food_goals',
  description: 'Get the user\'s daily food and calorie goals.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getFoodGoals(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/foods/log/goal.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting food goals: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
