/**
 * fitbit_get_body_fat_log - Get body fat log for a date
 * GET /1/user/-/body/log/fat/date/{date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_body_fat_log',
  description: 'Get body fat log entries for a specific date. Returns logged body fat percentage values.',
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

interface GetBodyFatLogInput {
  date: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getBodyFatLog(args: GetBodyFatLogInput): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const data = await fitbitGet(`/1/user/-/body/log/fat/date/${date}.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting body fat log: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
