"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealTypeSelector } from "./meal-type-selector";
import {
  Send,
  ArrowLeft,
  Loader2,
  Camera,
  ImageIcon,
  ChevronDown,
  Plus,
  X,
  Paperclip,
} from "lucide-react";
import { safeResponseJson } from "@/lib/safe-json";
import { compressImage } from "@/lib/image";
import { getLocalDateTime, getDefaultMealType } from "@/lib/meal-type";
import { getTodayDate } from "@/lib/date-utils";
import { savePendingSubmission } from "@/lib/pending-submission";
import { MiniNutritionCard } from "./mini-nutrition-card";
import type {
  FoodAnalysis,
  FoodLogResponse,
  ConversationMessage,
  ChatFoodResponse,
} from "@/types";

const MAX_MESSAGES = 30;

interface FoodChatProps {
  initialAnalysis?: FoodAnalysis;
  compressedImages?: Blob[];
  initialMealTypeId?: number;
  title?: string;
  seedMessages?: ConversationMessage[];
  onClose: () => void;
  onLogged: (response: FoodLogResponse, analysis: FoodAnalysis, mealTypeId: number) => void;
}

export function FoodChat({
  initialAnalysis,
  compressedImages = [],
  initialMealTypeId,
  title = "Chat",
  seedMessages,
  onClose,
  onLogged,
}: FoodChatProps) {
  const isSeeded = !!seedMessages && seedMessages.length > 0;

  const initialMessages: ConversationMessage[] = seedMessages
    ? seedMessages
    : [
        initialAnalysis
          ? {
              role: "assistant",
              content: `I analyzed your food as ${initialAnalysis.food_name} (${initialAnalysis.calories} cal). Anything you'd like to correct?`,
              analysis: initialAnalysis,
            }
          : {
              role: "assistant",
              content: "Hi! Ask me anything about your nutrition, or describe a meal to log it.",
            },
      ];

  const [messages, setMessages] = useState<ConversationMessage[]>(
    initialMessages,
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [logging, setLogging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealTypeId, setMealTypeId] = useState(initialMealTypeId ?? getDefaultMealType());
  // Initial images sent silently with first message; user-added images shown in indicator
  const [initialImagesSent, setInitialImagesSent] = useState(false);
  const [pendingImages, setPendingImages] = useState<Blob[]>([]);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [showPhotoMenu, setShowPhotoMenu] = useState(false);
  const [compressionWarning, setCompressionWarning] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const photoMenuRef = useRef<HTMLDivElement>(null);
  const plusButtonRef = useRef<HTMLButtonElement>(null);
  const compressionWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const latestAnalysis =
    [...messages]
      .reverse()
      .find((msg) => msg.analysis)?.analysis;

  // Count user-initiated chat messages for limit tracking
  // In seeded mode, ALL messages are sent to server (no offset needed)
  // In non-seeded mode, the initial greeting is sliced off (offset by 1)
  const seedCount = isSeeded ? 0 : 1;
  const apiMessageCount = messages.length - seedCount;
  const nearLimit = apiMessageCount >= MAX_MESSAGES - 4;
  const atLimit = apiMessageCount >= MAX_MESSAGES;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Close photo menu on Escape key or outside click
  useEffect(() => {
    if (!showPhotoMenu) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPhotoMenu(false);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        photoMenuRef.current &&
        !photoMenuRef.current.contains(e.target as Node) &&
        !plusButtonRef.current?.contains(e.target as Node)
      ) {
        setShowPhotoMenu(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showPhotoMenu]);

  // Cleanup compression warning timeout on unmount
  useEffect(() => {
    return () => {
      if (compressionWarningTimeoutRef.current) {
        clearTimeout(compressionWarningTimeoutRef.current);
      }
    };
  }, []);

  // Track scroll position for scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollDown(distanceFromBottom > 100);
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleClearImages = () => {
    setPendingImages([]);
  };

  const handleFileSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setShowPhotoMenu(false);
    setCompressing(true);
    setCompressionWarning(null);

    const fileArray = Array.from(files);
    const compressionResults = await Promise.allSettled(
      fileArray.map(compressImage)
    );
    const compressed = compressionResults
      .filter(
        (r): r is PromiseFulfilledResult<Blob> => r.status === "fulfilled"
      )
      .map((r) => r.value);
    const failed = compressionResults.filter((r) => r.status === "rejected").length;

    setCompressing(false);

    if (failed > 0) {
      if (compressionWarningTimeoutRef.current) {
        clearTimeout(compressionWarningTimeoutRef.current);
      }
      const warning = `${failed} of ${fileArray.length} photo${fileArray.length !== 1 ? "s" : ""} couldn't be processed`;
      setCompressionWarning(warning);
      compressionWarningTimeoutRef.current = setTimeout(() => {
        setCompressionWarning(null);
        compressionWarningTimeoutRef.current = null;
      }, 5000);
    }

    if (compressed.length > 0) {
      setPendingImages((prev) => [...prev, ...compressed]);
    }
  };

  const blobsToBase64 = async (blobs: Blob[]): Promise<string[]> => {
    return Promise.all(
      blobs.map(async (blob) => {
        const reader = new FileReader();
        return new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const base64 = (reader.result as string).split(",")[1];
            resolve(base64);
          };
          reader.onerror = () => reject(new Error("Failed to read image"));
          reader.readAsDataURL(blob);
        });
      })
    );
  };

  const handleSend = async () => {
    if (!input.trim() || loading || compressing) return;

    const userMessage: ConversationMessage = {
      role: "user",
      content: input.trim(),
    };

    const userAddedImages = [...pendingImages];
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setPendingImages([]);
    setShowPhotoMenu(false);
    setLoading(true);
    setError(null);

    try {
      const allMessages = [...messages, userMessage];
      // When seeded, send all messages (they're all "real" conversation turns)
      // When not seeded, skip the initial auto-generated assistant greeting
      const apiMessages = isSeeded ? allMessages : allMessages.slice(1);

      const requestBody: {
        messages: ConversationMessage[];
        images?: string[];
        initialAnalysis?: FoodAnalysis;
        clientDate: string;
      } = {
        messages: apiMessages,
        clientDate: getTodayDate(),
      };

      if (latestAnalysis) {
        requestBody.initialAnalysis = latestAnalysis;
      }

      // Collect all images to send: initial images (first time only) + user-added
      const allImagesToSend: Blob[] = [];
      if (!initialImagesSent && compressedImages.length > 0) {
        allImagesToSend.push(...compressedImages);
        setInitialImagesSent(true);
      }
      allImagesToSend.push(...userAddedImages);

      if (allImagesToSend.length > 0) {
        requestBody.images = await blobsToBase64(allImagesToSend);
      }

      const response = await fetch("/api/chat-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(120000), // Tool loops can require up to 5 sequential API calls
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: ChatFoodResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        setMessages((prev) => prev.slice(0, -1));
        setInput(userMessage.content);
        setPendingImages(userAddedImages);
        if (!initialImagesSent && compressedImages.length > 0) {
          setInitialImagesSent(false);
        }
        setError(result.error?.message || "Failed to process message");
        return;
      }

      const assistantMessage: ConversationMessage = {
        role: "assistant",
        content: result.data.message,
        analysis: result.data.analysis,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setMessages((prev) => prev.slice(0, -1));
      setInput(userMessage.content);
      setPendingImages(userAddedImages);
      if (!initialImagesSent && compressedImages.length > 0) {
        setInitialImagesSent(false);
      }
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("Request timed out. Please try again.");
      } else {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLog = async () => {
    if (logging) return;
    if (!latestAnalysis) {
      setError("No food analysis available to log.");
      return;
    }
    const analysis = latestAnalysis;

    setLogging(true);
    setError(null);

    try {
      const logBody: Record<string, unknown> = analysis.sourceCustomFoodId
        ? {
            reuseCustomFoodId: analysis.sourceCustomFoodId,
            mealTypeId,
            ...getLocalDateTime(),
          }
        : {
            ...analysis,
            mealTypeId,
            ...getLocalDateTime(),
          };

      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logBody),
        signal: AbortSignal.timeout(15000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        const errorCode = result.error?.code;

        // Handle token expiration - save pending and redirect to re-auth
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: analysis,
            mealTypeId,
            foodName: analysis.food_name,
            ...getLocalDateTime(),
          });
          window.location.href = "/api/auth/fitbit";
          return;
        }

        // Handle missing credentials - show specific error
        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setError("Fitbit is not set up. Please configure your credentials in Settings.");
          return;
        }

        setError(result.error?.message || "Failed to log food to Fitbit");
        return;
      }

      onLogged(result.data, analysis, mealTypeId);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("Request timed out. Please try again.");
      } else {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
      }
    } finally {
      setLogging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
        capture="environment"
        className="hidden"
        data-testid="chat-camera-input"
        onChange={(e) => {
          handleFileSelected(e.target.files);
          if (cameraInputRef.current) cameraInputRef.current.value = "";
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
        multiple
        className="hidden"
        data-testid="chat-gallery-input"
        onChange={(e) => {
          handleFileSelected(e.target.files);
          if (galleryInputRef.current) galleryInputRef.current.value = "";
        }}
      />

      {/* Top header: Conditional layout based on analysis presence */}
      <div className="border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] space-y-2">
        {latestAnalysis ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Back"
              className="shrink-0 flex items-center justify-center size-11 rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex-1 min-w-0">
              <MealTypeSelector
                value={mealTypeId}
                onChange={setMealTypeId}
                showTimeHint={false}
                ariaLabel="Meal type"
              />
            </div>
            <Button
              onClick={handleLog}
              disabled={logging}
              className="shrink-0 min-h-[44px]"
            >
              {logging ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Logging...
                </>
              ) : (
                "Log to Fitbit"
              )}
            </Button>
          </div>
        ) : (
          /* Simple header: Back button + Title */
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Back"
              className="shrink-0 flex items-center justify-center size-11 rounded-full"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <h1 className="text-lg font-semibold">{title}</h1>
          </div>
        )}
      </div>

      {/* Messages — scrollable area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
      >
        {messages.map((msg, idx) => {
          // Find previous analysis for diff highlighting on this message
          let prevAnalysisForMsg: FoodAnalysis | undefined;
          if (msg.role === "assistant" && msg.analysis && idx > 0) {
            for (let i = idx - 1; i >= 0; i--) {
              if (messages[i].analysis) {
                prevAnalysisForMsg = messages[i].analysis;
                break;
              }
            }
          }

          return (
            <div
              key={idx}
              className={`flex ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`max-w-[80%] px-3 py-2 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-sm"
                    : "bg-muted rounded-bl-sm"
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.role === "assistant" && msg.analysis && idx > 0 && (
                  <div className="mt-2">
                    <MiniNutritionCard
                      analysis={msg.analysis}
                      previousAnalysis={prevAnalysisForMsg}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start" data-testid="chat-loading">
            <div className="px-3 py-2 rounded-2xl bg-muted rounded-bl-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-2xl">
            <p className="flex-1 text-sm text-destructive">{error}</p>
            <button
              onClick={() => setError(null)}
              aria-label="Dismiss error"
              className="shrink-0 flex items-center justify-center size-11 rounded-full hover:bg-destructive/10"
            >
              <X className="h-4 w-4 text-destructive" />
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom input area */}
      <div className="relative border-t bg-background">
        {/* Scroll-to-bottom button */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            className="absolute -top-14 right-3 flex items-center justify-center size-11 rounded-full bg-background shadow-md border"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}

        {/* Conversation limit warning */}
        {atLimit && (
          <div className="px-3 pt-2">
            <p data-testid="limit-warning" className="text-xs text-muted-foreground text-center">
              Refinement limit reached — log your food to save.
            </p>
          </div>
        )}
        {nearLimit && !atLimit && (
          <div className="px-3 pt-2">
            <p data-testid="limit-warning" className="text-xs text-muted-foreground text-center">
              {MAX_MESSAGES - apiMessageCount} refinements remaining — log when ready
            </p>
          </div>
        )}

        {/* Photo attachment indicator (only user-added photos) */}
        {pendingImages.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 pt-2">
            <div
              data-testid="photo-indicator"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground"
            >
              <Paperclip className="h-3 w-3" />
              <span>
                {pendingImages.length} photo{pendingImages.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={handleClearImages}
                aria-label="Remove photos"
                className="ml-0.5 rounded-full hover:bg-background/50 p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* Compression warning */}
        {compressionWarning && (
          <div className="px-3 pt-2">
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
              {compressionWarning}
            </p>
          </div>
        )}

        {/* Photo compression loading */}
        {compressing && (
          <div className="flex items-center justify-center gap-1.5 px-3 pt-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span className="text-xs text-muted-foreground">Processing photos...</span>
          </div>
        )}

        {/* Inline photo menu */}
        {showPhotoMenu && (
          <div ref={photoMenuRef} data-testid="photo-menu" className="flex items-center gap-2 px-3 pt-2">
            <button
              onClick={() => {
                cameraInputRef.current?.click();
                setShowPhotoMenu(false);
              }}
              aria-label="Take photo"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm min-h-[36px]"
            >
              <Camera className="h-4 w-4" />
              Camera
            </button>
            <button
              onClick={() => {
                galleryInputRef.current?.click();
                setShowPhotoMenu(false);
              }}
              aria-label="Choose from gallery"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm min-h-[36px]"
            >
              <ImageIcon className="h-4 w-4" />
              Gallery
            </button>
          </div>
        )}

        {/* Photo toggle + Text input + Send */}
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <Button
            ref={plusButtonRef}
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-label="Add photo"
            disabled={loading || atLimit || compressing}
            onClick={() => setShowPhotoMenu((prev) => !prev)}
          >
            {showPhotoMenu ? (
              <X className="h-5 w-5" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </Button>

          <Input
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={loading || atLimit}
            maxLength={500}
            className="flex-1 rounded-full"
          />

          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading || atLimit || compressing}
            aria-label="Send"
            size="icon"
            className="shrink-0 rounded-full"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
