import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  env: {
    COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "",
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
    ];

    if (process.env.NODE_ENV === "production") {
      // CSP DESIGN NOTES (FOO-1154):
      //
      // Sentry tunnel: all client-side Sentry events are sent to the same-origin /monitoring
      // route handler (tunnel: "/monitoring" in src/instrumentation-client.ts), which forwards
      // them to Sentry server-side, so no direct connect-src sentry.io is needed.
      // connect-src 'self' covers it.
      //
      // script-src keeps 'unsafe-inline' (accepted — see DEVELOPMENT.md): a per-request nonce
      // would need a `src/proxy.ts` that sets the CSP + x-nonce headers on every navigation and a
      // root layout that threads the nonce onto each inline RSC hydration script.
      securityHeaders.push({
        key: "Content-Security-Policy",
        value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://accounts.google.com",
      });
    }

    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
