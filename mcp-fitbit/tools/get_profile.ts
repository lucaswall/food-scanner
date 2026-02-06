/**
 * fitbit_get_profile - Get user profile
 * GET /1/user/-/profile.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_profile',
  description: 'Get the authenticated Fitbit user profile including display name, age, timezone, and account settings.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getProfile(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/profile.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting profile: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
