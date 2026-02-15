"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate } from "@/lib/date-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Upload, Loader2 } from "lucide-react";
import type { LumenGoalsResponse } from "@/types";

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
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleBannerClick}
        aria-label="Upload Lumen screenshot to set today's macro goals"
        className="w-full flex items-start gap-3 rounded-lg border border-info bg-info/10 p-4 text-left min-h-[44px] hover:bg-info/15 transition-colors"
      >
        {isUploading ? (
          <Loader2 data-testid="upload-spinner" className="h-4 w-4 text-info animate-spin shrink-0 mt-0.5" />
        ) : (
          <Upload className="h-4 w-4 text-info shrink-0 mt-0.5" />
        )}
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-info-foreground">
            Set today&apos;s macro goals
          </span>
          <span className="text-xs text-info-foreground">
            Upload Lumen screenshot
          </span>
        </div>
      </button>

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
