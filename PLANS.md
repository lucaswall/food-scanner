# Fix Plan: Comprehensive Fitbit Railguards

**Issue:** FOO-294
**Date:** 2026-02-09
**Status:** COMPLETE
**Branch:** fix/FOO-294-credentials-transitional-state

## Investigation

### Bug Report

After PR #47 introduced per-user Fitbit credentials, there are no clear railguards preventing users from entering flows that will fail. The problem manifests in 3 distinct Fitbit states:

| State | `fitbitConnected` | `hasFitbitCredentials` | Meaning |
|-------|---|---|---|
| **Fully set up** | true | true | Everything works |
| **Transitional** | true | false | Old tokens from env-var flow; will break on token refresh |
| **No tokens** | false | true | Has credentials but hasn't completed OAuth |
| **Not set up** | false | false | Brand new user, no Fitbit at all |

Currently, only the "fully set up" state works correctly. The other 3 states let users enter analyze/quick-select, go through the entire flow, and only fail at the very end.

### Classification
- **Type:** Bug
- **Severity:** High
- **Affected Area:** Auth/Fitbit integration, all food logging flows, Settings UI

### Root Cause Analysis

#### Layer 1: No page-level blocking

**`src/app/app/analyze/page.tsx`** and **`src/app/app/quick-select/page.tsx`** only check `session` existence (lines 13-15). They don't check Fitbit state at all. Users see the full UI regardless.

**`src/app/app/page.tsx`** shows `<FitbitStatusBanner />` (line 23) which is informational only — the "Take Photo" and "Quick Select" links (lines 26-39) are always rendered and clickable.

#### Layer 2: API routes fail too late

**`src/app/api/analyze-food/route.ts:14`** — `validateSession(session, { requireFitbit: true })` checks `fitbitConnected` but NOT `hasFitbitCredentials`. In the transitional state (tokens exist, no credentials), this passes. The user spends a Claude API call. Then `log-food` fails later.

**`src/lib/session.ts:100`** — `validateSession` only checks `session.fitbitConnected`:
```typescript
if (options?.requireFitbit && !session.fitbitConnected) { ... }
```
Missing: no check for `session.hasFitbitCredentials`.

#### Layer 3: log-food catch block doesn't handle FITBIT_CREDENTIALS_MISSING

**`src/app/api/log-food/route.ts:344-373`** — Handles `FITBIT_TOKEN_INVALID` (line 347) and `FITBIT_RATE_LIMIT` (line 359). `FITBIT_CREDENTIALS_MISSING` (thrown by `ensureFreshToken` at `src/lib/fitbit.ts:424`) falls to the generic catch → vague 500 "Failed to log food to Fitbit".

#### Layer 4: Client components don't handle Fitbit error codes

**`src/components/food-analyzer.tsx:246`** — Only handles `FITBIT_TOKEN_INVALID` (redirect to OAuth). `FITBIT_NOT_CONNECTED` and `FITBIT_CREDENTIALS_MISSING` show as generic error text with no actionable guidance.

**`src/components/quick-select.tsx:200`** — Same: only handles `FITBIT_TOKEN_INVALID`.

#### Layer 5: Settings UI shows contradictory state

**`src/components/settings-content.tsx:131-142`** — Shows "Fitbit: Connected" (green) even in transitional state.

**`src/components/fitbit-status-banner.tsx:28`** — Returns null when `fitbitConnected=true`, even without credentials.

### Impact
- Users waste time going through analyze/quick-select flows that will fail
- Claude API calls are wasted when analysis succeeds but logging can't work
- Error messages are generic and non-actionable
- No proactive warning about impending failure

## Fix Plan (TDD Approach)

### Step 1: Create `FitbitSetupGuard` component

A shared client component that wraps analyze and quick-select pages. It fetches session state and blocks the entire page content when Fitbit isn't properly set up, showing an appropriate message + action button.

**Test file:** `src/components/__tests__/fitbit-setup-guard.test.tsx`
**Tests:**
- When `fitbitConnected=true` AND `hasFitbitCredentials=true`: renders children normally
- When `hasFitbitCredentials=false`: shows "Set up Fitbit credentials" message + link to `/app/setup-fitbit`, does NOT render children
- When `fitbitConnected=false` AND `hasFitbitCredentials=true`: shows "Fitbit disconnected" message + reconnect button (form POST to `/api/auth/fitbit`), does NOT render children
- When both false: shows "Set up Fitbit" message + link to `/app/setup-fitbit`, does NOT render children
- While loading: shows skeleton placeholder

