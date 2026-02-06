/**
 * fitbit_get_favorite_foods - Get user's favorite foods
 * GET /1/user/-/foods/log/favorite.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_favorite_foods',
  description: 'Get the user\'s list of favorite foods on Fitbit.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getFavoriteFoods(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/foods/log/favorite.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting favorite foods: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
