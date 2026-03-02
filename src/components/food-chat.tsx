"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import * as Sentry from "@sentry/nextjs";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealTypeSelector } from "@/components/meal-type-selector";
import { TimeSelector } from "@/components/time-selector";
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
import { parseSSEEvents } from "@/lib/sse";
import { compressImage } from "@/lib/image";
import { getLocalDateTime, getDefaultMealType } from "@/lib/meal-type";
import { getTodayDate } from "@/lib/date-utils";
import { savePendingSubmission } from "@/lib/pending-submission";
import { MiniNutritionCard } from "@/components/mini-nutrition-card";
import type {
  FoodAnalysis,
  FoodLogResponse,
  FoodLogEntryDetail,
  ConversationMessage,
  ChatFoodResponse,
} from "@/types";

const ChatMarkdown = dynamic(
  () => import("./chat-markdown").then(m => ({ default: m.ChatMarkdown })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-4 bg-muted rounded" />,
  }
);

const MAX_MESSAGES = 30;

function entryDetailToAnalysis(entry: FoodLogEntryDetail): FoodAnalysis {
  return {
    food_name: entry.foodName,
    amount: entry.amount,
    unit_id: entry.unitId,
    calories: entry.calories,
    protein_g: entry.proteinG,
    carbs_g: entry.carbsG,
    fat_g: entry.fatG,
    fiber_g: entry.fiberG,
    sodium_mg: entry.sodiumMg,
    saturated_fat_g: entry.saturatedFatG ?? null,
    trans_fat_g: entry.transFatG ?? null,
    sugars_g: entry.sugarsG ?? null,
    calories_from_fat: entry.caloriesFromFat ?? null,
    confidence: entry.confidence as "high" | "medium" | "low",
    notes: entry.notes ?? "",
    description: entry.description ?? "",
    keywords: entry.keywords,
  };
}

interface FoodChatProps {
  initialAnalysis?: FoodAnalysis;
  compressedImages?: Blob[];
  initialMealTypeId?: number;
  title?: string;
  seedMessages?: ConversationMessage[];
  onClose?: () => void;
  onLogged?: (response: FoodLogResponse, analysis: FoodAnalysis, mealTypeId: number) => void;
  mode?: "analyze" | "edit";
  editEntry?: FoodLogEntryDetail;
}

