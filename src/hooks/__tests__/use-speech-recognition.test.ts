import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeechRecognition } from "../use-speech-recognition";

// Capture created instances for test assertions
let mockInstances: MockSpeechRecognition[];

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    mockInstances.push(this);
  }
}

describe("useSpeechRecognition", () => {
  let originalSpeechRecognition: unknown;
  let originalWebkitSpeechRecognition: unknown;

  beforeEach(() => {
    mockInstances = [];
    originalSpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition;
    originalWebkitSpeechRecognition = (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  });

  afterEach(() => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = originalSpeechRecognition;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = originalWebkitSpeechRecognition;
  });

  it("returns isSupported: false when SpeechRecognition is not available", () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    expect(result.current.isSupported).toBe(false);
    expect(result.current.isListening).toBe(false);
  });

  it("returns isSupported: true when SpeechRecognition is available", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    expect(result.current.isSupported).toBe(true);
  });

  it("returns isSupported: true when webkitSpeechRecognition is available", () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    expect(result.current.isSupported).toBe(true);
  });

  it("starts listening when start() is called", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.isListening).toBe(true);
    expect(mockInstances).toHaveLength(1);
    expect(mockInstances[0].start).toHaveBeenCalled();
  });

  it("stops listening when stop() is called", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.stop();
    });
    expect(result.current.isListening).toBe(false);
    expect(mockInstances[0].stop).toHaveBeenCalled();
  });

  it("calls onResult with transcript text", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
    const onResult = vi.fn();

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult })
    );

    act(() => {
      result.current.start();
    });

    const instance = mockInstances[0];

    act(() => {
      instance.onresult?.({
        results: [[{ transcript: "pollo asado", confidence: 0.9 }]],
      });
    });

    expect(onResult).toHaveBeenCalledWith("pollo asado");
  });

  it("sets isListening to false on end event", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      mockInstances[0].onend?.();
    });

    expect(result.current.isListening).toBe(false);
  });

  it("sets isListening to false on error event", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      mockInstances[0].onerror?.({ error: "no-speech" });
    });

    expect(result.current.isListening).toBe(false);
  });

  it("toggle() starts if not listening, stops if listening", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    expect(result.current.isListening).toBe(false);

    // Toggle on
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isListening).toBe(true);

    // Toggle off
    act(() => {
      result.current.toggle();
    });
    expect(result.current.isListening).toBe(false);
  });

  it("does nothing when start() called on unsupported browser", () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition;
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });

    expect(result.current.isListening).toBe(false);
    expect(result.current.isSupported).toBe(false);
  });

  it("uses es-AR as default language", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn() })
    );

    act(() => {
      result.current.start();
    });

    expect(mockInstances[0].lang).toBe("es-AR");
  });

  it("uses custom language when provided", () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    const { result } = renderHook(() =>
      useSpeechRecognition({ onResult: vi.fn(), lang: "en-US" })
    );

    act(() => {
      result.current.start();
    });

    expect(mockInstances[0].lang).toBe("en-US");
  });
});
