/**
 * fitbit_get_recent_foods - Get user's recently logged foods
 * GET /1/user/-/foods/log/recent.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_recent_foods',
  description: 'Get the user\'s list of recently logged foods on Fitbit.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getRecentFoods(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/foods/log/recent.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting recent foods: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
