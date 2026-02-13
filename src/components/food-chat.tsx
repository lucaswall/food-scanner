"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealTypeSelector } from "./meal-type-selector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import type {
  FoodAnalysis,
  FoodLogResponse,
  ConversationMessage,
  ChatFoodResponse,
} from "@/types";

interface FoodChatProps {
  initialAnalysis: FoodAnalysis;
  compressedImages: Blob[];
  onClose: () => void;
  onLogged: (response: FoodLogResponse) => void;
}

function AnalysisSummary({ analysis }: { analysis: FoodAnalysis }) {
  return (
    <div className="mt-2 pt-2 border-t border-current/10 text-xs space-y-0.5">
      <p className="font-medium">{analysis.food_name}</p>
      <p className="opacity-80">
        {analysis.amount}
        {analysis.unit_id === 147 ? "g" : analysis.unit_id === 209 ? "ml" : " units"}
        {" · "}
        {analysis.calories} cal
      </p>
      <p className="opacity-60">
        P: {analysis.protein_g}g · C: {analysis.carbs_g}g · F: {analysis.fat_g}g
      </p>
    </div>
  );
}

export function FoodChat({
  initialAnalysis,
  compressedImages,
  onClose,
  onLogged,
}: FoodChatProps) {
  const initialMessage: ConversationMessage = {
    role: "assistant",
    content: `I analyzed your food as ${initialAnalysis.food_name} (${initialAnalysis.calories} cal). Anything you'd like to correct?`,
    analysis: initialAnalysis,
  };

  const [messages, setMessages] = useState<ConversationMessage[]>([
    initialMessage,
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [images, setImages] = useState<Blob[]>(compressedImages);
  const [imagesSent, setImagesSent] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const latestAnalysis =
    [...messages]
      .reverse()
      .find((msg) => msg.analysis)?.analysis || initialAnalysis;

  // Images are pending if we have them and haven't sent the first message yet
  const pendingImageCount = imagesSent ? 0 : images.length;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

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
    setImages([]);
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ConversationMessage = {
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const allMessages = [...messages, userMessage];
      const apiMessages = allMessages.slice(1);

      const requestBody: {
        messages: ConversationMessage[];
        images?: string[];
      } = {
        messages: apiMessages,
      };

      // Include images on first user turn
      if (!imagesSent && images.length > 0) {
        const base64Images = await Promise.all(
          images.map(async (blob) => {
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
        requestBody.images = base64Images;
        setImagesSent(true);
      }

      const response = await fetch("/api/chat-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: ChatFoodResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
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
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLog = async () => {
    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...latestAnalysis,
          mealTypeId,
          ...getLocalDateTime(),
        }),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        setError(result.error?.message || "Failed to log food to Fitbit");
        return;
      }

      onLogged(result.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* Floating back button */}
      <button
        onClick={onClose}
        aria-label="Back"
        className="fixed top-3 left-3 z-[61] flex items-center justify-center size-11 rounded-full bg-background/80 backdrop-blur-sm shadow-md border"
      >
        <ArrowLeft className="h-5 w-5" />
      </button>

      {/* Hidden file inputs for camera menu */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.heic,.heif"
        capture="environment"
        className="hidden"
        data-testid="chat-camera-input"
        onChange={() => {
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
        onChange={() => {
          if (galleryInputRef.current) galleryInputRef.current.value = "";
        }}
      />

      {/* Messages — full screen scrollable */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 pt-16 pb-2 space-y-2"
      >
        {messages.map((msg, idx) => (
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
                <AnalysisSummary analysis={msg.analysis} />
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start" data-testid="chat-loading">
            <div className="px-3 py-2 rounded-2xl bg-muted rounded-bl-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 bg-destructive/10 border border-destructive/20 rounded-2xl">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom anchored area */}
      <div className="relative border-t bg-background">
        {/* Scroll-to-bottom button */}
        {showScrollDown && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
            className="absolute -top-12 right-3 flex items-center justify-center size-9 rounded-full bg-background shadow-md border"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        )}

        {/* Photo attachment indicator */}
        {pendingImageCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 pt-2">
            <div
              data-testid="photo-indicator"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs text-muted-foreground"
            >
              <Paperclip className="h-3 w-3" />
              <span>
                {pendingImageCount} photo{pendingImageCount !== 1 ? "s" : ""}
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

        {/* Line 1: Camera menu + Text input + Send */}
        <div className="flex items-center gap-1.5 px-2 pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="Add photo"
              >
                <Plus className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-0">
              <DropdownMenuItem
                onClick={() => cameraInputRef.current?.click()}
                aria-label="Take photo"
                className="justify-center px-3"
              >
                <Camera className="h-5 w-5" />
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => galleryInputRef.current?.click()}
                aria-label="Choose from gallery"
                className="justify-center px-3"
              >
                <ImageIcon className="h-5 w-5" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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
            disabled={loading}
            className="flex-1 min-h-[44px] rounded-full"
          />

          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
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

        {/* Line 2: Meal type (left) + Log to Fitbit (right) */}
        <div className="flex items-center gap-2 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex-1">
            <MealTypeSelector
              value={mealTypeId}
              onChange={setMealTypeId}
              showTimeHint={false}
            />
          </div>
          <Button onClick={handleLog} className="flex-1 min-h-[44px]">
            Log to Fitbit
          </Button>
        </div>
      </div>
    </div>
  );
}
