import { createHash } from "crypto";

export function generateETag(data: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex")
    .slice(0, 16);
  return `"${hash}"`;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  if (ifNoneMatch.trim() === "*") return true;

  const normalizeETag = (value: string): string =>
    value.trim().replace(/^W\//, "");

  const normalizedETag = normalizeETag(etag);

  return ifNoneMatch.split(",").some((value) => {
    return normalizeETag(value) === normalizedETag;
  });
}