export function FoodChat({
  initialAnalysis,
  compressedImages = [],
  initialMealTypeId,
  title = "Chat",
  seedMessages,
  onClose,
  onLogged,
  mode = "analyze",
  editEntry,
}: FoodChatProps) {
  const router = useRouter();
  const isEditMode = mode === "edit";
  const isSeeded = !!seedMessages && seedMessages.length > 0;

  const editAnalysisGreeting = isEditMode && editEntry ? entryDetailToAnalysis(editEntry) : undefined;

  const initialMessages: ConversationMessage[] = seedMessages
    ? seedMessages
    : [
        editAnalysisGreeting
          ? {
              role: "assistant",
              content: `You logged ${editEntry!.foodName} (${editEntry!.calories} cal). What would you like to change?`,
              analysis: editAnalysisGreeting,
            }
          : initialAnalysis
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
  const [mealTypeId, setMealTypeId] = useState(
    isEditMode && editEntry ? editEntry.mealTypeId : (initialMealTypeId ?? getDefaultMealType())
  );
  const [selectedTime, setSelectedTime] = useState<string | null>(
    isEditMode && editEntry?.time ? editEntry.time : null
  );
  const [pendingImages, setPendingImages] = useState<Blob[]>([]);
  // Track whether initial compressed images have been embedded into a message
  const initialImagesConsumedRef = useRef(false);
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const timeoutFiredRef = useRef(false);

  const latestAnalysis = messages.slice().reverse().find((msg) => msg.analysis)?.analysis;
  // True when Claude identified an existing entry to edit via editingEntryId (chat-initiated edit).
  const isEditingExisting = !isEditMode && latestAnalysis?.editingEntryId != null;

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

  // Cleanup on unmount: abort in-flight requests, clear timers
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
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

    const userAddedImages = [...pendingImages];
    // Capture message count before adding anything so we can revert on error
    const messageCountBeforeSend = messages.length;

    // Collect images for this turn: initial compressed images (first time) + user-added
    const imageBlobsForThisTurn: Blob[] = [];
    const consumedInitialImages = !initialImagesConsumedRef.current && compressedImages.length > 0;
    if (consumedInitialImages) {
      imageBlobsForThisTurn.push(...compressedImages);
    }
    imageBlobsForThisTurn.push(...userAddedImages);

    const userContent = input.trim();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      // Convert to base64 inside try — FileReader can reject
      let messageImages: string[] | undefined;
      if (imageBlobsForThisTurn.length > 0) {
        messageImages = await blobsToBase64(imageBlobsForThisTurn);
      }
      // Mark initial images as consumed only after successful conversion
      if (consumedInitialImages) {
        initialImagesConsumedRef.current = true;
      }

      const userMessage: ConversationMessage = {
        role: "user",
        content: userContent,
        ...(messageImages ? { images: messageImages } : {}),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setPendingImages([]);
      setShowPhotoMenu(false);
      setLoading(true);
      setError(null);

      const revertOnError = (errorMessage: string) => {
        setMessages((prev) => prev.slice(0, messageCountBeforeSend));
        setInput(userContent);
        setPendingImages(userAddedImages);
        if (consumedInitialImages) {
          initialImagesConsumedRef.current = false;
        }
        setError(errorMessage);
      };
      const allMessages = [...messages, userMessage];
      // When seeded, send all messages (they're all "real" conversation turns)
      // When not seeded, skip the initial auto-generated assistant greeting
      const rawMessages = isSeeded ? allMessages : allMessages.slice(1);
      // Strip thinking messages and internal fields before sending to API
      const apiMessages = rawMessages
        .filter((m) => !m.isThinking)
        .map(({ role, content, analysis, images }) => ({
          role,
          content,
          ...(analysis ? { analysis } : {}),
          ...(images ? { images } : {}),
        })) as ConversationMessage[];

      const requestBody: {
        messages: ConversationMessage[];
        initialAnalysis?: FoodAnalysis;
        clientDate: string;
        entryId?: number;
      } = {
        messages: apiMessages,
        clientDate: getTodayDate(),
      };

      if (latestAnalysis) {
        requestBody.initialAnalysis = latestAnalysis;
      }

      if (isEditMode && editEntry) {
        requestBody.entryId = editEntry.id;
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Manual timeout — AbortSignal.any() not available on iOS 16, Chrome <116
      timeoutFiredRef.current = false;
      timeoutId = setTimeout(() => {
        timeoutFiredRef.current = true;
        controller.abort(new DOMException("signal timed out", "TimeoutError"));
      }, 120000);

      const chatApiUrl = isEditMode ? "/api/edit-chat" : "/api/chat-food";
      const response = await fetch(chatApiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const result = (await safeResponseJson(response)) as {
          success: boolean;
          error?: { code: string; message: string };
        };
        revertOnError(result.error?.message || "Failed to process message");
        return;
      }

      const contentType = response.headers?.get("Content-Type") ?? "";
      if (contentType.includes("text/event-stream")) {
        if (!response.body) {
          revertOnError("No response body");
          return;
        }

        // SSE streaming path: use functional setMessages updaters so React 18 applies
        // each event in order (functional updaters are always applied sequentially).
        setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamFinished = false;

        try {
          while (!streamFinished) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const { events, remaining } = parseSSEEvents(chunk, buffer);
            buffer = remaining;

            for (let i = 0; i < events.length && !streamFinished; i++) {
              const event = events[i];
              if (event.type === "text_delta") {
                setMessages((prev) => {
                  const msgs = [...prev];
                  const last = msgs[msgs.length - 1];
                  msgs[msgs.length - 1] = { ...last, content: last.content + event.text };
                  return msgs;
                });
              } else if (event.type === "analysis") {
                setMessages((prev) => {
                  const msgs = [...prev];
                  const last = msgs[msgs.length - 1];
                  msgs[msgs.length - 1] = { ...last, analysis: event.analysis };
                  return msgs;
                });
                if (event.analysis.time != null) {
                  setSelectedTime(event.analysis.time);
                }
                if (event.analysis.mealTypeId != null) {
                  setMealTypeId(event.analysis.mealTypeId);
                }
              } else if (event.type === "tool_start") {
                setMessages((prev) => {
                  const msgs = [...prev];
                  const last = msgs[msgs.length - 1];
                  if (last.role === "assistant" && !last.isThinking) {
                    // Skip if last message is already empty — avoids extra bubbles
                    // from consecutive tool_start events
                    if (!last.content.trim()) return msgs;
                    msgs[msgs.length - 1] = { ...last, isThinking: true };
                    msgs.push({ role: "assistant", content: "" });
                  }
                  return msgs;
                });
              } else if (event.type === "error") {
                streamFinished = true;
                revertOnError(event.message || "Failed to process message");
              } else if (event.type === "done") {
                streamFinished = true;
                // Messages are already committed via functional updaters above
              }
            }
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } else {
        // JSON fallback path (e.g. for responses without SSE content-type)
        const result = (await safeResponseJson(response)) as {
          success: boolean;
          data?: ChatFoodResponse;
          error?: { code: string; message: string };
        };

        if (!result.success || !result.data) {
          revertOnError(result.error?.message || "Failed to process message");
          return;
        }

        const assistantMessage: ConversationMessage = {
          role: "assistant",
          content: result.data.message,
          analysis: result.data.analysis,
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (err) {
      // If aborted by unmount (not timeout), silently exit — component is gone
      if (err instanceof DOMException && err.name === "AbortError" && !timeoutFiredRef.current) {
        return;
      }
      setMessages((prev) => prev.slice(0, messageCountBeforeSend));
      setInput(userContent);
      setPendingImages(userAddedImages);
      if (consumedInitialImages) {
        initialImagesConsumedRef.current = false;
      }
      if (timeoutFiredRef.current || (err instanceof DOMException && err.name === "TimeoutError")) {
        setError("Request timed out. Please try again.");
      } else if (err instanceof Error && err.message === "Failed to read image") {
        // Client-side FileReader failure — user-recoverable, not a server error
        setError(err.message);
      } else {
        Sentry.captureException(err);
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
      }
    } finally {
      clearTimeout(timeoutId);
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
      const localDateTime = getLocalDateTime();
      const logDate = analysis.date ?? localDateTime.date;
      const logTime = selectedTime ?? localDateTime.time;
      const { date: _analysisDate, ...analysisRest } = analysis;
      const logBody: Record<string, unknown> = analysis.sourceCustomFoodId
        ? {
            reuseCustomFoodId: analysis.sourceCustomFoodId,
            mealTypeId,
            date: logDate,
            time: logTime,
          }
        : {
            ...analysisRest,
            mealTypeId,
            date: logDate,
            time: logTime,
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
            date: logDate,
            time: logTime,
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

      onLogged?.(result.data, analysis, mealTypeId);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("Request timed out. Please try again.");
      } else {
        Sentry.captureException(err);
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
      }
    } finally {
      setLogging(false);
    }
  };

  const handleSave = async () => {
    if (logging) return;
    if (!latestAnalysis) {
      setError("No food analysis available to save.");
      return;
    }
    if (!editEntry) {
      setError("No entry to edit.");
      return;
    }

    const analysis = latestAnalysis;
    setLogging(true);
    setError(null);

    try {
      const { time } = getLocalDateTime();
      const saveBody = {
        entryId: editEntry.id,
        ...analysis,
        mealTypeId,
        date: editEntry.date,
        time: selectedTime ?? editEntry.time ?? time,
      };

      const response = await fetch("/api/edit-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveBody),
        signal: AbortSignal.timeout(15000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        const errorCode = result.error?.code;

        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: analysis,
            mealTypeId,
            foodName: analysis.food_name,
            date: editEntry.date,
            time: saveBody.time,
          });
          window.location.href = "/api/auth/fitbit";
          return;
        }

        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setError("Fitbit is not set up. Please configure your credentials in Settings.");
          return;
        }

        setError(result.error?.message || "Failed to save changes");
        return;
      }

      onLogged?.(result.data, analysis, mealTypeId);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("Request timed out. Please try again.");
      } else {
        Sentry.captureException(err);
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    } finally {
      setLogging(false);
    }
  };

  const handleSaveExisting = async () => {
    if (logging) return;
    if (!latestAnalysis) {
      setError("No food analysis available to save.");
      return;
    }
    const entryId = latestAnalysis.editingEntryId;
    if (!entryId) {
      setError("No entry to edit.");
      return;
    }

    const analysis = latestAnalysis;
    setLogging(true);
    setError(null);

    try {
      const fallback = getLocalDateTime();
      const date = analysis.date ?? fallback.date;
      const time = selectedTime ?? analysis.time ?? fallback.time;
      const { date: _analysisDate, time: _analysisTime, ...analysisRest } = analysis;
      const saveBody = {
        entryId,
        ...analysisRest,
        editingEntryId: undefined,
        mealTypeId,
        date,
        time,
      };

      const response = await fetch("/api/edit-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveBody),
        signal: AbortSignal.timeout(15000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        const errorCode = result.error?.code;
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: analysis,
            mealTypeId,
            foodName: analysis.food_name,
            date,
            time: saveBody.time,
          });
          window.location.href = "/api/auth/fitbit";
          return;
        }
        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setError("Fitbit is not set up. Please configure your credentials in Settings.");
          return;
        }
        setError(result.error?.message || "Failed to save changes");
        return;
      }

      onLogged?.(result.data, analysis, mealTypeId);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setError("Request timed out. Please try again.");
      } else {
        Sentry.captureException(err);
        setError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    } finally {
      setLogging(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
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

      {/* Top header */}
      <div className="border-b bg-background px-2 py-2">
        <div className="flex items-center gap-2">
          <h1 className="sr-only">{isEditMode ? "Edit Food" : title}</h1>
          <button
            onClick={isEditMode ? () => router.back() : (onClose ?? (() => {}))}
            aria-label="Back"
            className="shrink-0 flex items-center justify-center size-11 rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {latestAnalysis ? (
            <>
              <span className="flex-1" />
              <Button
                onClick={isEditMode ? handleSave : isEditingExisting ? handleSaveExisting : handleLog}
                disabled={logging}
                className="shrink-0 min-h-[44px]"
              >
                {logging ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {isEditMode || isEditingExisting ? "Saving..." : "Logging..."}
                  </>
                ) : (
                  isEditMode || isEditingExisting ? "Save Changes" : "Log to Fitbit"
                )}
              </Button>
            </>
          ) : (
            <span className="text-lg font-semibold" aria-hidden="true">{isEditMode ? "Edit Food" : title}</span>
          )}
        </div>
      </div>

      {/* Messages — scrollable area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
      >
        {messages.map((msg, idx) => {
          const allDisplayedMessages = messages;
          // Find previous analysis for diff highlighting on this message
          let prevAnalysisForMsg: FoodAnalysis | undefined;
          if (msg.role === "assistant" && msg.analysis && idx > 0) {
            for (let i = idx - 1; i >= 0; i--) {
              if (allDisplayedMessages[i].analysis) {
                prevAnalysisForMsg = allDisplayedMessages[i].analysis;
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
              {msg.isThinking ? (
                <div
                  data-testid="thinking-message"
                  className="max-w-[80%] px-3 py-2 rounded-2xl bg-muted rounded-bl-sm"
                >
                  <p className="text-sm whitespace-pre-wrap italic text-muted-foreground">
                    {msg.content}
                  </p>
                </div>
              ) : (
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted rounded-bl-sm"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  {msg.role === "assistant" && msg.analysis && (idx > 0 || isEditMode) && (
                    <div className="mt-2">
                      <MiniNutritionCard
                        analysis={msg.analysis}
                        previousAnalysis={prevAnalysisForMsg}
                      />
                    </div>
                  )}
                </div>
              )}
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
          <div className="flex items-start gap-2 px-3 py-2 bg-destructive/10 dark:bg-destructive/20 border border-destructive/20 rounded-2xl">
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
            <p className="text-xs text-warning-foreground text-center">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm min-h-[44px]"
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-sm min-h-[44px]"
            >
              <ImageIcon className="h-4 w-4" />
              Gallery
            </button>
          </div>
        )}

        {/* Photo toggle + Text input + Send */}
        <div className="flex items-center gap-1.5 px-2 py-2">
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
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={loading || atLimit}
            maxLength={2000}
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

        {/* Meal type and time selectors */}
        {latestAnalysis && (
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="flex-1 min-w-0">
              <MealTypeSelector
                value={mealTypeId}
                onChange={setMealTypeId}
                showTimeHint={false}
                ariaLabel="Meal type"
              />
            </div>
            <div className="flex-1 min-w-0">
              <TimeSelector value={selectedTime} onChange={setSelectedTime} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
