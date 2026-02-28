import type { ErrorCode } from "@/types";
import { generateETag, etagMatches } from "@/lib/etag";

export function conditionalResponse<T>(
  request: Request,
  data: T,
  status = 200,
): Response {
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

  return new Response(
    JSON.stringify({
      success: true,
      data,
      timestamp: Date.now(),
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ETag: etag,
        "Cache-Control": "private, no-cache",
      },
    },
  );
}

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
