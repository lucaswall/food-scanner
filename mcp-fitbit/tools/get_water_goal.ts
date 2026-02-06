/**
 * fitbit_get_water_goal - Get daily water intake goal
 * GET /1/user/-/foods/log/water/goal.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_water_goal',
  description: 'Get the user\'s daily water intake goal.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getWaterGoal(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/foods/log/water/goal.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting water goal: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
