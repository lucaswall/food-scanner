/**
 * fitbit_get_meals - Get user's saved meals
 * GET /1/user/-/meals.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_meals',
  description: 'Get the user\'s saved meals on Fitbit. Returns meal names and their food contents with nutritional info.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getMeals(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/meals.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting meals: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
