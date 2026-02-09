# Fix Plan: Fitbit Credentials-Missing Transitional State

**Issue:** FOO-294
**Date:** 2026-02-09
**Status:** Planning
**Branch:** fix/FOO-294-credentials-transitional-state

## Investigation

### Bug Report

After PR #47 introduced per-user Fitbit credentials, existing users who had tokens from the old env-var flow have a contradictory state: `fitbit_tokens` rows exist (so `fitbitConnected=true`) but `fitbit_credentials` rows don't (so `hasFitbitCredentials=false`). This causes:

1. Settings shows "Fitbit: Connected" (green) AND "No credentials configured" simultaneously
2. `ensureFreshToken()` throws `FITBIT_CREDENTIALS_MISSING` when tokens expire, caught as generic 500
3. `analyze-food` lets users spend a Claude API call even though `log-food` will fail when tokens need refresh
4. `FitbitStatusBanner` doesn't warn about the connected-but-no-credentials state

### Classification
- **Type:** Bug
- **Severity:** High
- **Affected Area:** Auth/Fitbit integration, Settings UI, food logging flow

### Root Cause Analysis

#### Evidence

1. **`src/lib/session.ts:88-108`** — `validateSession({ requireFitbit: true })` only checks `session.fitbitConnected` (line 100), ignoring `session.hasFitbitCredentials`. This means API routes that require Fitbit pass validation even when credentials are missing.

2. **`src/app/api/log-food/route.ts:344-373`** — The catch block handles `FITBIT_TOKEN_INVALID` (line 347) and `FITBIT_RATE_LIMIT` (line 359), but `FITBIT_CREDENTIALS_MISSING` falls through to the generic catch on line 368, returning a vague "Failed to log food to Fitbit" (500).

3. **`src/lib/fitbit.ts:421-425`** — `ensureFreshToken()` checks credentials first: if missing, throws `FITBIT_CREDENTIALS_MISSING`. But this is only reached when tokens need refreshing (within 1 hour of expiry), so the bug is time-delayed — everything works until the first token refresh.

4. **`src/components/settings-content.tsx:131-142`** — "Fitbit: Connected/Not connected" is driven solely by `session.fitbitConnected`. No special handling for the combination of connected=true + hasCredentials=false.

5. **`src/components/fitbit-status-banner.tsx:28`** — Banner returns `null` (hidden) when `fitbitConnected` is true, regardless of `hasFitbitCredentials`.

6. **`src/app/api/analyze-food/route.ts:14`** — Uses `validateSession(session, { requireFitbit: true })` which passes for users with tokens but no credentials, allowing a Claude API call that will be wasted if the subsequent log-food call fails.

### Impact
- Users see contradictory state on Settings page
- Users can waste Claude API calls analyzing food they can't log
- When tokens expire, users get a vague error with no guidance on how to fix it
- No proactive warning about the impending failure

## Fix Plan (TDD Approach)

### Step 1: Extend `validateSession` to check credentials

**Test file:** `src/lib/__tests__/session.test.ts`
**Test:** Add test that `validateSession({ requireFitbit: true })` returns `FITBIT_CREDENTIALS_MISSING` error when `fitbitConnected=true` but `hasFitbitCredentials=false`

```typescript
it("returns FITBIT_CREDENTIALS_MISSING when fitbitConnected but no credentials", () => {
  const session: FullSession = {
    sessionId: "test-id",
    userId: "user-id",
    expiresAt: Date.now() + 86400000,
    fitbitConnected: true,
    hasFitbitCredentials: false,
    destroy: vi.fn(),
  };
  const result = validateSession(session, { requireFitbit: true });
  expect(result).not.toBeNull();
  // Parse response to check error code
  // Expect: { code: "FITBIT_CREDENTIALS_MISSING", message: "..." }
});
```

**Implementation file:** `src/lib/session.ts`
**Change:** In `validateSession()`, after the `requireFitbit` + `!fitbitConnected` check (line 100), add a check for `!session.hasFitbitCredentials`:

