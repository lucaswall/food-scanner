import { createHash } from "crypto";

export function generateETag(data: unknown): string {
  const hash = createHash("sha256")
    .update(JSON.stringify(data) ?? "undefined")
    .digest("hex")
    .slice(0, 16);
  return `"${hash}"`;
}

function stripWeak(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (ifNoneMatch === null) return false;
  if (ifNoneMatch === "*") return true;

  const storedNormalized = stripWeak(etag);
  return ifNoneMatch
    .split(",")
    .map((t) => stripWeak(t.trim()))
    .some((t) => t === storedNormalized);
}
