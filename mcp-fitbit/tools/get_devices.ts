/**
 * fitbit_get_devices - Get connected Fitbit devices
 * GET /1/user/-/devices.json
 */

import { fitbitGet } from '../fitbit-client.js';
import type { ToolResponse } from './types.js';

export const schema = {
  name: 'fitbit_get_devices',
  description:
    'Get list of connected Fitbit devices. Returns device type, battery level, ' +
    'last sync time, firmware version, and device ID for each paired device.',
  inputSchema: {
    type: 'object',
    properties: {},
    required: [],
  },
} as const;

export async function getDevices(): Promise<ToolResponse> {
  try {
    const data = await fitbitGet('/1/user/-/devices.json');
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
      isError: false,
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error getting devices: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
