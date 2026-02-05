import "@testing-library/jest-dom/vitest";

// Mock Worker global for heic2any library which requires Web Workers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).Worker = class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string | URL) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  postMessage(_message: unknown): void {}

  terminate(): void {}
};
