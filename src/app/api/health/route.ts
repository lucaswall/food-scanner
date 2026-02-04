import { successResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function GET() {
  logger.debug({ action: "health_check" }, "health check");
  return successResponse({ status: "ok" });
}
