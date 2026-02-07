const REQUIRED_ENV_VARS = [
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "FITBIT_CLIENT_ID",
  "FITBIT_CLIENT_SECRET",
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
