import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";

const OAUTH_TIMEOUT_MS = 10000;

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<{ access_token: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
        client_secret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error(
        { action: "google_token_exchange_failed", status: response.status, statusText: response.statusText },
        "google token exchange http failure",
      );
      throw new Error(`Google token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Google token response: missing access_token");
    }
    return data as { access_token: string };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getGoogleProfile(
  accessToken: string,
): Promise<{ email: string; name: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

  try {
    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "unable to read body");
      let errorBody: unknown;
      try {
        errorBody = JSON.parse(bodyText);
      } catch {
        errorBody = bodyText;
      }
      logger.error(
        { action: "google_profile_fetch_failed", status: response.status, errorBody },
        "google profile fetch http failure",
      );
      throw new Error(`Google profile fetch failed: ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.email !== "string") {
      throw new Error("Invalid Google profile response: missing email");
    }
    if (typeof data.name !== "string") {
      throw new Error("Invalid Google profile response: missing name");
    }
    return data as { email: string; name: string };
  } finally {
    clearTimeout(timeoutId);
  }
}
