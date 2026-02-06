import { buildGoogleAuthUrl } from "@/lib/auth";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";
import { getRawSession } from "@/lib/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { errorResponse } from "@/lib/api-response";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed } = checkRateLimit(`google-oauth:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    logger.warn({ action: "rate_limit_exceeded", ip, endpoint: "google_oauth" }, "rate limit exceeded");
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests", 429);
  }

  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/google/callback");
  const authUrl = buildGoogleAuthUrl(state, redirectUri);

  // Store state in iron-session (encrypted cookie) instead of plain cookie
  const rawSession = await getRawSession();
  rawSession.oauthState = state;
  await rawSession.save();

  logger.info({ action: "google_oauth_start" }, "initiating google oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
    },
  });
}
