/**
 * Authenticated HTTP client for Fitbit API (read-only)
 */

import { getAccessToken } from './auth.js';

const FITBIT_API_BASE = 'https://api.fitbit.com';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Make an authenticated GET request to the Fitbit API.
 * Automatically includes the access token and handles timeouts.
 */
export async function fitbitGet(path: string): Promise<unknown> {
  const accessToken = await getAccessToken();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url = `${FITBIT_API_BASE}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Fitbit API ${response.status}: ${body.slice(0, 500)}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
