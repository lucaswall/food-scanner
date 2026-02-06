"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("Global error:", {
        message: error.message,
        digest: error.digest,
        stack: error.stack,
      });
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            {process.env.NODE_ENV === "development" && error.digest && (
              <p className="mt-2 text-sm text-gray-500">
                Error ID: {error.digest}
              </p>
            )}
            <button
              onClick={() => reset()}
              className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
