/**
 * fitbit_get_body_goals - Get body weight or fat goals
 * GET /1/user/-/body/log/{goal-type}/goal.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

const VALID_GOAL_TYPES = ['weight', 'fat'] as const;

export const schema = {
  name: 'fitbit_get_body_goals',
  description: 'Get the user\'s body weight or body fat goal.',
  inputSchema: {
    type: 'object',
    properties: {
      goalType: {
        type: 'string',
        description: 'Goal type: "weight" or "fat".',
        enum: VALID_GOAL_TYPES,
      },
    },
    required: ['goalType'],
  },
} as const;

interface GetBodyGoalsInput {
  goalType: string;
}

export async function getBodyGoals(args: GetBodyGoalsInput): Promise<ToolResponse> {
  try {
    if (!VALID_GOAL_TYPES.includes(args.goalType as (typeof VALID_GOAL_TYPES)[number])) {
      return {
        content: [
          { type: 'text', text: `Invalid goal type: ${args.goalType}. Use "weight" or "fat".` },
        ],
        isError: true,
      };
    }
    const data = await fitbitGet(`/1/user/-/body/log/${args.goalType}/goal.json`);
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting body goals: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
