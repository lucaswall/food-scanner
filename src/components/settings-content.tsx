"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Monitor, ArrowLeft } from "lucide-react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";

interface SessionInfo {
  email: string | null;
  fitbitConnected: boolean;
  hasFitbitCredentials: boolean;
  expiresAt: number;
}

interface CredentialsInfo {
  hasCredentials: boolean;
  clientId?: string;
}

export function SettingsContent() {
  const { data: session, error } = useSWR<SessionInfo, Error>(
    "/api/auth/session",
    apiFetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );
  const { data: credentials, mutate: mutateCredentials } = useSWR<CredentialsInfo, Error>(
    "/api/fitbit-credentials",
    apiFetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 5000,
    }
  );
  const { theme, setTheme } = useTheme();

  const [editingClientId, setEditingClientId] = useState(false);
  const [clientIdValue, setClientIdValue] = useState("");
  const [replacingSecret, setReplacingSecret] = useState(false);
  const [secretValue, setSecretValue] = useState("");
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);
  const [showReauth, setShowReauth] = useState(false);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort logout — redirect anyway to clear client state
    }
    window.location.href = "/";
  }

  async function handleSaveClientId() {
    if (!clientIdValue.trim()) return;
    setCredentialsSaving(true);
    setCredentialsError(null);
    try {
      const res = await fetch("/api/fitbit-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: clientIdValue.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to update");
      }
      setEditingClientId(false);
      setShowReauth(true);
      await mutateCredentials();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setCredentialsSaving(false);
    }
  }

  async function handleReplaceSecret() {
    if (!secretValue.trim()) return;
    setCredentialsSaving(true);
    setCredentialsError(null);
    try {
      const res = await fetch("/api/fitbit-credentials", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSecret: secretValue.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to update");
      }
      setReplacingSecret(false);
      setSecretValue("");
      setShowReauth(true);
      await mutateCredentials();
    } catch (err) {
      setCredentialsError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setCredentialsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
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
          <p className="text-sm text-destructive">{error.message}</p>
        )}
        {session && (
          <div className="flex flex-col gap-1 text-sm">
            {session.email && <p className="text-muted-foreground">{session.email}</p>}
            <p>
              Fitbit:{" "}
              {session.fitbitConnected && !session.hasFitbitCredentials ? (
                <span className="text-warning">
                  Connected (credentials missing)
                </span>
              ) : (
                <span
                  className={
                    session.fitbitConnected
                      ? "text-success"
                      : "text-destructive"
                  }
                >
                  {session.fitbitConnected ? "Connected" : "Not connected"}
                </span>
              )}
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
        <h2 className="text-lg font-semibold">Fitbit App Credentials</h2>

        {credentialsError && (
          <p className="text-sm text-destructive">{credentialsError}</p>
        )}

        {credentials && !credentials.hasCredentials && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">No Fitbit credentials configured.</p>
            <Button asChild variant="outline" className="min-h-[44px]">
              <Link href="/app/setup-fitbit">Set up Fitbit credentials</Link>
            </Button>
          </div>
        )}

        {credentials?.hasCredentials && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor="fitbit-client-id" className="text-sm font-medium">Client ID</label>
              {editingClientId ? (
                <div className="flex gap-2">
                  <Input
                    id="fitbit-client-id"
                    value={clientIdValue}
                    onChange={(e) => setClientIdValue(e.target.value)}
                    className="min-h-[44px]"
                    placeholder="Enter Client ID"
                  />
                  <Button
                    onClick={handleSaveClientId}
                    disabled={credentialsSaving || !clientIdValue.trim()}
                    className="min-h-[44px] shrink-0"
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setEditingClientId(false)}
                    className="min-h-[44px] shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1 text-sm">
                    {credentials.clientId}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] shrink-0"
                    onClick={() => {
                      setClientIdValue(credentials.clientId || "");
                      setEditingClientId(true);
                    }}
                  >
                    Edit
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="fitbit-client-secret" className="text-sm font-medium">Client Secret</label>
              {replacingSecret ? (
                <div className="flex gap-2">
                  <Input
                    id="fitbit-client-secret"
                    type="password"
                    value={secretValue}
                    onChange={(e) => setSecretValue(e.target.value)}
                    className="min-h-[44px]"
                    placeholder="Enter new Client Secret"
                  />
                  <Button
                    onClick={handleReplaceSecret}
                    disabled={credentialsSaving || !secretValue.trim()}
                    className="min-h-[44px] shrink-0"
                  >
                    Save
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { setReplacingSecret(false); setSecretValue(""); }}
                    className="min-h-[44px] shrink-0"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1 text-sm">
                    ••••••••
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-[44px] shrink-0"
                    onClick={() => setReplacingSecret(true)}
                  >
                    Replace Secret
                  </Button>
                </div>
              )}
            </div>

            {showReauth && (
              <form action="/api/auth/fitbit" method="POST">
                <Button type="submit" variant="default" className="w-full min-h-[44px]">
                  Re-authorize Fitbit
                </Button>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex gap-2">
          <Button
            variant={theme === "light" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("light")}
          >
            <Sun className="mr-2 h-4 w-4" />
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("dark")}
          >
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </Button>
          <Button
            variant={theme === "system" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("system")}
          >
            <Monitor className="mr-2 h-4 w-4" />
            System
          </Button>
        </div>
      </div>
    </div>
  );
}
