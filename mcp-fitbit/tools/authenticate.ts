/**
 * fitbit_authenticate - Check auth status or trigger OAuth flow
 */

import { getAuthStatus, startOAuthFlow } from '../auth.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_authenticate',
  description:
    'Check Fitbit authentication status or trigger OAuth authorization. ' +
    'Call without arguments to check status. Set force=true to start a new OAuth flow ' +
    '(opens browser). Must be called before using other Fitbit tools if not yet authenticated.',
  inputSchema: {
    type: 'object',
    properties: {
      force: {
        type: 'boolean',
        description: 'Force a new OAuth flow even if already authenticated',
      },
    },
    required: [],
  },
} as const;

interface AuthenticateInput {
  force?: boolean;
}

export async function authenticate(args: AuthenticateInput): Promise<ToolResponse> {
  try {
    const status = await getAuthStatus();

    if (status.authenticated && !args.force) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'authenticated',
                userId: status.userId,
                expiresAt: status.expiresAt,
                needsRefresh: status.needsRefresh,
              },
              null,
              2,
            ),
          },
        ],
        isError: false,
      };
    }

    // Start OAuth flow
    const tokens = await startOAuthFlow();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'authenticated',
              userId: tokens.user_id,
              message: 'Successfully authenticated with Fitbit',
            },
            null,
            2,
          ),
        },
      ],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
