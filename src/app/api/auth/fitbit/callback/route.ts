import { getIronSession } from "iron-session";
import { exchangeFitbitCode } from "@/lib/fitbit";
import { errorResponse } from "@/lib/api-response";
import { sessionOptions } from "@/lib/session";
import type { SessionData } from "@/types";

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getCookieValue(request, "fitbit-oauth-state");

  if (!code || !state || state !== storedState) {
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  const redirectUri = new URL(
    "/api/auth/fitbit/callback",
    request.url,
  ).toString();

  let tokens: {
    access_token: string;
    refresh_token: string;
    user_id: string;
    expires_in: number;
  };
  try {
    tokens = await exchangeFitbitCode(code, redirectUri);
  } catch {
    return errorResponse(
      "FITBIT_TOKEN_INVALID",
      "Failed to exchange Fitbit authorization code",
      400,
    );
  }

  // Read existing session from request cookies, write updated cookie to response
  const responseHeaders = new Headers();
  const session = await getIronSession<SessionData>(
    { headers: request.headers } as never,
    sessionOptions,
  );

  session.fitbit = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userId: tokens.user_id,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };

  // Save to a response-oriented session to set the cookie
  const responseSession = await getIronSession<SessionData>(
    { headers: responseHeaders } as never,
    sessionOptions,
  );
  Object.assign(responseSession, {
    sessionId: session.sessionId,
    email: session.email,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    fitbit: session.fitbit,
  });
  await responseSession.save();

  // Clear the OAuth state cookie
  responseHeaders.append(
    "Set-Cookie",
    "fitbit-oauth-state=; Path=/; HttpOnly; Max-Age=0",
  );

  responseHeaders.set(
    "Location",
    new URL("/app", request.url).toString(),
  );

  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  });
}