**Implementation file:** `src/components/fitbit-setup-guard.tsx` (NEW)
```tsx
"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface SessionResponse {
  fitbitConnected: boolean;
  hasFitbitCredentials: boolean;
}

interface FitbitSetupGuardProps {
  children: ReactNode;
}

export function FitbitSetupGuard({ children }: FitbitSetupGuardProps) {
  const { data, isLoading } = useSWR<SessionResponse>(
    "/api/auth/session",
    apiFetcher,
  );

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />;
  }

  if (!data) return null;

  // Fully set up — render normally
  if (data.fitbitConnected && data.hasFitbitCredentials) {
    return <>{children}</>;
  }

  // No credentials → set up
  if (!data.hasFitbitCredentials) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <p className="text-muted-foreground">
          Set up your Fitbit credentials to start logging food
        </p>
        <Button asChild className="min-h-[44px]">
          <Link href="/app/setup-fitbit">Set up Fitbit</Link>
        </Button>
      </div>
    );
  }

  // Has credentials but no tokens → reconnect
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
      <p className="text-muted-foreground">
        Connect your Fitbit account to start logging food
      </p>
      <form action="/api/auth/fitbit" method="POST">
        <Button type="submit" className="min-h-[44px]">
          Connect Fitbit
        </Button>
      </form>
    </div>
  );
}
```

### Step 2: Add `FitbitSetupGuard` to analyze and quick-select pages

**Implementation files:**
- `src/app/app/analyze/page.tsx` — Wrap `<FoodAnalyzer>` with `<FitbitSetupGuard>`
- `src/app/app/quick-select/page.tsx` — Wrap `<QuickSelect>` with `<FitbitSetupGuard>`

The guard fetches session client-side (SWR), so the page still renders as a server component with the heading. Only the interactive content is blocked.

```tsx
// analyze/page.tsx
<FitbitSetupGuard>
  <FoodAnalyzer autoCapture={autoCapture} />
</FitbitSetupGuard>
```

```tsx
// quick-select/page.tsx
<FitbitSetupGuard>
  <QuickSelect />
</FitbitSetupGuard>
```

**Test files:**
- `src/app/app/analyze/__tests__/page.test.tsx` — Verify guard is rendered
- `src/app/app/quick-select/__tests__/page.test.tsx` — Verify guard is rendered

### Step 3: Extend `validateSession` to check credentials

**Test file:** `src/lib/__tests__/session.test.ts`
**Tests:**
- `validateSession({ requireFitbit: true })` with `fitbitConnected=true, hasFitbitCredentials=false` → returns `FITBIT_CREDENTIALS_MISSING` error (400)
- `validateSession({ requireFitbit: true })` with `fitbitConnected=true, hasFitbitCredentials=true` → returns null (pass)
- Existing tests for `fitbitConnected=false` remain unchanged → `FITBIT_NOT_CONNECTED`

**Implementation file:** `src/lib/session.ts`
**Change:** After the `!fitbitConnected` check (line 100-106), add:

```typescript
if (options?.requireFitbit && !session.hasFitbitCredentials) {
  logger.warn(
    { action: "session_invalid", reason: "fitbit_credentials_missing" },
    "session validation failed: fitbit credentials not configured",
  );
  return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not configured. Please set up your credentials in Settings.", 400);
}
```

