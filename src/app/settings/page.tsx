"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Monitor, ArrowLeft } from "lucide-react";
import useSWR from "swr";

interface SessionInfo {
  email: string;
  fitbitConnected: boolean;
  expiresAt: number;
}

async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch("/api/auth/session");
  if (!res.ok) throw new Error("Failed to load session");
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.error?.message || "Failed to load session");
  }
  return data.data;
}

export default function SettingsPage() {
  const { data: session, error } = useSWR<SessionInfo, Error>(
    "/api/auth/session",
    fetchSession,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );
  const { theme, setTheme } = useTheme();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
            <Link href="/app" aria-label="Back to Food Scanner">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
          {error && (
            <p className="text-sm text-red-500">{error.message}</p>
          )}
          {session && (
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-muted-foreground">{session.email}</p>
              <p>
                Fitbit:{" "}
                <span
                  className={
                    session.fitbitConnected
                      ? "text-green-600"
                      : "text-red-600"
                  }
                >
                  {session.fitbitConnected ? "Connected" : "Not connected"}
                </span>
              </p>
            </div>
          )}

          <form action="/api/auth/fitbit" method="POST">
            <Button type="submit" variant="outline" className="w-full">
              Reconnect Fitbit
            </Button>
          </form>

          <Button
            variant="destructive"
            className="w-full"
            onClick={handleLogout}
          >
            Logout
          </Button>
        </div>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
          <h2 className="text-lg font-semibold">Appearance</h2>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              size="sm"
              className="flex-1 min-h-[44px]"
              onClick={() => setTheme("light")}
              aria-label="Light"
            >
              <Sun className="mr-2 h-4 w-4" />
              Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              size="sm"
              className="flex-1 min-h-[44px]"
              onClick={() => setTheme("dark")}
              aria-label="Dark"
            >
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </Button>
            <Button
              variant={theme === "system" ? "default" : "outline"}
              size="sm"
              className="flex-1 min-h-[44px]"
              onClick={() => setTheme("system")}
              aria-label="System"
            >
              <Monitor className="mr-2 h-4 w-4" />
              System
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
