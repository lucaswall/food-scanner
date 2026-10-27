import { describe, it, expect } from "vitest";
import { scrubSentryEvent } from "@/lib/sentry-scrub";

describe("scrubSentryEvent", () => {
  it("removes cookies, request body and sensitive headers (case-insensitive)", () => {
    const event = scrubSentryEvent({
      request: {
        url: "http://localhost/api/x",
        cookies: { "food-scanner-session": "sealed" },
        data: { images: ["base64..."] },
        headers: {
          Cookie: "food-scanner-session=sealed",
          Authorization: "Bearer fsk_secret",
          "X-Api-Key": "k",
          "content-type": "application/json",
        },
      },
    });

    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.headers).toEqual({ "content-type": "application/json" });
    expect(event.request?.url).toBe("http://localhost/api/x");
  });

  it("returns events without a request untouched", () => {
    const event = { message: "hello" };
    expect(scrubSentryEvent(event)).toBe(event);
  });
});
