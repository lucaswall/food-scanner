import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const sessionCookie = request.cookies.get("food-scanner-session");

  if (!sessionCookie) {
    const { pathname } = request.nextUrl;

    // API routes get 401 JSON
    if (pathname.startsWith("/api/")) {
      return Response.json(
        {
          success: false,
          error: { code: "AUTH_MISSING_SESSION", message: "Not authenticated" },
          timestamp: Date.now(),
        },
        { status: 401 },
      );
    }

    // Page routes redirect to landing
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/settings/:path*", "/api/((?!health|auth).*)"],
};
