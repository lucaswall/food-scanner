"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PhotoPreviewDialog } from "@/components/photo-preview-dialog";
import Image from "next/image";
import { Camera, ImageIcon } from "lucide-react";
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
  onPhotosChange: (files: File[]) => void;
  maxPhotos?: number;
  autoCapture?: boolean;
}

export function PhotoCapture({
  onPhotosChange,
  maxPhotos = 3,
  autoCapture = false,
}: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState<number | null>(null);
  const [processingCount, setProcessingCount] = useState(0);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Revoke blob URLs on unmount to prevent memory leaks
  const previewsRef = useRef(previews);
  useEffect(() => {
    previewsRef.current = previews;
  }, [previews]);
  useEffect(() => {
    return () => {
      previewsRef.current.forEach((url) => URL.revokeObjectURL(url));
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

    // Convert HEIC files to JPEG for preview (browsers can't display HEIC natively)
    // Original files are preserved for upload (conversion happens again in FoodAnalyzer)
    let previewBlobs: (File | Blob)[];
    try {
      const previewBlobPromises = combinedPhotos.map(async (file) => {
        if (isHeicFile(file)) {
          return convertHeicToJpeg(file);
        }
        return file;
      });

      previewBlobs = await Promise.all(previewBlobPromises);
    } catch {
      setError("Failed to process HEIC image. Please try a different photo.");
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
    setPhotos(combinedPhotos);
    setPreviews(newPreviews);
    onPhotosChange(combinedPhotos);

    // Reset inputs to allow selecting the same file again
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
  };

  const handleClearClick = () => {
    // If 2+ photos, show confirmation dialog
    if (photos.length >= 2) {
      setShowClearConfirm(true);
    } else {
      // 1 photo or less, clear immediately
      doClear();
    }
  };

  const doClear = () => {
    // Revoke all preview URLs
    previews.forEach((url) => URL.revokeObjectURL(url));

    setPhotos([]);
    setPreviews([]);
    setError(null);
    onPhotosChange([]);
    setShowClearConfirm(false);
    setPreviewDialogOpen(false);
    setSelectedPreviewIndex(null);

    // Reset inputs
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = "";
    }
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

      {/* Action buttons */}
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

      <p className="text-xs text-muted-foreground">
        {photos.length}/{maxPhotos} photos selected
      </p>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Processing placeholders */}
      {processingCount > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: processingCount }).map((_, index) => (
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

      {previews.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {previews.map((preview, index) => (
              <button
                key={`preview-${index}`}
                type="button"
                className="relative aspect-square cursor-pointer focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 rounded-md"
                onClick={() => handlePreviewClick(index)}
                aria-label={`View full-size preview ${index + 1}`}
              >
                <Image
                  src={preview}
                  alt={`Preview ${index + 1}`}
                  fill
                  unoptimized
                  className="object-cover rounded-md"
                />
              </button>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleClearClick}
            className="w-full"
          >
            Clear All
          </Button>
        </div>
      )}

      <PhotoPreviewDialog
        open={previewDialogOpen}
        onOpenChange={setPreviewDialogOpen}
        imageUrl={selectedPreviewIndex !== null && selectedPreviewIndex < previews.length ? previews[selectedPreviewIndex] : null}
        imageAlt={selectedPreviewIndex !== null ? `Preview ${selectedPreviewIndex + 1}` : undefined}
      />

      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all photos?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {photos.length} selected photos. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={doClear}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
