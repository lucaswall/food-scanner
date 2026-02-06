/**
 * fitbit_get_temperature - Get temperature (core or skin) summary
 * GET /1/user/-/temp/core/date/{date}.json
 * GET /1/user/-/temp/skin/date/{date}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

const VALID_TYPES = ['core', 'skin'] as const;

export const schema = {
  name: 'fitbit_get_temperature',
  description:
    'Get temperature summary for a single date. Supports core temperature and skin temperature readings.',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        description: 'Temperature type: "core" or "skin".',
        enum: VALID_TYPES,
      },
      date: {
        type: 'string',
        description: 'Date in yyyy-MM-dd format (e.g., 2025-01-15). Use "today" for current date.',
      },
    },
    required: ['type', 'date'],
  },
} as const;

interface GetTemperatureInput {
  type: string;
  date: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getTemperature(args: GetTemperatureInput): Promise<ToolResponse> {
  try {
    if (!VALID_TYPES.includes(args.type as (typeof VALID_TYPES)[number])) {
      return {
        content: [
          { type: 'text', text: `Invalid type: ${args.type}. Use "core" or "skin".` },
        ],
        isError: true,
      };
    }
    const date = resolveDate(args.date);
    const data = await fitbitGet(`/1/user/-/temp/${args.type}/date/${date}.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting temperature: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
