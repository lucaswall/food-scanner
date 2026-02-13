"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MealTypeSelector } from "./meal-type-selector";
import { PhotoCapture } from "./photo-capture";
import { Send, X, Loader2 } from "lucide-react";
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

export function FoodChat({
  initialAnalysis,
  compressedImages,
  onClose,
  onLogged,
}: FoodChatProps) {
  // Generate initial assistant message
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
  const [images] = useState<Blob[]>(compressedImages);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Extract latest analysis from messages (last message with analysis field)
  const latestAnalysis =
    [...messages]
      .reverse()
      .find((msg) => msg.analysis)?.analysis || initialAnalysis;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ConversationMessage = {
      role: "user",
      content: input.trim(),
    };

    // Add user message to state
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      // Build API messages: skip the initial assistant message (UI-only)
      // so the conversation starts with user (required by Anthropic API)
      const allMessages = [...messages, userMessage];
      const apiMessages = allMessages.slice(1); // drop initial assistant

      const requestBody: {
        messages: ConversationMessage[];
        images?: string[];
      } = {
        messages: apiMessages,
      };

      // Include images on first user turn
      if (messages.length === 1 && images.length > 0) {
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

      // Add assistant response to state
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

      // Call parent callback with the response
      onLogged(result.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    }
  };

  return (
    <div className="flex flex-col h-full max-h-[80vh]">
      {/* Header with close button */}
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Chat about your food</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close"
          className="min-h-[44px] min-w-[44px]"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Message list (scrollable) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start" data-testid="chat-loading">
            <div className="max-w-[80%] p-3 rounded-lg bg-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Pinned controls at bottom */}
      <div className="border-t p-4 space-y-3">
        {/* Meal type selector */}
        <div className="space-y-2">
          <MealTypeSelector value={mealTypeId} onChange={setMealTypeId} />
        </div>

        {/* Log to Fitbit button */}
        <Button
          onClick={handleLog}
          className="w-full min-h-[44px]"
          variant="default"
        >
          Log to Fitbit
        </Button>

        {/* Input bar with camera and send button */}
        <div className="flex gap-2">
          <PhotoCapture
            onPhotosChange={() => {
              // Inline camera for adding more photos - placeholder for now
            }}
          />
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
            className="flex-1 min-h-[44px]"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            aria-label="Send"
            className="min-h-[44px] min-w-[44px]"
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
