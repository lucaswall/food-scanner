import type { SessionData } from "@/types";

export function buildFitbitAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: process.env.FITBIT_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "nutrition",
    state,
  });

  return `https://www.fitbit.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeFitbitCode(
  code: string,
  redirectUri: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(
    `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Fitbit token exchange failed: ${response.status}`);
  }

  return response.json();
}

export async function refreshFitbitToken(
  refreshToken: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  user_id: string;
  expires_in: number;
}> {
  const credentials = Buffer.from(
    `${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch("https://api.fitbit.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("FITBIT_TOKEN_INVALID");
  }

  return response.json();
}

export async function ensureFreshToken(
  session: SessionData,
): Promise<string> {
  if (!session.fitbit) {
    throw new Error("FITBIT_TOKEN_INVALID");
  }

  // If token expires within 1 hour, refresh it
  if (session.fitbit.expiresAt < Date.now() + 60 * 60 * 1000) {
    const tokens = await refreshFitbitToken(session.fitbit.refreshToken);
    session.fitbit = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      userId: tokens.user_id,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
  }

  return session.fitbit.accessToken;
}
