"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

interface SentryUserContextProps {
  userId: string;
  email: string;
}

export function SentryUserContext({ userId, email }: SentryUserContextProps) {
  useEffect(() => {
    Sentry.setUser({ id: userId, email });
    return () => {
      Sentry.setUser(null);
    };
  }, [userId, email]);

  return null;
}
