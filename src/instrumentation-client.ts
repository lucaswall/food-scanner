import * as Sentry from "@sentry/nextjs";

function getEnvironment(): string {
  if (process.env.NODE_ENV === "development") return "development";
  if (typeof window !== "undefined" && window.location.hostname.includes("food-test")) return "staging";
  return "production";
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: getEnvironment(),
  release: process.env.COMMIT_SHA || undefined,
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: [Sentry.replayIntegration()],
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
