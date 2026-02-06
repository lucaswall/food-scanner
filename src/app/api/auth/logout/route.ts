import { getSession, getRawSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function POST() {
  const session = await getSession();

  if (session) {
    await session.destroy();
    logger.info({ action: "logout" }, "user logged out");
  } else {
    // No valid DB session, but still clear the iron-session cookie
    // to prevent zombie cookies from causing repeated failed DB lookups
    const rawSession = await getRawSession();
    rawSession.destroy();
    logger.info({ action: "logout", stale: true }, "cleared stale session cookie");
  }

  return successResponse({ message: "Logged out" });
}
