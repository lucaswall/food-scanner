"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FitbitSetupForm() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFormValid = clientId.trim().length > 0 && clientSecret.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/fitbit-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error?.message || "Failed to save credentials");
        setIsLoading(false);
        return;
      }

      // Redirect to Fitbit OAuth flow
      window.location.href = "/api/auth/fitbit";
    } catch {
      setError("An unexpected error occurred");
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Fitbit App Credentials</h2>
        <p className="text-sm text-muted-foreground">
          Each Fitbit user needs their own Personal app from the{" "}
          <a
            href="https://dev.fitbit.com/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:no-underline"
          >
            Fitbit developer console
          </a>
          . Find your Client ID and Client Secret there.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="clientId">Fitbit Client ID</Label>
          <Input
            id="clientId"
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Enter your Fitbit Client ID"
            disabled={isLoading}
            className="min-h-[44px]"
            aria-required="true"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="clientSecret">Fitbit Client Secret</Label>
          <Input
            id="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="Enter your Fitbit Client Secret"
            disabled={isLoading}
            className="min-h-[44px]"
            aria-required="true"
          />
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={!isFormValid || isLoading}
          className="w-full min-h-[44px]"
        >
          {isLoading ? "Saving..." : "Connect Fitbit"}
        </Button>
      </form>
    </div>
  );
}
