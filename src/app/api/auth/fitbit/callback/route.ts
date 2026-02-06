import { cookies } from "next/headers";
import { exchangeFitbitCode } from "@/lib/fitbit";
import { errorResponse } from "@/lib/api-response";
import { getSession } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";
import { getCookieValue } from "@/lib/cookies";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getCookieValue(request, "fitbit-oauth-state");

  if (!code || !state || state !== storedState) {
    logger.warn({ action: "fitbit_callback_invalid_state" }, "invalid fitbit oauth state");
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  const redirectUri = buildUrl("/api/auth/fitbit/callback");

  let tokens: {
    access_token: string;
    refresh_token: string;
    user_id: string;
    expires_in: number;
  };
  try {
    tokens = await exchangeFitbitCode(code, redirectUri);
  } catch (error) {
    logger.error(
      { action: "fitbit_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
      "failed to exchange fitbit authorization code",
    );
    return errorResponse(
      "FITBIT_TOKEN_INVALID",
      "Failed to exchange Fitbit authorization code",
      400,
    );
  }

  // Read and update session using cookies() store
  const session = await getSession();

  if (!session.sessionId) {
    logger.warn({ action: "fitbit_callback_no_session" }, "fitbit callback without authenticated session");
    return errorResponse("AUTH_MISSING_SESSION", "No authenticated session", 401);
  }

  session.fitbit = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    userId: tokens.user_id,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await session.save();

  // Clear the OAuth state cookie
  const cookieStore = await cookies();
  cookieStore.delete("fitbit-oauth-state");

  logger.info({ action: "fitbit_connect_success" }, "fitbit connected successfully");

  return Response.redirect(buildUrl("/app"), 302);
}
