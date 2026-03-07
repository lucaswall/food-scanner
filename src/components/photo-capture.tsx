"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PhotoPreviewDialog } from "@/components/photo-preview-dialog";
import Image from "next/image";
import { Camera, ImageIcon, X } from "lucide-react";
import { isHeicFile, convertHeicToJpeg } from "@/lib/image";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
];
interface PhotoCaptureProps {
  onPhotosChange: (files: File[], convertedBlobs?: (File | Blob)[]) => void;
  maxPhotos?: number;
  autoCapture?: boolean;
  restoredBlobs?: Blob[];
}

function createRestoredPreviews(blobs: Blob[]) {
  return blobs.map((blob) => URL.createObjectURL(blob));
}

export function PhotoCapture({
  onPhotosChange,
  maxPhotos = 9,
  autoCapture = false,
  restoredBlobs,
}: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [processingCount, setProcessingCount] = useState(0);
  const [convertedBlobsState, setConvertedBlobsState] = useState<(File | Blob)[]>([]);
  const [restoredPreviews, setRestoredPreviews] = useState<string[]>(() => {
    if (restoredBlobs && restoredBlobs.length > 0) {
      return createRestoredPreviews(restoredBlobs);
    }
    return [];
  });
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const restoredBlobsRef = useRef<Blob[]>(restoredBlobs ?? []);
  const warningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Revoke blob URLs on unmount to prevent memory leaks
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  const restoredPreviewsRef = useRef<string[]>([]);
  useEffect(() => {
    restoredPreviewsRef.current = restoredPreviews;
  }, [restoredPreviews]);
  useEffect(() => {
    return () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      restoredPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
      if (warningTimeoutRef.current) {
        clearTimeout(warningTimeoutRef.current);
      }
    };
  }, []);

  // Auto-trigger camera on mount when autoCapture is true
  useEffect(() => {
    if (autoCapture) {
      cameraInputRef.current?.click();
    }
  }, [autoCapture]);

  const validateFile = (file: File): string | null => {
    // Check MIME type first, then fallback to HEIC extension check
    const isValidType = ALLOWED_TYPES.includes(file.type);

    if (!isValidType && !isHeicFile(file)) {
      return "Only JPEG, PNG, GIF, WebP, and HEIC images are allowed";
    }
    if (file.size > MAX_FILE_SIZE) {
      return "Each image must be under 10MB";
    }
    return null;
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    // Ignore new selections while processing (prevent race conditions)
    if (processingCount > 0) {
      // Reset input so user can try again after processing completes
      event.target.value = "";
      return;
    }

    const newFiles = Array.from(fileList);

    // Validate each file
    for (const file of newFiles) {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        // Reset inputs
        if (cameraInputRef.current) {
          cameraInputRef.current.value = "";
        }
        if (galleryInputRef.current) {
          galleryInputRef.current.value = "";
        }
        return;
      }
    }

    // Clear any previous error
    setError(null);

    // Combine with existing photos, respecting the limit
    const combinedPhotos = [...photos, ...newFiles].slice(0, maxPhotos);

    // Show processing placeholders only for newly added files
    const actualNewCount = combinedPhotos.length - photos.length;
    setProcessingCount(actualNewCount);

    // Convert only NEW HEIC files to JPEG for preview (browsers can't display HEIC natively)
    // Existing photos already have converted blobs in convertedBlobsState
    let previewBlobs: (File | Blob)[];
    let validPhotos: File[];
    try {
      // Only process new files through HEIC conversion
      const existingCount = photos.length;
      const existingBlobs = convertedBlobsState.slice(0, existingCount);
      const filesToProcess = combinedPhotos.slice(existingCount);

      const newBlobPromises = filesToProcess.map(async (file) => {
        if (isHeicFile(file)) {
          return convertHeicToJpeg(file);
        }
        return file;
      });

      const results = await Promise.allSettled(newBlobPromises);

      // Filter out failed conversions from new files
      const successfulNewPairs: Array<{ photo: File; blob: File | Blob }> = [];
      const failedIndices: number[] = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          successfulNewPairs.push({ photo: filesToProcess[index], blob: result.value });
        } else {
          failedIndices.push(index);
        }
      });

      if (successfulNewPairs.length === 0 && existingCount === 0) {
        setError("All images failed to process. Please try different photos.");
        setProcessingCount(0);
        // Reset inputs
        if (cameraInputRef.current) {
          cameraInputRef.current.value = "";
        }
        if (galleryInputRef.current) {
          galleryInputRef.current.value = "";
        }
        return;
      }

      if (failedIndices.length > 0) {
        const failedCount = failedIndices.length;
        const warningMessage = failedCount === 1
          ? "1 image could not be processed and was skipped"
          : `${failedCount} images could not be processed and were skipped`;
        console.warn(warningMessage, failedIndices);
        setError(warningMessage);
        // Clear the warning after a few seconds
        warningTimeoutRef.current = setTimeout(() => setError(null), 3000);
      }

      // Combine existing photos/blobs with successfully processed new ones
      const existingPhotos = photos.slice(0, existingCount);
      validPhotos = [...existingPhotos, ...successfulNewPairs.map((pair) => pair.photo)];
      previewBlobs = [...existingBlobs, ...successfulNewPairs.map((pair) => pair.blob)];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process HEIC image. Please try a different photo.");
      setProcessingCount(0);
      // Reset inputs
      if (cameraInputRef.current) {
        cameraInputRef.current.value = "";
      }
      if (galleryInputRef.current) {
        galleryInputRef.current.value = "";
      }
      return;
    }

    // Create preview URLs from (potentially converted) blobs
    const newPreviews = previewBlobs.map((blob) => URL.createObjectURL(blob));

    // Revoke old preview URLs to prevent memory leaks
    previews.forEach((url) => URL.revokeObjectURL(url));

    setProcessingCount(0);
    setPhotos(validPhotos);
    setPreviews(newPreviews);
    setConvertedBlobsState(previewBlobs);
    onPhotosChange(validPhotos, previewBlobs);

    // Reset inputs to allow selecting the same file again
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
  };

  const handleRemovePhoto = (index: number) => {
    // Prevent removal during processing — async handleFileChange holds stale closure
    // and would restore the removed photo when it completes
    if (processingCount > 0) return;
    URL.revokeObjectURL(previews[index]);
    const newPhotos = photos.filter((_, i) => i !== index);
    const newPreviews = previews.filter((_, i) => i !== index);
    const newBlobs = convertedBlobsState.filter((_, i) => i !== index);

    if (newPhotos.length === 0) {
      setPhotos([]);
      setPreviews([]);
      setConvertedBlobsState([]);
      setError(null);
      setPreviewDialogOpen(false);
      setSelectedPreviewIndex(null);
      onPhotosChange([], []);
    } else {
      setPhotos(newPhotos);
      setPreviews(newPreviews);
      setConvertedBlobsState(newBlobs);
      onPhotosChange(newPhotos, newBlobs);
    }
  };

  const handleRemoveRestoredPhoto = (index: number) => {
    URL.revokeObjectURL(restoredPreviews[index]);
    const newRestoredPreviews = restoredPreviews.filter((_, i) => i !== index);
    const newRestoredBlobs = restoredBlobsRef.current.filter((_, i) => i !== index);
    restoredBlobsRef.current = newRestoredBlobs;
    setRestoredPreviews(newRestoredPreviews);
    setPreviewDialogOpen(false);
    setSelectedPreviewIndex(null);

    // Always notify parent with remaining blobs (or empty arrays if all removed)
    onPhotosChange([], newRestoredBlobs.length > 0 ? newRestoredBlobs : []);
  };

  const handleTakePhoto = () => {
    cameraInputRef.current?.click();
  };

  const handleChooseFromGallery = () => {
    galleryInputRef.current?.click();
  };

  const handlePreviewClick = (index: number) => {
    setSelectedPreviewIndex(index);
    setPreviewDialogOpen(true);
  };

  const totalPhotoCount = photos.length > 0 ? photos.length : restoredPreviews.length;
  const canAddMore = totalPhotoCount < maxPhotos;

  return (
    <div className="space-y-4">
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
        capture="environment"
        multiple
        onChange={handleFileChange}
        data-testid="camera-input"
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        onChange={handleFileChange}
        data-testid="gallery-input"
        className="hidden"
      />

      {/* Action buttons — shown whenever more photos can be added */}
      {canAddMore && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={handleTakePhoto}
            className="flex-1"
          >
            <Camera className="mr-2 h-4 w-4" />
            Take Photo
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleChooseFromGallery}
            className="flex-1"
          >
            <ImageIcon className="mr-2 h-4 w-4" />
            Choose from Gallery
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {photos.length > 0 ? photos.length : restoredPreviews.length}/{maxPhotos} photos selected
      </p>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Restored photo previews (from session restore) */}
      {restoredPreviews.length > 0 && previews.length === 0 && (
        <div className="grid grid-cols-3 gap-2">
          {restoredPreviews.map((preview, index) => (
            <div
              key={`restored-${index}`}
              role="button"
              tabIndex={0}
              className="relative aspect-square cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md"
              onClick={() => handlePreviewClick(index)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePreviewClick(index); } }}
              aria-label={`View full-size preview ${index + 1}`}
            >
              <Image
                src={preview}
                alt={`Preview ${index + 1}`}
                fill
                unoptimized
                className="object-cover rounded-md"
              />
              <button
                type="button"
                className="absolute top-0 right-0 z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveRestoredPhoto(index);
                }}
                aria-label={`Remove photo ${index + 1}`}
              >
                <span className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            </div>
          ))}
        </div>
      )}

      {(previews.length > 0 || processingCount > 0) && (
        <div className="grid grid-cols-3 gap-2">
          {previews.map((preview, index) => (
            <div
              key={`preview-${index}`}
              role="button"
              tabIndex={0}
              className="relative aspect-square cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md"
              onClick={() => handlePreviewClick(index)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePreviewClick(index); } }}
              aria-label={`View full-size preview ${index + 1}`}
            >
              <Image
                src={preview}
                alt={`Preview ${index + 1}`}
                fill
                unoptimized
                className="object-cover rounded-md"
              />
              <button
                type="button"
                className="absolute top-0 right-0 z-10 min-w-[44px] min-h-[44px] flex items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemovePhoto(index);
                }}
                aria-label={`Remove photo ${index + 1}`}
              >
                <span className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
                  <X className="h-3.5 w-3.5" />
                </span>
              </button>
            </div>
          ))}
          {processingCount > 0 && Array.from({ length: processingCount }).map((_, index) => (
            <div
              key={`processing-${index}`}
              data-testid="processing-placeholder"
              className="relative aspect-square rounded-md bg-muted flex items-center justify-center"
              aria-busy="true"
              aria-label="Processing photo"
            >
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            </div>
          ))}
        </div>
      )}

      <PhotoPreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        imageUrl={selectedPreviewIndex !== null ? (previews[selectedPreviewIndex] ?? restoredPreviews[selectedPreviewIndex] ?? null) : null}
        imageAlt={selectedPreviewIndex !== null ? `Preview ${selectedPreviewIndex + 1}` : undefined}
      />

    </div>
  );
}
