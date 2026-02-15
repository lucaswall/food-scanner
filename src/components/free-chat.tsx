"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ArrowLeft, Loader2, ChevronDown, X } from "lucide-react";
import { safeResponseJson } from "@/lib/safe-json";
import { getTodayDate } from "@/lib/date-utils";

const MAX_MESSAGES = 30;

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function FreeChat() {
  const router = useRouter();

  const initialMessage: Message = {
    role: "assistant",
    content:
      "Hi! I can help you explore your nutrition data. Ask me anything — what you've eaten, your macro progress, fasting patterns, or meal suggestions based on your history.",
  };

  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Count messages excluding the initial client-generated assistant message
  const apiMessageCount = messages.length - 1;
  const nearLimit = apiMessageCount >= MAX_MESSAGES - 4;
  const atLimit = apiMessageCount >= MAX_MESSAGES;

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

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const allMessages = [...messages, userMessage];
      const apiMessages = allMessages.slice(1); // Exclude initial greeting

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, clientDate: getTodayDate() }),
        signal: AbortSignal.timeout(30000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: { message: string };
        error?: { code: string; message: string };
      };

      if (!response.ok || !result.success || !result.data) {
        setMessages((prev) => prev.slice(0, -1));
        setInput(userMessage.content);
        setError(result.error?.message || "Failed to process message");
        return;
      }

      const assistantMessage: Message = {
        role: "assistant",
        content: result.data.message,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setMessages((prev) => prev.slice(0, -1));
      setInput(userMessage.content);
      if (
        err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
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

  const handleBack = () => {
    router.push("/app");
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      {/* Top header */}
      <div className="border-b bg-background px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            aria-label="Back"
            className="shrink-0 flex items-center justify-center size-11 rounded-full"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold">Chat</h1>
        </div>
      </div>

      {/* Messages — scrollable area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2"
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
            <p
              data-testid="limit-warning"
              className="text-xs text-muted-foreground text-center"
            >
              Message limit reached — start a new conversation to continue.
            </p>
          </div>
        )}
        {nearLimit && !atLimit && (
          <div className="px-3 pt-2">
            <p
              data-testid="limit-warning"
              className="text-xs text-muted-foreground text-center"
            >
              {MAX_MESSAGES - apiMessageCount} messages remaining
            </p>
          </div>
        )}

        {/* Text input + Send */}
        <div className="flex items-center gap-1.5 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
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
            disabled={!input.trim() || loading || atLimit}
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
