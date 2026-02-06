/**
 * fitbit_get_frequent_foods - Get user's frequently logged foods
 * GET /1/user/-/foods/log/frequent.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_frequent_foods',
  description: 'Get the user\'s list of frequently logged foods on Fitbit.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getFrequentFoods(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/foods/log/frequent.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting frequent foods: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