```typescript
if (options?.requireFitbit && !session.hasFitbitCredentials) {
  logger.warn(
    { action: "session_invalid", reason: "fitbit_credentials_missing" },
    "session validation failed: fitbit credentials not configured",
  );
  return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not configured. Please set up your credentials in Settings.", 400);
}
```

This goes **after** the `!fitbitConnected` check so we get the more specific error when applicable.

**Important:** This change affects `analyze-food`, `refine-food`, and `log-food` since they all call `validateSession(session, { requireFitbit: true })`. This is the correct behavior — it blocks the user **before** wasting a Claude API call.

### Step 2: Add `FITBIT_CREDENTIALS_MISSING` handler in `log-food` catch block

**Test file:** `src/app/api/log-food/__tests__/route.test.ts`
**Test:** Add test that when `ensureFreshToken` throws `FITBIT_CREDENTIALS_MISSING`, the response has error code `FITBIT_CREDENTIALS_MISSING` with 400 status (not generic 500).

```typescript
it("returns FITBIT_CREDENTIALS_MISSING when credentials are missing during token refresh", async () => {
  mockGetSession.mockResolvedValue(validSession);
  mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));
  // ... build valid request body
  const response = await POST(request);
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
});
```

**Implementation file:** `src/app/api/log-food/route.ts`
**Change:** In the catch block (line 344), add a handler before `FITBIT_TOKEN_INVALID`:

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

**Note:** With Step 1 in place, this catch is a defense-in-depth — the `validateSession` check will catch it first in most cases. But if a race condition occurs (credentials deleted between validation and `ensureFreshToken`), this catch handles it gracefully.

### Step 3: Update `validateSession` mock in affected test files

The mock of `validateSession` in test files needs updating to also check `hasFitbitCredentials`. Affected files:

- `src/app/api/log-food/__tests__/route.test.ts` (line 9-27)
- `src/app/api/analyze-food/__tests__/route.test.ts`
- `src/app/api/refine-food/__tests__/route.test.ts`
- Any other test files that mock `validateSession`

Add to the mock:
```typescript
if (options?.requireFitbit && !session.hasFitbitCredentials) {
  return Response.json(
    { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
    { status: 400 },
  );
}
```

### Step 4: Fix Settings page UI for transitional state

**Test file:** `src/app/settings/__tests__/page.test.tsx`
**Test:** When session has `fitbitConnected=true` and credentials `hasCredentials=false`, the settings page should show a warning like "Your Fitbit connection will stop working when the current token expires" and prominently show the setup button.

**Implementation file:** `src/components/settings-content.tsx`
**Change:** In the Fitbit status display (lines 131-142), when `session.fitbitConnected && !session.hasFitbitCredentials`, show an amber warning instead of a green "Connected":

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

### Step 5: Update FitbitStatusBanner for transitional state

**Test file:** `src/components/__tests__/fitbit-status-banner.test.tsx`
**Test:** When `fitbitConnected=true` and `hasFitbitCredentials=false`, the banner should show a warning directing the user to set up credentials.

**Implementation file:** `src/components/fitbit-status-banner.tsx`
**Change:** Before the `if (fitbitConnected) return null;` check (line 28), add a check for the transitional state:

```tsx
// Case 0: Connected but no credentials → warn about impending failure
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

### Step 6: Verify

- [ ] All new tests pass
- [ ] All existing tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)

## Notes

- The `validateSession` change (Step 1) is the highest-impact fix — it blocks all three API routes (`analyze-food`, `refine-food`, `log-food`) before any expensive work happens.
- Step 2 is defense-in-depth for the `log-food` route specifically.
- Steps 4-5 are UX improvements that make the state visible to the user.
- This is a transitional-state bug that only affects users who had tokens before PR #47 introduced per-user credentials. New users won't hit this because the Google OAuth callback redirects them to setup-fitbit before they can get tokens.
