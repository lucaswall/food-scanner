import { getSession, validateSession } from "@/lib/session";
import { errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { triageCaptures } from "@/lib/claude";
import { isFileLike, ALLOWED_TYPES, MAX_IMAGE_SIZE } from "@/lib/image-validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidDateFormat, getTodayDate } from "@/lib/date-utils";
import { createSSEResponse } from "@/lib/sse";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_TRIAGE_IMAGES = 81; // 9 captures × 9 images max

interface CaptureMetadataEntry {
  captureId: string;
  imageCount: number;
  note: string | null;
  capturedAt: string;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/process-captures");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: false });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`process-captures:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid form data", 400);
  }

  // Validate images
  const imagesRaw = formData.getAll("images");
  const images = imagesRaw.filter(isFileLike);
  if (images.length !== imagesRaw.length) {
    log.warn({ action: "process_captures_validation" }, "non-file values in images");
    return errorResponse("VALIDATION_ERROR", "Invalid image data", 400);
  }

  if (images.length === 0) {
    return errorResponse("VALIDATION_ERROR", "At least one image is required", 400);
  }

  if (images.length > MAX_TRIAGE_IMAGES) {
    return errorResponse("VALIDATION_ERROR", `Maximum ${MAX_TRIAGE_IMAGES} images allowed`, 400);
  }

  for (const image of images) {
    if (!ALLOWED_TYPES.includes(image.type)) {
      return errorResponse("VALIDATION_ERROR", "Only JPEG, PNG, GIF, and WebP images are allowed", 400);
    }
    if (image.size > MAX_IMAGE_SIZE) {
      return errorResponse("VALIDATION_ERROR", "Each image must be under 10MB", 400);
    }
  }

  // Parse and validate captureMetadata
  const captureMetadataRaw = formData.get("captureMetadata");
  if (typeof captureMetadataRaw !== "string") {
    return errorResponse("VALIDATION_ERROR", "captureMetadata is required", 400);
  }

  let captureMetadataEntries: CaptureMetadataEntry[];
  try {
    const parsed = JSON.parse(captureMetadataRaw);
    if (!Array.isArray(parsed)) {
      return errorResponse("VALIDATION_ERROR", "captureMetadata must be a JSON array", 400);
    }
    captureMetadataEntries = parsed as CaptureMetadataEntry[];
  } catch {
    return errorResponse("VALIDATION_ERROR", "captureMetadata must be valid JSON", 400);
  }

  // Validate that sum of imageCount equals total images
  const totalMetadataImages = captureMetadataEntries.reduce((sum, entry) => sum + (entry.imageCount ?? 0), 0);
  if (totalMetadataImages !== images.length) {
    return errorResponse(
      "VALIDATION_ERROR",
      `captureMetadata imageCount total (${totalMetadataImages}) does not match image count (${images.length})`,
      400
    );
  }

  // Parse clientDate
  const clientDateRaw = formData.get("clientDate");
  const currentDate = typeof clientDateRaw === "string" && isValidDateFormat(clientDateRaw)
    ? clientDateRaw
    : getTodayDate();

  log.info(
    { action: "process_captures_request", imageCount: images.length, captureCount: captureMetadataEntries.length },
    "processing captures triage request"
  );

  // Convert images to base64
  const imageResults = await Promise.allSettled(
    images.map(async (image) => {
      const buffer = await image.arrayBuffer();
      return { base64: Buffer.from(buffer).toString("base64"), mimeType: image.type };
    })
  );

  const imageInputs = imageResults
    .map((result, index) => {
      if (result.status === "rejected") {
        log.warn({ action: "process_captures_image_error", imageIndex: index }, `Failed to process image ${index}`);
        return null;
      }
      return result.value;
    })
    .filter((v): v is { base64: string; mimeType: string } => v !== null);

  if (imageInputs.length === 0) {
    return errorResponse("VALIDATION_ERROR", "Failed to process images. Please try again.", 400);
  }

  // Build captureMetadata with imageIndices (sequential groups)
  let imageOffset = 0;
  const captureMetadata = captureMetadataEntries.map((entry) => {
    const imageIndices = Array.from({ length: entry.imageCount }, (_, i) => imageOffset + i);
    imageOffset += entry.imageCount;
    return {
      captureId: entry.captureId,
      imageIndices,
      note: entry.note,
      capturedAt: entry.capturedAt,
    };
  });

  const generator = triageCaptures(
    imageInputs,
    captureMetadata,
    session!.userId,
    currentDate,
    log,
    request.signal,
  );

  log.info({ action: "process_captures_streaming" }, "starting SSE stream for triage");
  return createSSEResponse(generator);
}
