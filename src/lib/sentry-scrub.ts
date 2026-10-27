import type { Event } from "@sentry/nextjs";

const SENSITIVE_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "x-api-key",
]);

/**
 * Strip credentials and payloads from a server-side Sentry event: session cookies,
 * Authorization / API-key headers and request bodies (which can carry base64 images or
 * food data). Used for errors and transactions alike.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  const request = event.request;
  if (!request) return event;

  delete request.cookies;
  delete request.data;

  if (request.headers) {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (!SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = value;
    }
    request.headers = headers;
  }

  return event;
}
