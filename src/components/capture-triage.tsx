"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCaptureSession } from "@/hooks/use-capture-session";
import { SessionItemsList } from "@/components/session-items-list";
import { parseSSEEvents } from "@/lib/sse";
import { invalidateSavedAnalysesCaches } from "@/lib/swr";
import { safeResponseJson } from "@/lib/safe-json";
import { ChatMarkdown } from "@/components/chat-markdown";
import type { FoodAnalysis, ConversationMessage } from "@/types";

type TriageState = "preview" | "analyzing" | "results" | "saving" | "done";

export function CaptureTriage() {
  const router = useRouter();
  const { state: sessionState, actions, isRestoring } = useCaptureSession();
  const { captures } = sessionState;

  const [triageState, setTriageState] = useState<TriageState>("preview");
  const [sessionItems, setSessionItems] = useState<FoodAnalysis[]>([]);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [narrative, setNarrative] = useState("");
  const narrativeRef = useRef("");
  const [chatInput, setChatInput] = useState("");
  const [isChatSending, setIsChatSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});

  const abortControllerRef = useRef<AbortController | null>(null);

  // Redirect when no captures and not restoring
  useEffect(() => {
    if (!isRestoring && captures.length === 0) {
      router.replace("/app");
    }
  }, [isRestoring, captures.length, router]);

  // Load thumbnails for preview
  useEffect(() => {
    if (triageState !== "preview") return;
    let cancelled = false;
    const createdUrls: string[] = [];

    async function loadThumbnails() {
      const newThumbnails: Record<string, string> = {};
      for (const capture of captures) {
        try {
          const blobs = await actions.getCaptureBlobs(capture.id);
          if (blobs.length > 0 && !cancelled) {
            const url = URL.createObjectURL(blobs[0]);
            createdUrls.push(url);
            newThumbnails[capture.id] = url;
          }
        } catch {
          // skip failed thumbnails
        }
      }
      if (!cancelled) {
        setThumbnails(newThumbnails);
      }
    }

    loadThumbnails();
    return () => {
      cancelled = true;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [captures, triageState, actions]);

  // Cleanup thumbnail object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(thumbnails).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [thumbnails]);

  const consumeSSEStream = useCallback(async (
    response: Response,
    onSessionItems: (items: FoodAnalysis[]) => void,
    onTextDelta?: (text: string) => void,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (!response.body) return { ok: false, error: "No response body" };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEEvents(chunk, buffer);
        buffer = remaining;

        for (const event of events) {
          if (event.type === "text_delta") {
            onTextDelta?.(event.text);
          } else if (event.type === "session_items") {
            onSessionItems(event.items);
          } else if (event.type === "error") {
            return { ok: false, error: event.message };
          } else if (event.type === "done") {
            return { ok: true };
          }
        }
      }
      return { ok: true };
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }, []);

  const handleAnalyzeAll = useCallback(async () => {
    setError(null);
    setTriageState("analyzing");
    setNarrative("");
    narrativeRef.current = "";

    const formData = new FormData();
    const captureMetadataArray: Array<{
      captureId: string;
      imageCount: number;
      note: string | null;
      capturedAt: string;
    }> = [];

    // Load blobs for each capture in order
    const sortedCaptures = [...captures].sort((a, b) => a.order - b.order);
    let skippedCount = 0;
    for (const capture of sortedCaptures) {
      const blobs = capture.imageCount > 0
        ? await actions.getCaptureBlobs(capture.id)
        : [];
      // Skip captures with expected images but missing blobs (evicted by browser)
      // Keep text-only captures (imageCount=0 with a note)
      if (blobs.length === 0 && capture.imageCount > 0) {
        skippedCount++;
        continue;
      }
      if (blobs.length === 0 && !capture.note) {
        skippedCount++;
        continue;
      }
      for (const blob of blobs) {
        const file = new File([blob], `capture-${capture.id}.jpg`, { type: blob.type || "image/jpeg" });
        formData.append("images", file);
      }
      // Format capturedAt in local timezone so Claude uses local time for HH:mm
      const localDate = new Date(capture.capturedAt);
      const localIso = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}T${String(localDate.getHours()).padStart(2, "0")}:${String(localDate.getMinutes()).padStart(2, "0")}:${String(localDate.getSeconds()).padStart(2, "0")}`;
      captureMetadataArray.push({
        captureId: capture.id,
        imageCount: blobs.length,
        note: capture.note,
        capturedAt: localIso,
      });
    }

    if (skippedCount > 0) {
      console.warn(`Skipped ${skippedCount} capture(s) with missing images`);
    }

    if (captureMetadataArray.length === 0) {
      setError("No valid captures to analyze.");
      setTriageState("preview");
      return;
    }

    formData.append("captureMetadata", JSON.stringify(captureMetadataArray));
    formData.append("clientDate", new Date().toISOString().split("T")[0]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/process-captures", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        const result = await safeResponseJson(response) as { error?: { message?: string } };
        setError(result.error?.message || "Failed to process captures");
        setTriageState("preview");
        return;
      }

      let finalItems: FoodAnalysis[] = [];

      const result = await consumeSSEStream(
        response,
        (items) => {
          finalItems = items;
          setSessionItems(items);
        },
        (text) => {
          narrativeRef.current += text;
          setNarrative((prev) => prev + text);
        }
      );

      if (!result.ok) {
        setError(result.error || "Failed to analyze captures");
        setTriageState("preview");
        return;
      }

      // Build initial conversation message
      setMessages([{ role: "assistant", content: narrativeRef.current, sessionItems: finalItems }]);
      setTriageState("results");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to analyze captures. Please try again.");
      setTriageState("preview");
    }
  }, [captures, actions, consumeSSEStream]);

  const handleChatSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || triageState !== "results" || isChatSending) return;

    setChatInput("");
    setError(null);
    setIsChatSending(true);

    const userMessage: ConversationMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat-captures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages,
          initialItems: sessionItems,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const result = await safeResponseJson(response) as { error?: { message?: string } };
        setError(result.error?.message || "Failed to process message");
        return;
      }

      let assistantText = "";
      let hadSessionItems = false;
      setNarrative("");
      narrativeRef.current = "";

      const result = await consumeSSEStream(
        response,
        (items) => {
          hadSessionItems = true;
          setSessionItems(items);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              return [...prev.slice(0, -1), { ...last, sessionItems: items }];
            }
            return [...prev, { role: "assistant", content: narrativeRef.current, sessionItems: items }];
          });
        },
        (text) => {
          assistantText += text;
          narrativeRef.current += text;
          setNarrative((prev) => prev + text);
        }
      );

      // If Claude responded with text only (no tool call), append assistant message
      if (!hadSessionItems && assistantText && result.ok) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role !== "assistant") {
            return [...prev, { role: "assistant", content: assistantText }];
          }
          return prev;
        });
      }

      // Clear streaming narrative once finalized into messages
      setNarrative("");
      narrativeRef.current = "";

      if (!result.ok) {
        setError(result.error || "Failed to process message");
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to send message. Please try again.");
    } finally {
      setIsChatSending(false);
    }
  }, [chatInput, triageState, isChatSending, messages, sessionItems, consumeSSEStream]);

  const handleApproveAndSave = useCallback(async () => {
    setError(null);
    setTriageState("saving");

    try {
      const response = await fetch("/api/saved-analyses/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: sessionItems }),
      });

      if (!response.ok) {
        const result = await safeResponseJson(response) as { error?: { message?: string } };
        setError(result.error?.message || "Failed to save items");
        setTriageState("results");
        return;
      }

      const result = await response.json() as {
        success: boolean;
        data?: { items: Array<{ id: number; createdAt: string }> };
      };

      if (!result.success) {
        setError("Failed to save items");
        setTriageState("results");
        return;
      }

      const savedCount = result.data?.items.length ?? sessionItems.length;
      setSuccessCount(savedCount);

      await actions.clearSession();
      await invalidateSavedAnalysesCaches();

      setTriageState("done");
    } catch {
      setError("Failed to save items. Please try again.");
      setTriageState("results");
    }
  }, [sessionItems, actions]);

  // Done state — navigate after brief moment
  useEffect(() => {
    if (triageState !== "done") return;
    const timer = setTimeout(() => {
      router.push("/app");
    }, 2000);
    return () => clearTimeout(timer);
  }, [triageState, router]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // While restoring
  if (isRestoring) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (captures.length === 0) {
    return null;
  }

  const sortedCaptures = [...captures].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-4">
      {/* Error banner */}
      {error && (
        <div
          data-testid="error-banner"
          className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Preview state */}
      {triageState === "preview" && (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            {sortedCaptures.map((capture) => (
              <div
                key={capture.id}
                data-testid={`capture-card-${capture.id}`}
                className="flex gap-3 rounded-lg border p-3"
              >
                {thumbnails[capture.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbnails[capture.id]}
                    alt={capture.note ?? "Captured food"}
                    className="w-16 h-16 rounded object-cover shrink-0"
                  />
                ) : capture.imageCount === 0 ? (
                  <div className="w-16 h-16 rounded bg-muted shrink-0 flex items-center justify-center">
                    <span className="text-xs text-muted-foreground">Text</span>
                  </div>
                ) : null}
                <div className="flex-1 min-w-0">
                  {capture.note && (
                    <p className="text-sm font-medium truncate">{capture.note}</p>
                  )}
                  {capture.imageCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {capture.imageCount} photo{capture.imageCount !== 1 ? "s" : ""}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {new Date(capture.capturedAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <Button
            data-testid="analyze-all-btn"
            onClick={handleAnalyzeAll}
            className="w-full"
          >
            Analyze All
          </Button>
        </div>
      )}

      {/* Analyzing state */}
      {triageState === "analyzing" && (
        <div
          data-testid="analyzing-state"
          className="flex flex-col items-center gap-3 py-8"
        >
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Analyzing your captures…</p>
          {narrative && (
            <div className="text-muted-foreground text-center max-w-xs">
              <ChatMarkdown content={narrative} />
            </div>
          )}
        </div>
      )}

      {/* Results state */}
      {triageState === "results" && (
        <div className="flex flex-col gap-4">
          {/* Conversation log */}
          {messages.length > 0 && (
            <div data-testid="conversation-log" className="flex flex-col gap-2">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded-lg px-3 py-2 ${
                    msg.role === "user"
                      ? "text-sm bg-primary/10 text-primary ml-8"
                      : "bg-muted text-muted-foreground mr-8"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Streaming refinement indicator */}
          {isChatSending && (
            <div data-testid="refine-loading" className="flex items-start gap-2 mr-8">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-muted-foreground">
                {narrative ? (
                  <ChatMarkdown content={narrative} />
                ) : (
                  <p className="text-sm">Thinking&#8230;</p>
                )}
              </div>
            </div>
          )}

          <SessionItemsList
            items={sessionItems}
            onRemoveItem={(index) => {
              setSessionItems((prev) => prev.filter((_, i) => i !== index));
            }}
          />

          {/* Chat input */}
          <div className="flex gap-2">
            <Input
              data-testid="chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              placeholder="Refine the items…"
              className="flex-1"
              disabled={isChatSending}
            />
            <Button
              data-testid="chat-send-btn"
              onClick={handleChatSend}
              disabled={!chatInput.trim() || isChatSending}
              size="icon"
              aria-label="Send"
            >
              {isChatSending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-4 h-4" aria-hidden="true" />
              )}
            </Button>
          </div>

          <Button
            data-testid="approve-save-btn"
            onClick={handleApproveAndSave}
            disabled={sessionItems.length === 0 || isChatSending}
            className="w-full"
          >
            Approve &amp; Save
          </Button>
        </div>
      )}

      {/* Saving state */}
      {triageState === "saving" && (
        <div
          data-testid="saving-state"
          className="flex flex-col items-center gap-3 py-8"
        >
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-sm font-medium">Saving…</p>
        </div>
      )}

      {/* Done state */}
      {triageState === "done" && (
        <div
          data-testid="save-success-banner"
          className="rounded-lg border border-green-500 bg-green-50 dark:bg-green-950 p-4 text-center"
        >
          <p className="text-sm font-medium text-green-700 dark:text-green-300">
            {successCount} item{successCount !== 1 ? "s" : ""} saved — find them in Saved for Later on your dashboard
          </p>
        </div>
      )}
    </div>
  );
}
