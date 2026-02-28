import { successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { CLAUDE_MODEL } from "@/lib/claude";
import packageJson from "../../../../package.json";

export async function GET() {
  const log = createRequestLogger("GET", "/api/health");
  log.debug({ action: "health_check" }, "health check");

  const appUrl = process.env.APP_URL ?? "";
  const environment = appUrl.includes("food-test") ? "Staging" : "Production";
  const fitbitMode = process.env.FITBIT_DRY_RUN === "true" ? "Dry Run" : "Live";
  const commitHash = process.env.COMMIT_SHA ?? "";
  const version =
    environment === "Staging" && commitHash
      ? `${packageJson.version}+${commitHash}`
      : packageJson.version;

  return successResponse({
    status: "ok",
    version,
    environment,
    fitbitMode,
    claudeModel: CLAUDE_MODEL,
    commitHash,
  });
}
