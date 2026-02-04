import type { ErrorCode } from "@/types";
import { logger } from "@/lib/logger";

export function successResponse<T>(data: T, status = 200): Response {
  logger.info({ status }, "api response success");

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
  const logData = { status, errorCode: code, errorMessage: message };

  if (status >= 500) {
    logger.error(logData, "api response error");
  } else {
    logger.warn(logData, "api response error");
  }

  return Response.json(
    {
      success: false,
      error: { code, message, ...(details !== undefined && { details }) },
      timestamp: Date.now(),
    },
    { status },
  );
}
