import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("food-scanner-session");
  const { pathname } = request.nextUrl;

  if (!sessionCookie || !sessionCookie.value?.trim()) {
    // API routes get 401 JSON
    if (pathname.startsWith("/api/")) {
      logger.warn(
        { path: pathname, action: "denied", reason: "missing_session" },
        "unauthenticated api request",
      );
      return Response.json(
        {
          success: false,
          error: { code: "AUTH_MISSING_SESSION", message: "Not authenticated" },
          timestamp: Date.now(),
        },
        { status: 401 },
      );
    }

    // Page routes redirect to landing (include returnTo for deep links, not for /app root)
    logger.warn(
      { path: pathname, action: "redirect", reason: "missing_session" },
      "unauthenticated page request",
    );
    const redirectUrl = new URL("/", request.url);
    if (pathname !== "/app") {
      redirectUrl.searchParams.set("returnTo", pathname);
    }
    return NextResponse.redirect(redirectUrl);
  }

  logger.debug({ path: pathname, action: "allowed" }, "authenticated request");
  return NextResponse.next();
}

// Force Node.js runtime (pino requires Node.js APIs, not compatible with Edge Runtime)
export const runtime = "nodejs";

export const config = {
  matcher: ["/app/:path*", "/settings/:path*", "/api/((?!health|auth|v1).*)"],
};