Order matters: check `!fitbitConnected` first (no tokens at all), then `!hasFitbitCredentials` (has tokens but can't refresh). The first is more severe.

### Step 4: Add `FITBIT_CREDENTIALS_MISSING` handler in `log-food` catch block

Defense-in-depth: even with the guard and validateSession, handle this error specifically.

**Test file:** `src/app/api/log-food/__tests__/route.test.ts`
**Test:** When `ensureFreshToken` throws `FITBIT_CREDENTIALS_MISSING`, response has code `FITBIT_CREDENTIALS_MISSING` and status 400.

**Implementation file:** `src/app/api/log-food/route.ts`
**Change:** In catch block (line 344), before the `FITBIT_TOKEN_INVALID` handler:

```typescript
if (errorMessage === "FITBIT_CREDENTIALS_MISSING") {
  logger.warn(
    { action: "log_food_credentials_missing" },
    "Fitbit credentials not configured"
  );
  return errorResponse(
    "FITBIT_CREDENTIALS_MISSING",
    "Fitbit credentials not configured. Please set up your credentials in Settings.",
    400
  );
}
```

### Step 5: Handle Fitbit error codes in client components

Both `FoodAnalyzer` and `QuickSelect` need to handle `FITBIT_CREDENTIALS_MISSING` and `FITBIT_NOT_CONNECTED` with actionable UI, not just generic error text.

**Implementation file:** `src/components/food-analyzer.tsx`
**Change in `handleLogToFitbit` (line 242-258) and `handleUseExisting` (line 296-314):**

After the existing `FITBIT_TOKEN_INVALID` check, add:
```typescript
if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
  setLogError("Fitbit is not set up. Please configure your credentials in Settings.");
  vibrateError();
  return;
}
```

**Implementation file:** `src/components/quick-select.tsx`
**Change in `handleLogToFitbit` (line 198-215):**

Same pattern — after `FITBIT_TOKEN_INVALID` check:
```typescript
if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
  setLogError("Fitbit is not set up. Please configure your credentials in Settings.");
  vibrateError();
  return;
}
```

Also update the error display to show a "Go to Settings" link when the error mentions "set up" or "credentials" (similar to the existing `logError.includes("reconnect")` pattern in food-analyzer.tsx line 569-575).

**Test files:**
- `src/components/__tests__/food-analyzer.test.tsx` (if exists) or inline in component tests
- `src/components/__tests__/quick-select.test.tsx` (if exists) or inline in component tests

### Step 6: Update `validateSession` mocks in affected test files

The mock of `validateSession` in test files needs to reflect the new `hasFitbitCredentials` check.

**Affected files** (all files that mock `validateSession` with `requireFitbit`):
- `src/app/api/log-food/__tests__/route.test.ts`
- `src/app/api/analyze-food/__tests__/route.test.ts`
- `src/app/api/refine-food/__tests__/route.test.ts`
- Any other test files that mock `validateSession`

Add to the mock after the `!fitbitConnected` check:
```typescript
if (options?.requireFitbit && !session.hasFitbitCredentials) {
  return Response.json(
    { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
    { status: 400 },
  );
}
```

Test sessions used in these tests need `hasFitbitCredentials: true` added to pass.

### Step 7: Fix Settings page and FitbitStatusBanner

**Test file:** `src/app/settings/__tests__/page.test.tsx`
**Test:** When `fitbitConnected=true` and `hasFitbitCredentials=false`, show amber warning.

**Implementation file:** `src/components/settings-content.tsx`
**Change (lines 131-142):** Show amber "Connected (credentials missing)" instead of green "Connected":

```tsx
{session.fitbitConnected && !session.hasFitbitCredentials ? (
  <p>
    Fitbit:{" "}
    <span className="text-amber-600 dark:text-amber-400">
      Connected (credentials missing)
    </span>
  </p>
) : (
  <p>
    Fitbit:{" "}
    <span className={session.fitbitConnected ? "text-green-600 dark:text-green-400" : "text-destructive"}>
      {session.fitbitConnected ? "Connected" : "Not connected"}
    </span>
  </p>
)}
```

**Test file:** `src/components/__tests__/fitbit-status-banner.test.tsx`
**Test:** When `fitbitConnected=true` and `hasFitbitCredentials=false`, show warning banner.

**Implementation file:** `src/components/fitbit-status-banner.tsx`
**Change:** Before `if (fitbitConnected) return null;` (line 28), add transitional state check:

```tsx
if (fitbitConnected && !hasFitbitCredentials) {
  return (
    <Alert variant="default" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm text-amber-900 dark:text-amber-100">
          Set up Fitbit credentials to keep logging food
        </span>
        <Button variant="outline" size="sm" asChild className="shrink-0">
          <Link href="/app/setup-fitbit">Set up now</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

### Step 8: Verify

- [ ] All new tests pass
- [ ] All existing tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Defense-in-Depth Summary

After this fix, here's how each layer blocks incomplete Fitbit states:

| Layer | What it does | Catches |
|-------|-------------|---------|
| **FitbitSetupGuard** (page) | Blocks entire page content with message + action button | All 3 bad states before any user interaction |
| **FitbitStatusBanner** (dashboard) | Amber warning banner on `/app` | Transitional state (connected but no credentials) |
| **validateSession** (API) | Returns specific error codes early | `FITBIT_NOT_CONNECTED` + `FITBIT_CREDENTIALS_MISSING` before any API work |
| **log-food catch** (API) | Handles `FITBIT_CREDENTIALS_MISSING` specifically | Race condition: credentials deleted between validation and token refresh |
| **Client error handlers** | Actionable error messages with Settings link | API errors that slip through |

## Notes

- The `FitbitSetupGuard` is the highest-impact change — it prevents users from even starting a flow that will fail.
- Steps 3-4 are server-side defense-in-depth.
- Step 5 ensures that even if the guard is somehow bypassed (e.g., direct API call), users get clear guidance.
- This is mostly a transitional-state problem affecting users who existed before PR #47. New users hit the Google OAuth → setup-fitbit redirect and won't see these issues.
