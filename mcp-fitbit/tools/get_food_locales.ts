/**
 * fitbit_get_food_locales - Get available food locales
 * GET /1/foods/locales.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_food_locales',
  description: 'Get available food locales used to search, log, or create food on Fitbit.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getFoodLocales(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/foods/locales.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting food locales: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
