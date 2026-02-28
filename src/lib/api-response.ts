import type { ErrorCode } from "@/types";
import { generateETag, etagMatches } from "@/lib/etag";

export function successResponse<T>(data: T, status = 200): Response {
  return Response.json(
    {
      success: true,
      data,
      timestamp: Date.now(),
    },
    { status },
  );
}

export function conditionalResponse<T>(request: Request, data: T, status = 200): Response {
  const etag = generateETag(data);
  const ifNoneMatch = request.headers.get("if-none-match");

  if (etagMatches(ifNoneMatch, etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "private, no-cache",
      },
    });
  }

  const body = JSON.stringify({ success: true, data, timestamp: Date.now() });
  return new Response(body, {
    status,
    headers: {
      ETag: etag,
      "Cache-Control": "private, no-cache",
      "Content-Type": "application/json",
    },
  });
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  status: number,
  details?: unknown,
): Response {
  return Response.json(
    {
      success: false,
      error: { code, message, ...(details !== undefined && { details }) },
      timestamp: Date.now(),
    },
    { status },
  );
}
