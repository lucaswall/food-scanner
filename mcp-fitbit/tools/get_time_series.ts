/**
 * fitbit_get_time_series - Get time series data for any supported resource
 * GET /1/user/-/{resource-path}/date/{start}/{end}.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

const VALID_RESOURCES = [
  // Activity
  'activities/steps',
  'activities/calories',
  'activities/caloriesBMR',
  'activities/distance',
  'activities/floors',
  'activities/elevation',
  'activities/minutesSedentary',
  'activities/minutesLightlyActive',
  'activities/minutesFairlyActive',
  'activities/minutesVeryActive',
  'activities/activityCalories',
  // Nutrition
  'foods/log/caloriesIn',
  'foods/log/water',
  // Body
  'body/weight',
  'body/bmi',
  'body/fat',
  // Heart rate (uses different endpoint format)
  'activities/heart',
] as const;

const VALID_PERIODS = ['1d', '7d', '30d', '1w', '1m', '3m', '6m', '1y'] as const;

export const schema = {
  name: 'fitbit_get_time_series',
  description:
    'Get time series data for a Fitbit resource over a date range. ' +
    'Supports activity metrics (steps, calories, distance, floors, active minutes), ' +
    'nutrition (caloriesIn, water), body (weight, bmi, fat), and heart rate. ' +
    'Use either a period (1d, 7d, 30d, 1m, 3m, 6m, 1y) or an explicit end date.',
  inputSchema: {
    type: 'object',
    properties: {
      resource: {
        type: 'string',
        description:
          'Resource path. Options: ' + VALID_RESOURCES.join(', '),
        enum: VALID_RESOURCES,
      },
      startDate: {
        type: 'string',
        description:
          'Start date in yyyy-MM-dd format (e.g., 2025-01-01). Use "today" for current date.',
      },
      endDate: {
        type: 'string',
        description:
          'End date in yyyy-MM-dd format. Mutually exclusive with period.',
      },
      period: {
        type: 'string',
        description:
          'Time period relative to startDate. Options: 1d, 7d, 30d, 1w, 1m, 3m, 6m, 1y. ' +
          'Mutually exclusive with endDate.',
        enum: VALID_PERIODS,
      },
    },
    required: ['resource', 'startDate'],
  },
} as const;

interface GetTimeSeriesInput {
  resource: string;
  startDate: string;
  endDate?: string;
  period?: string;
}

function resolveDate(date: string): string {
  if (date === 'today') {
    return new Date().toISOString().split('T')[0];
  }
  return date;
}

export async function getTimeSeries(args: GetTimeSeriesInput): Promise<ToolResponse> {
  try {
    if (!VALID_RESOURCES.includes(args.resource as (typeof VALID_RESOURCES)[number])) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid resource: ${args.resource}. Valid options: ${VALID_RESOURCES.join(', ')}`,
          },
        ],
        isError: true,
      };
    }

    const start = resolveDate(args.startDate);
    const rangeEnd = args.endDate
      ? resolveDate(args.endDate)
      : args.period || '1d';

    const data = await fitbitGet(
      `/1/user/-/${args.resource}/date/${start}/${rangeEnd}.json`,
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting time series: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
