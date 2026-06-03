"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

interface SentryUserContextProps {
  userId: string;
}

export function SentryUserContext({ userId }: SentryUserContextProps) {
  useEffect(() => {
    Sentry.setUser({ id: userId });
    return () => {
      Sentry.setUser(null);
    };
  }, [userId]);

  return null;
}
