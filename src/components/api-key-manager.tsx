"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface ApiKey {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiKeyResponse {
  keys: ApiKey[];
}

interface CreatedKey {
  id: number;
  name: string;
  rawKey: string;
  keyPrefix: string;
  createdAt: string;
}

export function ApiKeyManager() {
  const { data, mutate } = useSWR<ApiKeyResponse>("/api/api-keys", apiFetcher);
  const [isGenerating, setIsGenerating] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleGenerate = () => {
    setIsGenerating(true);
    setKeyName("");
  };

  const handleCreate = async () => {
    if (!keyName.trim()) return;

    setIsCreating(true);
    setActionError(null);
    try {
      const response = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: keyName }),
      });

      if (response.ok) {
        const result = await response.json();
        setCreatedKey(result.data);
        setIsGenerating(false);
        setKeyName("");
        await mutate();
      } else {
        const errorData = await response.json().catch(() => ({}));
        setActionError(errorData.error?.message || "Failed to create API key");
      }
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (createdKey) {
      try {
        await navigator.clipboard.writeText(createdKey.rawKey);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch {
        console.error("Failed to copy to clipboard");
      }
    }
  };

  const handleRevoke = async (id: number) => {
    setRevokeId(id);
  };

  const confirmRevoke = async () => {
    if (revokeId === null) return;

    setIsRevoking(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/api-keys/${revokeId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await mutate();
        setRevokeId(null);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setActionError(errorData.error?.message || "Failed to revoke API key");
      }
    } catch {
      setActionError("Network error. Please try again.");
    } finally {
      setIsRevoking(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const keys = data?.keys ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Manage API keys for programmatic access to your food log
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}

          {!isGenerating && (
            <Button onClick={handleGenerate}>Generate API Key</Button>
          )}

          {isGenerating && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="key-name">Key Name</Label>
                <Input
                  id="key-name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="My Script"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={!keyName.trim() || isCreating}
                >
                  {isCreating ? "Creating..." : "Create"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsGenerating(false)}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {keys.length === 0 && !isGenerating && (
            <p className="text-sm text-muted-foreground">No API keys</p>
          )}

          {keys.length > 0 && (
            <div className="space-y-2">
              {keys.map((key) => (
                <Card key={key.id}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="space-y-1">
                      <p className="font-medium">{key.name}</p>
                      <p className="text-sm text-muted-foreground">
                        fsk_{key.keyPrefix}...
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Created {formatDate(key.createdAt)}
                        {key.lastUsedAt &&
                          ` • Last used ${formatDate(key.lastUsedAt)}`}
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleRevoke(key.id)}
                    >
                      Revoke
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Created Key Dialog */}
      <Dialog open={createdKey !== null} onOpenChange={() => setCreatedKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy this key now. It will only be shown once.
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription className="font-mono text-sm break-all">
                  {createdKey.rawKey}
                </AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button onClick={handleCopy} className="flex-1">
                  {copySuccess ? "Copied!" : "Copy"}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={revokeId !== null} onOpenChange={() => setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              Are you sure you want to revoke this API key? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRevokeId(null)}
              disabled={isRevoking}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? "Revoking..." : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
