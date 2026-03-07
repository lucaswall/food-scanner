interface SentryExceptionValue {
  type?: string;
  value?: string;
  mechanism?: {
    type?: string;
  };
}

interface SentryEventLike {
  exception?: {
    values?: SentryExceptionValue[];
  };
}

/**
 * Returns true if the event is an Anthropic SDK auto-instrumented overloaded_error.
 * These are noise from the SDK's stream error handler (FOOD-SCANNER-D) — the app-level
 * error (FOOD-SCANNER-E) uses mechanism "auto.log.pino" and is preserved.
 */
export function shouldDropOverloadedSdkError(event: SentryEventLike): boolean {
  const firstException = event.exception?.values?.[0];
  if (!firstException) return false;

  const mechanism = firstException.mechanism?.type;
  const message = firstException.value;

  return (
    mechanism === "auto.ai.anthropic.stream_error" &&
    typeof message === "string" &&
    message.includes("overloaded_error")
  );
}
