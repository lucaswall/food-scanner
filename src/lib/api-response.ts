import type { ErrorCode } from "@/types";

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
