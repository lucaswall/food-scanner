"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Loader2 } from "lucide-react";
import type { LumenGoalsResponse } from "@/types";

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function LumenBanner() {
  const today = getTodayDate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<LumenGoalsResponse>(
    `/api/lumen-goals?date=${today}`,
    apiFetcher
  );

  // Show skeleton placeholder while loading
  if (isLoading) {
    return (
      <Skeleton
        data-testid="lumen-banner-skeleton"
        className="w-full h-[44px] rounded-lg"
      />
    );
  }

  // Transient SWR state: no data, no error, not loading - show skeleton
  if (!data && !error) {
    return (
      <Skeleton
        data-testid="lumen-banner-skeleton"
        className="w-full h-[44px] rounded-lg"
      />
    );
  }

  // Generous approach: if error or no data, show banner (allow upload option)
  // Hide banner only when we positively know goals exist
  if (data?.goals) return null;

  const handleBannerClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("date", today);

      const response = await fetch("/api/lumen-goals", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Upload failed");
      }

      // Mutate SWR cache on success
      await mutate();

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <>
      <Alert
        variant="default"
        className="border-blue-500 bg-blue-50 dark:bg-blue-950/20 cursor-pointer min-h-[44px]"
        onClick={handleBannerClick}
      >
        {isUploading ? (
          <Loader2 data-testid="upload-spinner" className="h-4 w-4 text-blue-600 dark:text-blue-500 animate-spin" />
        ) : (
          <Upload className="h-4 w-4 text-blue-600 dark:text-blue-500" />
        )}
        <AlertDescription className="flex flex-col gap-1">
          <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
            Set today&apos;s macro goals
          </span>
          <span className="text-xs text-blue-700 dark:text-blue-300">
            Upload Lumen screenshot
          </span>
        </AlertDescription>
      </Alert>

      {uploadError && (
        <p className="text-sm text-destructive mt-2">{uploadError}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </>
  );
}
