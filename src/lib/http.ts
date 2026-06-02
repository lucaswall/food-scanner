/**
 * Provider-neutral HTTP helpers shared by the Google Health transport module
 * and the Google OAuth flow (auth.ts).
 */

/** Response body read timeout (ms). */
export const REQUEST_TIMEOUT_MS = 10000;

export function sanitizeErrorBody(body: unknown): unknown {
  if (typeof body === "string") {
    return body.replace(/<[^>]*>/g, "").slice(0, 500);
  }
  return body;
}

export async function parseErrorBody(response: Response): Promise<unknown> {
  const bodyText = await response.text().catch(() => "unable to read body");
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

export async function jsonWithTimeout<T>(response: Response, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const jsonPromise = response.json().then((v) => v as T);
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("Response body read timed out")), timeoutMs);
  });
  // Attach noop catch handlers to prevent unhandled rejection from losing promise
  jsonPromise.catch(() => {});
  timeoutPromise.catch(() => {});
  try {
    return await Promise.race([jsonPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
