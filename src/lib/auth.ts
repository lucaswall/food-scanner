import { logger } from "@/lib/logger";
import { getRequiredEnv } from "@/lib/env";
import { parseErrorBody, sanitizeErrorBody, jsonWithTimeout } from "@/lib/http";

const OAUTH_TIMEOUT_MS = 10000;

export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
];

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

export function buildGoogleHealthAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_HEALTH_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface ExchangeGoogleCodeResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

export interface ExchangeGoogleHealthCodeResult {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
}

export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<ExchangeGoogleCodeResult> {
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

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Google token response: missing access_token");
    }
    return {
      access_token: data.access_token,
      refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function exchangeGoogleHealthCode(
  code: string,
  redirectUri: string,
): Promise<ExchangeGoogleHealthCodeResult> {
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
        { action: "google_health_token_exchange_failed", status: response.status, statusText: response.statusText },
        "google health token exchange http failure",
      );
      throw new Error(`Google Health token exchange failed: ${response.status}`);
    }

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    if (typeof data.access_token !== "string") {
      throw new Error("Invalid Google Health token response: missing access_token");
    }
    if (typeof data.refresh_token !== "string") {
      throw new Error("Invalid Google Health token response: missing refresh_token");
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: typeof data.expires_in === "number" ? data.expires_in : undefined,
      scope: typeof data.scope === "string" ? data.scope : undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getGoogleProfile(
  accessToken: string,
): Promise<{ email: string; name: string; emailVerified: boolean }> {
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
      const rawBody = await parseErrorBody(response);
      const errorBody = sanitizeErrorBody(rawBody);
      logger.error(
        { action: "google_profile_fetch_failed", status: response.status, errorBody },
        "google profile fetch http failure",
      );
      throw new Error(`Google profile fetch failed: ${response.status}`);
    }

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    if (typeof data.email !== "string") {
      throw new Error("Invalid Google profile response: missing email");
    }
    if (typeof data.name !== "string") {
      throw new Error("Invalid Google profile response: missing name");
    }
    const emailVerified = data.email_verified === true || data.email_verified === "true";
    return { email: data.email, name: data.name, emailVerified };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getGoogleHealthIdentity(accessToken: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OAUTH_TIMEOUT_MS);

  try {
    const response = await fetch("https://health.googleapis.com/v4/users/me/identity", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    if (!response.ok) {
      const rawBody = await parseErrorBody(response);
      const errorBody = sanitizeErrorBody(rawBody);
      logger.error(
        { action: "google_health_identity_fetch_failed", status: response.status, errorBody },
        "google health identity fetch http failure",
      );
      throw new Error(`Google Health identity fetch failed: ${response.status}`);
    }

    const data = await jsonWithTimeout<Record<string, unknown>>(response);
    // Real v4 getIdentity shape is { name, legacyUserId, healthUserId } — there is
    // no `userId` field. healthUserId is the stable identity we persist.
    if (typeof data.healthUserId !== "string") {
      throw new Error("Invalid Google Health identity response: missing healthUserId");
    }
    return data.healthUserId;
  } finally {
    clearTimeout(timeoutId);
  }
}
