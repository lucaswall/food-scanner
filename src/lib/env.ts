const REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ANTHROPIC_API_KEY",
  "APP_URL",
  "ALLOWED_EMAILS",
  "DATABASE_URL",
] as const;

export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

export function validateRequiredEnvVars(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    throw new Error(message);
  }
}

export function getAllowedEmails(): string[] {
  const raw = getRequiredEnv("ALLOWED_EMAILS");
  return raw
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

export function isEmailAllowed(email: string): boolean {
  const allowed = getAllowedEmails();
  return allowed.some((a) => a.toLowerCase() === email.toLowerCase());
}

/**
 * Validates HEALTH_DRY_RUN against the current environment (APP_URL).
 *
 * Rules:
 * - Unrecognized values (not "true", "false", or unset/empty) are rejected on any environment.
 * - Staging (APP_URL contains "food-test"): HEALTH_DRY_RUN must be "true".
 *   A typo'd or missing flag would silently enable live writes against real user data.
 * - Production (APP_URL contains "food.lucaswall.me" but not "food-test"):
 *   HEALTH_DRY_RUN must be explicitly "true" or "false" (unset = ambiguous).
 * - Local / dev (all other APP_URLs): no constraint.
 *
 * Call from instrumentation.ts at boot, alongside validateRequiredEnvVars().
 */
export function validateHealthDryRunEnv(): void {
  const appUrl = process.env.APP_URL ?? "";
  const rawValue = process.env.HEALTH_DRY_RUN;
  // Normalise: treat empty string the same as unset
  const effective = rawValue === "" ? undefined : rawValue;

  // Reject unrecognized values on every environment — typos must never be silently ignored
  if (effective !== undefined && effective !== "true" && effective !== "false") {
    throw new Error(
      `HEALTH_DRY_RUN has unrecognized value "${effective}". Must be "true" or "false".`,
    );
  }

  const isStaging = appUrl.includes("food-test");
  const isProduction = appUrl.includes("food.lucaswall.me") && !isStaging;

  if (isStaging) {
    if (effective !== "true") {
      throw new Error(
        `HEALTH_DRY_RUN must be "true" on staging (APP_URL=${appUrl}). ` +
        `Current: ${effective === undefined ? "unset" : `"${effective}"`}. ` +
        `A missing or wrong flag enables live Google Health writes against real user data.`,
      );
    }
  } else if (isProduction) {
    if (effective !== "true" && effective !== "false") {
      throw new Error(
        `HEALTH_DRY_RUN must be explicitly "true" or "false" on production (APP_URL=${appUrl}). ` +
        `Current: unset. Set HEALTH_DRY_RUN=false for live writes or HEALTH_DRY_RUN=true for dry-run.`,
      );
    }
  }
  // Local / dev: no constraint on HEALTH_DRY_RUN
}
