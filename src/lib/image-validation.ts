export const MAX_IMAGES = 3;
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
// Note: HEIC not included - client converts HEIC to JPEG before upload
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Type guard for File-like objects (works with both real Files and test mocks)
export function isFileLike(value: unknown): value is File {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as File).name === "string" &&
    typeof (value as File).type === "string" &&
    typeof (value as File).size === "number" &&
    typeof (value as File).arrayBuffer === "function"
  );
}
