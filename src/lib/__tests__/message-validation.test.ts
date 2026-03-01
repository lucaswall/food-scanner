import { describe, it, expect } from "vitest";
import { validateChatMessages } from "@/lib/message-validation";

// Small helper to build a minimal valid message
function userMsg(content: string) {
  return { role: "user", content };
}

describe("validateChatMessages", () => {
  it("returns error when messages is not an array", () => {
    const result = validateChatMessages("not an array");
    expect(result.ok).toBe(false);
  });

  it("returns error when messages is missing (undefined)", () => {
    const result = validateChatMessages(undefined);
    expect(result.ok).toBe(false);
  });

  it("returns error when messages array is empty", () => {
    const result = validateChatMessages([]);
    expect(result.ok).toBe(false);
  });

  it("returns error when messages exceed maxMessages", () => {
    const messages = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "test",
    }));
    const result = validateChatMessages(messages, 30);
    expect(result.ok).toBe(false);
  });

  it("returns error when a message has invalid role", () => {
    const result = validateChatMessages([{ role: "system", content: "test" }]);
    expect(result.ok).toBe(false);
  });

  it("returns error when a message has non-string content", () => {
    const result = validateChatMessages([{ role: "user", content: 123 }]);
    expect(result.ok).toBe(false);
  });

  it("returns error when message content exceeds 2000 chars", () => {
    const result = validateChatMessages([{ role: "user", content: "x".repeat(2001) }]);
    expect(result.ok).toBe(false);
  });

  it("returns error when message is not an object", () => {
    const result = validateChatMessages(["just a string"]);
    expect(result.ok).toBe(false);
  });

  it("returns ok with validated messages on valid input", () => {
    const result = validateChatMessages([userMsg("Hello")]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe("Hello");
    }
  });

  it("returns totalImageCount of 0 when no images", () => {
    const result = validateChatMessages([userMsg("Hello")]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalImageCount).toBe(0);
    }
  });

  it("returns error when images are on assistant messages", () => {
    const result = validateChatMessages([
      { role: "assistant", content: "Hi", images: ["abc123"] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error when images is not an array", () => {
    const result = validateChatMessages([
      { role: "user", content: "test", images: "abc123" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error when an image is not a string", () => {
    const result = validateChatMessages([
      { role: "user", content: "test", images: [123] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error when an image is an empty string", () => {
    const result = validateChatMessages([
      { role: "user", content: "test", images: [""] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error when an image is not valid base64", () => {
    const result = validateChatMessages([
      { role: "user", content: "test", images: ["not!valid@base64"] },
    ]);
    expect(result.ok).toBe(false);
  });

  it("returns error when total images exceed max", () => {
    const images = Array.from({ length: 10 }, () => "dmFsaWQ="); // valid base64 "valid"
    const result = validateChatMessages(
      [{ role: "user", content: "test", images }],
      30,
      9
    );
    expect(result.ok).toBe(false);
  });

  it("counts images across multiple messages", () => {
    const img = "dmFsaWQ="; // valid base64
    const result = validateChatMessages([
      { role: "user", content: "first", images: [img] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "second", images: [img, img] },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalImageCount).toBe(3);
    }
  });

  it("uses default maxMessages of 30 when not specified", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "test",
    }));
    const result = validateChatMessages(messages);
    expect(result.ok).toBe(true);
  });
});
