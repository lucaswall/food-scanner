"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Camera, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useCaptureSession } from "@/hooks/use-capture-session";
import type { CaptureItem } from "@/types";

interface CaptureCardProps {
  capture: CaptureItem;
  thumbnailUrl: string | null;
  onDelete: (id: string) => void;
}

function getRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

function CaptureCard({ capture, thumbnailUrl, onDelete }: CaptureCardProps) {
  const isTextOnly = capture.imageCount === 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 min-h-[44px]">
      {thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnailUrl}
          alt="Capture thumbnail"
          className="h-12 w-12 rounded object-cover shrink-0"
        />
      )}
      {!thumbnailUrl && (
        <div className="h-12 w-12 rounded bg-muted shrink-0 flex items-center justify-center">
          {isTextOnly ? (
            <FileText className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Camera className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      )}
      <div className="flex-1 min-w-0">
        {capture.imageCount > 0 && (
          <p className="text-sm font-medium truncate">
            {capture.imageCount} {capture.imageCount === 1 ? "photo" : "photos"}
          </p>
        )}
        {capture.note && (
          <p className={`text-xs truncate ${capture.imageCount === 0 ? "text-sm font-medium" : "text-muted-foreground"}`}>
            {capture.note.length > 50 ? capture.note.slice(0, 49) + "…" : capture.note}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{getRelativeTime(capture.capturedAt)}</p>
      </div>
      <button
        aria-label="Delete capture"
        onClick={() => onDelete(capture.id)}
        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function QuickCapture() {
  const router = useRouter();
  const { state, actions } = useCaptureSession();
  const { captures, sessionId } = state;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingBlobs, setPendingBlobs] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  // Auto-start session on mount
  useEffect(() => {
    actions.startSession();
  }, [actions]);

  // Load thumbnails for captures
  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];

    async function loadThumbnails() {
      if (!sessionId) return;
      const newThumbnails = new Map<string, string>();
      for (const capture of captures) {
        if (capture.imageCount === 0) continue;
        try {
          const blobs = await actions.getCaptureBlobs(capture.id);
          if (blobs.length > 0 && !cancelled) {
            const url = URL.createObjectURL(blobs[0]);
            blobUrls.push(url);
            newThumbnails.set(capture.id, url);
          }
        } catch {
          // skip failed thumbnails — IDB may be unavailable
        }
      }
      if (!cancelled) {
        setThumbnails(newThumbnails);
      }
    }

    loadThumbnails();

    return () => {
      cancelled = true;
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [captures, sessionId, actions]);

  // Cleanup pending preview URLs on unmount
  const pendingPreviewsRef = useRef<string[]>([]);
  pendingPreviewsRef.current = pendingPreviews;
  useEffect(() => {
    return () => {
      pendingPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    // Append to existing pending blobs
    setPendingBlobs((prev) => [...prev, ...files]);
    // Create preview URLs for the new files
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setPendingPreviews((prev) => [...prev, ...newPreviews]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemovePendingPhoto = (index: number) => {
    URL.revokeObjectURL(pendingPreviews[index]);
    setPendingBlobs((prev) => prev.filter((_, i) => i !== index));
    setPendingPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const canSave = pendingBlobs.length > 0 || note.trim().length > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setError(null);
    setIsSaving(true);
    try {
      await actions.addCapture(pendingBlobs, note.trim() || null);
      // Cleanup preview URLs
      pendingPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPendingBlobs([]);
      setPendingPreviews([]);
      setNote("");
      setIsAdding(false);
    } catch (err) {
      console.error(err);
      setError("Failed to save capture. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartAdding = () => {
    setIsAdding(true);
    setError(null);
  };

  const handleCancelAdding = () => {
    pendingPreviews.forEach((url) => URL.revokeObjectURL(url));
    setPendingBlobs([]);
    setPendingPreviews([]);
    setNote("");
    setIsAdding(false);
  };

  const handleClearConfirm = () => {
    actions.clearSession();
    setShowClearDialog(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Error banner */}
      {error && (
        <div
          aria-live="polite"
          className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Quick Capture</h1>
        {captures.length > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
            {captures.length}
          </span>
        )}
      </div>

      {/* Capture list */}
      {captures.length > 0 && !isAdding && (
        <div className="flex flex-col gap-2">
          {captures.map((capture) => (
            <CaptureCard
              key={capture.id}
              capture={capture}
              thumbnailUrl={thumbnails.get(capture.id) ?? null}
              onDelete={(id) => actions.removeCapture(id)}
            />
          ))}
        </div>
      )}

      {/* Add capture form */}
      {isAdding && (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          {/* Photo previews */}
          {pendingPreviews.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingPreviews.map((url, i) => (
                <div key={url} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`Selected photo ${i + 1}`}
                    className="h-16 w-16 rounded object-cover"
                  />
                  <button
                    aria-label={`Remove photo ${i + 1}`}
                    onClick={() => handleRemovePendingPhoto(i)}
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-destructive text-destructive-foreground w-5 h-5 flex items-center justify-center"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add photos button */}
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="w-full min-h-[44px]"
          >
            <Camera className="h-4 w-4 mr-2" />
            {pendingBlobs.length > 0 ? "Add More Photos" : "Add Photos"}
          </Button>

          {/* Note input */}
          <Input
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {/* Save / Cancel */}
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={handleCancelAdding}
              className="flex-1 min-h-[44px]"
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="flex-1 min-h-[44px]"
            >
              Save Capture
            </Button>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Action buttons */}
      {!isAdding && (
        <Button
          onClick={handleStartAdding}
          variant="outline"
          className="w-full min-h-[44px]"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Capture
        </Button>
      )}

      {captures.length > 0 && !isAdding && (
        <div className="flex gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowClearDialog(true)}
            className="min-h-[44px] text-destructive hover:text-destructive flex-1"
          >
            Clear All
          </Button>
          <Button
            onClick={() => router.push("/app/process-captures")}
            className="min-h-[44px] flex-1"
          >
            Process Captures
          </Button>
        </div>
      )}

      {!isAdding && (
        <Button
          variant="secondary"
          onClick={() => router.push("/app")}
          className="w-full min-h-[44px]"
        >
          Done
        </Button>
      )}

      {/* Clear All confirmation */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all captures?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {captures.length} pending captures. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleClearConfirm}>Clear</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
