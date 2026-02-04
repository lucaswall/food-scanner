"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold">Something went wrong</h2>
            <button
              onClick={() => reset()}
              className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
