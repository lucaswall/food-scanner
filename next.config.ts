import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

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
      // Sentry tunnel: all client-side Sentry events are routed through the same-origin
      // /monitoring tunnel endpoint (tunnelRoute: "/monitoring" in withSentryConfig below).
      // The @sentry/nextjs build plugin injects the tunnel URL into the compiled client bundle
      // at build time, so no direct connect-src sentry.io is needed. connect-src 'self' covers it.
      //
      // CSP nonce (deferred): replacing 'unsafe-inline' with a per-request nonce for script-src
      // requires generating a nonce in middleware.ts and propagating it to Next.js App Router's
      // inline hydration scripts via the `x-nonce` header pattern. The Next.js App Router
      // (v14+) generates inline <script> tags for RSC hydration that must carry the nonce —
      // this requires the experimental `headers().get("x-nonce")` pattern in root layout, plus
      // the middleware must set both the CSP header (with nonce) and the x-nonce header on
      // every navigation request. The change touches middleware.ts, root layout.tsx, and this
      // file. Given the scope and the risk of breakage on the hydration path, this is deferred
      // to a dedicated task. The 'unsafe-inline' allowance is acceptable in the interim.
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
  tunnelRoute: "/monitoring",
});
