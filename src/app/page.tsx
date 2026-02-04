export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-zinc-950">
      <main className="flex flex-col items-center gap-8 px-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Food Logger
          </h1>
          <p className="text-lg text-zinc-500 dark:text-zinc-400">
            AI-powered food logging for Fitbit
          </p>
        </div>

        <div className="flex flex-col items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-3xl dark:bg-zinc-800">
            📸
          </div>
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
            Coming Soon
          </h2>
          <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
            Take a photo of your meal, let AI analyze the nutrition, and log it
            directly to Fitbit. One tap, done.
          </p>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          Single-user application
        </p>
      </main>
    </div>
  );
}
