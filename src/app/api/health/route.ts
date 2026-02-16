import { successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";

export async function GET() {
  const log = createRequestLogger("GET", "/api/health");
  log.debug({ action: "health_check" }, "health check");
  return successResponse({ status: "ok" });
}
