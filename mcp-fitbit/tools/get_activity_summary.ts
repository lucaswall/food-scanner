/**
 * fitbit_get_activity_summary - Get daily activity summary
 * GET /1/user/-/activities/date/{date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_activity_summary',
  description:
    'Get daily activity summary for a specific date. Returns steps, calories burned, distance, ' +
    'floors, active minutes (sedentary, lightly active, fairly active, very active), and activity goals.',
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

interface GetActivitySummaryInput {
  date: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getActivitySummary(
  args: GetActivitySummaryInput,
): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const data = await fitbitGet(`/1/user/-/activities/date/${date}.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting activity summary: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
