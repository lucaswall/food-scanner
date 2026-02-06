/**
 * fitbit_get_hrv - Get heart rate variability summary
 * GET /1/user/-/hrv/date/{date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_hrv',
  description:
    'Get heart rate variability (HRV) summary for a single date. Returns RMSSD and coverage values measured during sleep.',
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

interface GetHrvInput {
  date: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getHrv(args: GetHrvInput): Promise<ToolResponse> {
  try {
    const date = resolveDate(args.date);
    const data = await fitbitGet(`/1/user/-/hrv/date/${date}.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting HRV: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
