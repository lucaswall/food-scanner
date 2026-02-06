/**
 * fitbit_get_spo2 - Get SpO2 (blood oxygen) summary
 * GET /1/user/-/spo2/date/{date}.json
 * GET /1/user/-/spo2/date/{start-date}/{end-date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_spo2',
  description:
    'Get SpO2 (blood oxygen saturation) summary for a single date or a date range. ' +
    'Returns average, min, and max SpO2 values.',
  inputSchema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Date in yyyy-MM-dd format (e.g., 2025-01-15). Use "today" for current date.',
      },
      endDate: {
        type: 'string',
        description: 'Optional end date for a range. If omitted, returns single-day data.',
      },
    },
    required: ['date'],
  },
} as const;

interface GetSpO2Input {
  date: string;
  endDate?: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getSpO2(args: GetSpO2Input): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const path = args.endDate
      ? `/1/user/-/spo2/date/${date}/${resolveDate(args.endDate)}.json`
      : `/1/user/-/spo2/date/${date}.json`;
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
          text: `Error getting SpO2: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
