"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, CheckCircle } from "lucide-react";
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
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3 min-h-[44px]">
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt="Capture thumbnail"
          className="h-12 w-12 rounded object-cover shrink-0"
        />
      )}
      {!thumbnailUrl && (
        <div className="h-12 w-12 rounded bg-muted shrink-0 flex items-center justify-center">
          <Plus className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">
          {capture.imageCount} {capture.imageCount === 1 ? "photo" : "photos"}
        </p>
        {capture.note && (
          <p className="text-xs text-muted-foreground truncate">
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
  const [note, setNote] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  // Auto-start session on mount
  useEffect(() => {
    actions.startSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load thumbnails for captures
  useEffect(() => {
    let cancelled = false;
    const blobUrls: string[] = [];

    async function loadThumbnails() {
      if (!sessionId) return;
      const newThumbnails = new Map<string, string>();
      for (const capture of captures) {
        const blobs = await actions.getCaptureBlobs(capture.id);
        if (blobs.length > 0 && !cancelled) {
          const url = URL.createObjectURL(blobs[0]);
          blobUrls.push(url);
          newThumbnails.set(capture.id, url);
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
  }, [captures, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke all thumbnails on unmount
  useEffect(() => {
    return () => {
      thumbnails.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setPendingBlobs(files);
    setIsAdding(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSave = async () => {
    if (pendingBlobs.length === 0) return;
    await actions.addCapture(pendingBlobs, note.trim() || null);
    setPendingBlobs([]);
    setNote("");
    setIsAdding(false);
    // Auto-trigger camera again
    fileInputRef.current?.click();
  };

  const handleAddCapture = () => {
    fileInputRef.current?.click();
  };

  const handleClearConfirm = () => {
    actions.clearSession();
    setShowClearDialog(false);
  };

  return (
    <div className="flex flex-col gap-4">
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
      {captures.length > 0 && (
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

      {/* Note input while adding */}
      {isAdding && (
        <div className="flex flex-col gap-2">
          <Input
            placeholder="Add a note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button onClick={handleSave} className="w-full min-h-[44px]">
            <CheckCircle className="h-4 w-4 mr-2" />
            Save
          </Button>
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
          onClick={handleAddCapture}
          variant="outline"
          className="w-full min-h-[44px]"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Capture
        </Button>
      )}

      {captures.length > 0 && (
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

      <Button
        variant="secondary"
        onClick={() => router.push("/app")}
        className="w-full min-h-[44px]"
      >
        Done
      </Button>

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
