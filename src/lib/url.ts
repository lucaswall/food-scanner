export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) {
    throw new Error("APP_URL environment variable is required");
  }
  return url.replace(/\/$/, "");
}

export function buildUrl(path: string): string {
  return `${getAppUrl()}${path}`;
}
