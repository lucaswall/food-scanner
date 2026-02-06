import { getSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function POST() {
  const session = await getSession();

  if (session) {
    await session.destroy();
  }

  logger.info({ action: "logout" }, "user logged out");

  return successResponse({ message: "Logged out" });
}
