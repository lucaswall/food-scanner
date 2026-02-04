"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

interface SessionInfo {
  email: string;
  fitbitConnected: boolean;
  expiresAt: number;
}

export default function SettingsPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setSession(data.data);
        }
      });
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
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
      </main>
    </div>
  );
}
