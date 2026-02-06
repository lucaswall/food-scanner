/**
 * fitbit_get_food_units - Get all valid food measurement units
 * GET /1/foods/units.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_food_units',
  description:
    'Get all valid Fitbit food measurement units with their IDs, names, and plural forms. ' +
    'Useful for looking up unit IDs needed when creating or logging foods.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getFoodUnits(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/foods/units.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting food units: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
