/**
 * fitbit_get_breathing_rate - Get breathing rate summary
 * GET /1/user/-/br/date/{date}.json
 * GET /1/user/-/br/date/{start-date}/{end-date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_breathing_rate',
  description:
    'Get breathing rate summary for a single date or a date range (max 30 days). ' +
    'Returns breathing rate values measured during sleep.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date in yyyy-MM-dd format (e.g., 2025-01-15). Use "today" for current date.',
      },
      endDate: {
        type: 'string',
        description: 'Optional end date for a range (max 30 days). If omitted, returns single-day data.',
      },
    },
    required: ['date'],
  },
} as const;

interface GetBreathingRateInput {
  date: string;
  endDate?: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getBreathingRate(args: GetBreathingRateInput): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const path = args.endDate
      ? `/1/user/-/br/date/${date}/${resolveDate(args.endDate)}.json`
      : `/1/user/-/br/date/${date}.json`;
    const data = await fitbitGet(path);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting breathing rate: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
