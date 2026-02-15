"use client";

import { SWRConfig } from "swr";
import { ApiError } from "@/lib/swr";

interface SWRProviderProps {
  children: React.ReactNode;
}

export function SWRProvider({ children }: SWRProviderProps) {
  const handleError = (error: Error) => {
    // Redirect to landing page on session expiry
    if (error instanceof ApiError && error.code === "AUTH_MISSING_SESSION") {
      window.location.href = "/";
    }
  };

  return <SWRConfig value={{ onError: handleError }}>{children}</SWRConfig>;
}
