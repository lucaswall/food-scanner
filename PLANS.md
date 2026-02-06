# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-125-backlog-cleanup
**Issues:** FOO-125 through FOO-153 (28 issues)
**Created:** 2026-02-06
**Last Updated:** 2026-02-06

## Summary

Comprehensive cleanup of all 28 Backlog issues from the code audit. Covers security hardening (cookie parsing, OAuth state, session validation, token encryption, rate limiting, PII logging, error sanitization), bug fixes (type safety, race conditions, retry logic, error handling), performance improvements (DB pool config, response body timeouts), UI deduplication (confidence indicator component), convention fixes (import ordering), and test coverage gaps.

Issues are grouped into logical tasks by file/module affinity to minimize context switches.

## Issues

### FOO-125: Cookie name not regex-escaped in getCookieValue
**Priority:** Medium | **Labels:** Security
**Description:** `getCookieValue()` builds regex from `name` without escaping regex metacharacters.

### FOO-126: ALLOWED_EMAIL uses process.env directly instead of getRequiredEnv
**Priority:** Medium | **Labels:** Security
**Description:** Email check uses `process.env.ALLOWED_EMAIL` directly instead of `getRequiredEnv()`.

### FOO-127: Fitbit OAuth GET endpoint accessible without session validation
**Priority:** Medium | **Labels:** Security
**Description:** `GET /api/auth/fitbit` is publicly accessible due to middleware excluding `/api/auth/*`.

### FOO-128: Middleware only checks cookie existence, not session validity
**Priority:** Medium | **Labels:** Security
**Description:** Middleware checks cookie presence but doesn't verify validity. Expired/invalid cookies pass.

### FOO-129: OAuth state not cryptographically bound to session
**Priority:** Low | **Labels:** Security
**Description:** OAuth state stored in plain cookie rather than encrypted iron-session.

### FOO-130: API error response bodies logged without sanitization
**Priority:** Low | **Labels:** Security
**Description:** Full error bodies from Google/Fitbit APIs logged unfiltered.

### FOO-131: Fitbit tokens stored as plain text in database
**Priority:** Low | **Labels:** Security
**Description:** `accessToken` and `refreshToken` columns store tokens as plain text.

### FOO-132: dangerouslySetInnerHTML used for theme script injection
**Priority:** Low | **Labels:** Security
**Description:** Theme script uses `dangerouslySetInnerHTML`. Currently safe (static string) but fragile.

### FOO-133: No rate limiting on authentication endpoints
**Priority:** Low | **Labels:** Security
**Description:** OAuth initiation and session validation endpoints have no rate limiting.

### FOO-134: No expired session cleanup mechanism
**Priority:** Low | **Labels:** Security
**Description:** Expired session rows never deleted from DB.

### FOO-135: Unauthorized login email address logged as PII
**Priority:** Low | **Labels:** Security
**Description:** Unauthorized login attempt logs the full email address.

### FOO-136: Fitbit fetchWithRetry does not retry on 5xx server errors
**Priority:** Medium | **Labels:** Bug
**Description:** Only retries on 429, not transient 5xx errors.

### FOO-137: Claude API 429 rate limit retry has no backoff delay
**Priority:** Medium | **Labels:** Bug
**Description:** Rate limit retry has no delay between attempts.

### FOO-138: touchSession fire-and-forget masks persistent DB failures
**Priority:** Medium | **Labels:** Bug
**Description:** `touchSession()` errors silently swallowed, never surfaces persistent DB issues.

### FOO-139: Fitbit token refresh has TOCTOU race condition
**Priority:** Medium | **Labels:** Bug
**Description:** Concurrent requests can both attempt to refresh the same token.

### FOO-140: Double cast as unknown as FoodAnalysis in Claude response handling
**Priority:** Medium | **Labels:** Bug
**Description:** `validateFoodAnalysis` uses `as unknown as FoodAnalysis` bypassing type safety.

### FOO-141: validateFoodAnalysis does not check input is an object before cast
**Priority:** Low | **Labels:** Bug
**Description:** Immediately casts `unknown` to `Record<string, unknown>` without type guard.

### FOO-142: Unsafe error.status cast in isRateLimitError
**Priority:** Low | **Labels:** Bug
**Description:** Uses `(error as { status?: number }).status` without type guard.

### FOO-143: FileReader result cast to string without type check in image.ts
**Priority:** Low | **Labels:** Bug
**Description:** `e.target?.result as string` on line 92 without verifying type.

### FOO-144: Empty catch blocks in theme script and shutdown handler
**Priority:** Low | **Labels:** Bug
**Description:** Two empty catch blocks: layout.tsx theme script (line 20) and instrumentation.ts shutdown (line 28).

### FOO-145: Logout fetch has no error handling
**Priority:** Low | **Labels:** Bug
**Description:** `handleLogout` ignores fetch errors, always redirects.

### FOO-146: Global error boundary has no server-side error reporting
**Priority:** Low | **Labels:** Bug
**Description:** Production errors silently swallowed in global error boundary.

### FOO-147: PostgreSQL connection pool missing timeout and size configuration
**Priority:** Medium | **Labels:** Performance
**Description:** `new Pool()` created with no timeout/size configuration.

### FOO-148: response.json() has no timeout on body consumption for external APIs
**Priority:** Medium | **Labels:** Performance
**Description:** `response.json()` calls on external API responses have no timeout.

### FOO-149: Imports placed after interface declarations in components
**Priority:** Low | **Labels:** Convention
**Description:** `confidenceColors`/`confidenceExplanations` imports placed after interfaces.

### FOO-150: Duplicated confidence indicator UI across components
**Priority:** Low | **Labels:** Technical Debt
**Description:** Nearly identical confidence indicator in `analysis-result.tsx` and `nutrition-editor.tsx`.

### FOO-151: Duplicated error body parsing logic across fitbit.ts and auth.ts
**Priority:** Low | **Labels:** Technical Debt
**Description:** Try JSON.parse, fallback to text pattern repeated 3 times.

### FOO-152: Missing test coverage for error paths and several modules
**Priority:** Medium | **Labels:** Technical Debt
**Description:** No tests for `confidence.ts`, `utils.ts`, `theme-provider.tsx`, `photo-preview-dialog.tsx`. Sparse error path assertions.

### FOO-153: Moderate dependency vulnerability in esbuild via drizzle-kit
**Priority:** Low | **Labels:** Security
**Description:** esbuild <=0.24.2 moderate severity via drizzle-kit (dev dependency only).

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `docker compose up -d` for local Postgres
- [ ] `npm install` dependencies up to date

## Implementation Tasks

### Task 1: Fix cookie name regex escaping and add tests

**Issue:** FOO-125
**Files:**
- `src/lib/cookies.ts` (modify)
- `src/lib/__tests__/cookies.test.ts` (create)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Create `src/lib/__tests__/cookies.test.ts`
   - Test: `getCookieValue` returns correct value for simple cookie name
   - Test: `getCookieValue` returns undefined when cookie not present
   - Test: `getCookieValue` correctly handles cookie names with regex metacharacters (e.g., `my.cookie`, `a+b`)
   - Test: `getCookieValue` returns first match when multiple cookies present
   - Run: `npm test -- cookies`
   - Verify: Regex metacharacter test fails (matches unintended cookies)

2. **GREEN** - Escape the cookie name:
   - In `getCookieValue`, escape `name` before building regex: `name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`
   - Run: `npm test -- cookies`
   - Verify: All tests pass

3. **REFACTOR** - None needed, function is already minimal.

**Notes:**
- The function is only 4 lines; the fix is a single `replace()` call.
- Currently called with literal strings only, but this makes it safe for reuse.

---

### Task 2: Use getRequiredEnv for ALLOWED_EMAIL and mask unauthorized email

**Issues:** FOO-126, FOO-135
**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write/update failing tests:
   - Add test: when `ALLOWED_EMAIL` env var is unset, callback returns 500 error (getRequiredEnv throws)
   - Add test: unauthorized email log entry masks the email (e.g., `w***@gmail.com` instead of full address)
   - Run: `npm test -- google/callback`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - Replace `process.env.ALLOWED_EMAIL` (line 46) with `getRequiredEnv("ALLOWED_EMAIL")`
   - Add import for `getRequiredEnv` from `@/lib/env`
   - Mask email in log: replace `{ email: profile.email }` with `{ email: profile.email.replace(/^(.)(.*)(@.*)$/, "$1***$3") }`
   - Run: `npm test -- google/callback`
   - Verify: All tests pass

3. **REFACTOR** - Extract email masking to a helper if needed (probably not for one use).

**Notes:**
- `getRequiredEnv` will throw at runtime if `ALLOWED_EMAIL` is missing, which is safer than silent `undefined` comparison.
- Pattern reference: other env vars in this file already use it indirectly via `buildUrl()`.

---

### Task 3: Add session validation to Fitbit OAuth GET endpoint

**Issue:** FOO-127
**Files:**
- `src/app/api/auth/fitbit/route.ts` (modify)
- `src/app/api/auth/fitbit/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: GET without valid session returns 401
   - Test: POST without valid session returns 401
   - Test: GET with valid session returns 302 redirect to Fitbit
   - Test: POST with valid session returns 302 redirect to Fitbit
   - Run: `npm test -- fitbit/route`
   - Verify: Auth tests fail (currently no session check)

2. **GREEN** - Add session validation:
   - Import `getSession` and `validateSession` from `@/lib/session`
   - In both `GET` and `POST` handlers (or the shared `initiateFitbitAuth`), call `getSession()` + `validateSession()` before proceeding
   - If validation fails, return the error response
   - Run: `npm test -- fitbit/route`
   - Verify: All tests pass

3. **REFACTOR** - The `initiateFitbitAuth` function can accept the session check result to keep DRY.

**Notes:**
- The middleware matcher `/((?!health|auth).*)` excludes all `/api/auth/*` routes. The Fitbit OAuth GET is accessed via redirect from Google callback (which just created a session), so adding session validation here is safe.
- Reference pattern: `src/app/api/analyze-food/route.ts` uses `getSession()` + `validateSession()`.

---

### Task 4: Fix Claude API type safety (validateFoodAnalysis, isRateLimitError, rate limit backoff)

**Issues:** FOO-137, FOO-140, FOO-141, FOO-142
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write/update failing tests:
   - Test: `validateFoodAnalysis` throws when input is `null`
   - Test: `validateFoodAnalysis` throws when input is a string (not object)
   - Test: `validateFoodAnalysis` returns a properly typed `FoodAnalysis` (verify all fields accessible without cast)
   - Test: `isRateLimitError` returns false for non-Error objects
   - Test: `isRateLimitError` returns true for error with `status: 429` (via proper check)
   - Test: rate limited request retries with delay (use `vi.useFakeTimers()`)
   - Run: `npm test -- claude`
   - Verify: Null input test fails (currently no guard); rate limit delay test fails (no delay)

2. **GREEN** - Implement fixes:
   - **FOO-141**: Add object type guard at top of `validateFoodAnalysis`:
     ```typescript
     if (input === null || typeof input !== "object" || Array.isArray(input)) {
       throw new ClaudeApiError("Invalid food analysis: input must be an object");
     }
     const data = input as Record<string, unknown>;
     ```
   - **FOO-140**: Replace `return data as unknown as FoodAnalysis` (line 116) with explicit object construction:
     ```typescript
     return {
       food_name: data.food_name as string,
       amount: data.amount as number,
       unit_id: data.unit_id as number,
       calories: data.calories as number,
       protein_g: data.protein_g as number,
       carbs_g: data.carbs_g as number,
       fat_g: data.fat_g as number,
       fiber_g: data.fiber_g as number,
       sodium_mg: data.sodium_mg as number,
       confidence: data.confidence as FoodAnalysis["confidence"],
       notes: data.notes as string,
     };
     ```
   - **FOO-142**: Fix `isRateLimitError` to use type guard:
     ```typescript
     function isRateLimitError(error: unknown): boolean {
       return (
         error instanceof Error &&
         (error.name === "RateLimitError" ||
           ("status" in error && (error as { status?: number }).status === 429))
       );
     }
     ```
   - **FOO-137**: Add backoff delay in rate limit retry:
     ```typescript
     if (isRateLimitError(error) && attempt < maxRetries) {
       const delay = Math.pow(2, attempt) * 1000;
       logger.warn({ attempt, delay }, "Claude API rate limited, retrying");
       lastError = error as Error;
       await new Promise((resolve) => setTimeout(resolve, delay));
       continue;
     }
     ```
   - Run: `npm test -- claude`
   - Verify: All tests pass

3. **REFACTOR** - Ensure `validateFoodAnalysis` is clean and readable after changes.

**Notes:**
- The double cast was used because all fields are validated individually but TypeScript doesn't narrow via loop. Explicit construction is safer.
- Rate limit backoff uses same pattern as `src/lib/fitbit.ts:53` (`Math.pow(2, attempt) * 1000`).

---

### Task 5: Add 5xx retry and extract error body parsing in Fitbit client

**Issues:** FOO-136, FOO-148, FOO-151
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: `fetchWithRetry` retries on 500 response with backoff
   - Test: `fetchWithRetry` retries on 502 response
   - Test: `fetchWithRetry` does NOT retry on 400 (client error)
   - Test: `fetchWithRetry` throws after exhausting retries on persistent 5xx
   - Run: `npm test -- fitbit`
   - Verify: 5xx retry tests fail (currently passes through 5xx)

2. **GREEN** - Implement:
   - **FOO-136**: Add 5xx handling to `fetchWithRetry` after the 429 block:
     ```typescript
     if (response.status >= 500) {
       if (retryCount >= MAX_RETRIES) {
         return response; // Let caller handle the error
       }
       const delay = Math.pow(2, retryCount) * 1000;
       logger.warn(
         { action: "fitbit_server_error", status: response.status, retryCount, delay },
         "server error, retrying",
       );
       await new Promise((resolve) => setTimeout(resolve, delay));
       return fetchWithRetry(url, options, retryCount + 1);
     }
     ```
   - **FOO-151**: Extract shared error body parsing to a helper:
     ```typescript
     async function parseErrorBody(response: Response): Promise<unknown> {
       const bodyText = await response.text().catch(() => "unable to read body");
       try {
         return JSON.parse(bodyText);
       } catch {
         return bodyText;
       }
     }
     ```
     Replace the 3 duplicated blocks in `createFood` (lines 102-108), `logFood` (lines 162-168), and `getGoogleProfile` in `auth.ts` (lines 75-81).
   - **FOO-148**: Add timeout to `response.json()` calls. Wrap with `Promise.race`:
     ```typescript
     async function jsonWithTimeout<T>(response: Response, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
       const result = await Promise.race([
         response.json(),
         new Promise<never>((_, reject) =>
           setTimeout(() => reject(new Error("Response body read timed out")), timeoutMs)
         ),
       ]);
       return result as T;
     }
     ```
     Replace `response.json()` calls in `createFood` (line 116), `logFood` (line 176), `exchangeFitbitCode` (line 251), and `refreshFitbitToken` (line 309).
   - Run: `npm test -- fitbit`
   - Verify: All tests pass

3. **REFACTOR** - Move `parseErrorBody` to a shared location if auth.ts also needs it, or keep in fitbit.ts and import.

**Notes:**
- The `parseErrorBody` helper also addresses FOO-130 partially — see Task 6 for sanitization.
- `jsonWithTimeout` uses the same `REQUEST_TIMEOUT_MS` (10s) constant.
- Also update `src/lib/auth.ts` to use `parseErrorBody` for the duplicated block (import from fitbit.ts or create shared module).

---

### Task 6: Sanitize API error response bodies in logs and update auth.ts error parsing

**Issues:** FOO-130, FOO-151 (auth.ts portion)
**Files:**
- `src/lib/auth.ts` (modify)
- `src/lib/__tests__/auth.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: error log truncates response body to 500 characters max
   - Test: error log strips HTML tags from response body
   - Run: `npm test -- auth`
   - Verify: Tests fail (currently logs full body)

2. **GREEN** - Implement:
   - Import `parseErrorBody` from shared location (or define locally)
   - Replace duplicated error parsing in `getGoogleProfile` (lines 75-81) with `parseErrorBody(response)`
   - Add sanitization: truncate body to 500 chars and strip HTML before logging:
     ```typescript
     function sanitizeErrorBody(body: unknown): unknown {
       if (typeof body === "string") {
         const stripped = body.replace(/<[^>]*>/g, "").slice(0, 500);
         return stripped;
       }
       return body;
     }
     ```
   - Apply `sanitizeErrorBody` to all `errorBody` log entries in `auth.ts`
   - Run: `npm test -- auth`
   - Verify: All tests pass

3. **REFACTOR** - Apply same `sanitizeErrorBody` to fitbit.ts error logs (from Task 5).

**Notes:**
- Keep sanitization simple — strip HTML tags and truncate. No need for a full HTML parser.
- The shared `parseErrorBody` function can include sanitization built-in.

---

### Task 7: Fix Fitbit token refresh TOCTOU race condition

**Issue:** FOO-139
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: two concurrent `ensureFreshToken` calls with an expiring token only call `refreshFitbitToken` once
   - Test: second concurrent call receives the same refreshed access token
   - Run: `npm test -- fitbit`
   - Verify: Test fails (both calls trigger refresh)

2. **GREEN** - Add in-memory mutex for token refresh:
   - Add a module-level `Promise` cache for in-flight refreshes:
     ```typescript
     let refreshInFlight: Promise<string> | null = null;

     export async function ensureFreshToken(email: string): Promise<string> {
       const tokenRow = await getFitbitTokens(email);
       if (!tokenRow) {
         throw new Error("FITBIT_TOKEN_INVALID");
       }

       if (tokenRow.expiresAt.getTime() < Date.now() + 60 * 60 * 1000) {
         if (refreshInFlight) {
           return refreshInFlight;
         }

         refreshInFlight = (async () => {
           try {
             const tokens = await refreshFitbitToken(tokenRow.refreshToken);
             await upsertFitbitTokens(email, {
               fitbitUserId: tokens.user_id,
               accessToken: tokens.access_token,
               refreshToken: tokens.refresh_token,
               expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
             });
             return tokens.access_token;
           } finally {
             refreshInFlight = null;
           }
         })();

         return refreshInFlight;
       }

       return tokenRow.accessToken;
     }
     ```
   - Run: `npm test -- fitbit`
   - Verify: All tests pass

3. **REFACTOR** - Ensure the `finally` block always clears the in-flight promise.

**Notes:**
- Single-user app makes this simple — only one email, so a single mutex is sufficient.
- The mutex is in-memory only, which is fine for a single-process deployment on Railway.

---

### Task 8: Fix touchSession fire-and-forget masking DB failures

**Issue:** FOO-138
**Files:**
- `src/lib/session.ts` (modify)
- `src/lib/__tests__/session.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: consecutive touchSession failures escalate log level from `warn` to `error`
   - Test: successful touchSession resets failure counter
   - Run: `npm test -- session`
   - Verify: Tests fail (currently always logs at `warn`)

2. **GREEN** - Add failure counter:
   - Add module-level counter:
     ```typescript
     let touchFailCount = 0;
     const TOUCH_FAIL_THRESHOLD = 3;
     ```
   - In the `.catch()` handler, increment counter and log at `error` level when threshold exceeded:
     ```typescript
     touchSession(dbSession.id).then(() => {
       touchFailCount = 0;
     }).catch((err) => {
       touchFailCount++;
       const logLevel = touchFailCount >= TOUCH_FAIL_THRESHOLD ? "error" : "warn";
       logger[logLevel](
         { action: "touch_session_error", consecutiveFailures: touchFailCount, error: err instanceof Error ? err.message : String(err) },
         touchFailCount >= TOUCH_FAIL_THRESHOLD
           ? "persistent session touch failures detected"
           : "failed to extend session expiration",
       );
     });
     ```
   - Run: `npm test -- session`
   - Verify: All tests pass

3. **REFACTOR** - Export `resetTouchFailCount` for testing if needed, or use module re-import.

**Notes:**
- Keep fire-and-forget pattern (don't block requests on session touch).
- The escalation to `error` level ensures persistent failures surface in monitoring.

---

### Task 9: Configure PostgreSQL connection pool timeouts

**Issue:** FOO-147
**Files:**
- `src/db/index.ts` (modify)
- `src/db/__tests__/index.test.ts` (create)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: `getDb()` creates pool with `connectionTimeoutMillis` set
   - Test: `getDb()` creates pool with `max` connections set
   - Test: `getDb()` creates pool with `idleTimeoutMillis` set
   - Run: `npm test -- db/index`
   - Verify: Tests fail (no config currently)

2. **GREEN** - Add pool configuration:
   ```typescript
   pool = new Pool({
     connectionString: getRequiredEnv("DATABASE_URL"),
     max: 5,                     // Single-user app, 5 is plenty
     idleTimeoutMillis: 30000,   // Close idle connections after 30s
     connectionTimeoutMillis: 5000, // Fail fast if can't connect in 5s
   });
   ```
   - Run: `npm test -- db/index`
   - Verify: All tests pass

3. **REFACTOR** - None needed.

**Notes:**
- Railway single-service deployment with one user doesn't need many connections.
- `connectionTimeoutMillis: 5000` ensures fast failure instead of hanging forever.
- Default `max: 10` is fine too but explicit is better.

---

### Task 10: Fix FileReader result type check in image.ts

**Issue:** FOO-143
**Files:**
- `src/lib/image.ts` (modify)
- `src/lib/__tests__/image.test.ts` (create or modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Test: `createResizedCanvas` rejects when FileReader result is not a string
   - Run: `npm test -- image`
   - Verify: Test fails (currently casts without check)

2. **GREEN** - Add type guard:
   - Replace line 92 (`img.src = e.target?.result as string`) with:
     ```typescript
     const result = e.target?.result;
     if (typeof result !== "string") {
       reject(new Error("FileReader did not return a data URL string"));
       return;
     }
     img.src = result;
     ```
   - Run: `npm test -- image`
   - Verify: All tests pass

3. **REFACTOR** - None needed.

**Notes:**
- This is client-side code. Tests may need jsdom environment setup.
- `readAsDataURL` should always return a string, but the guard prevents runtime crashes if something goes wrong.

---

### Task 11: Add error handling to logout and fix empty catch blocks

**Issues:** FOO-144, FOO-145, FOO-146
**Files:**
- `src/app/settings/page.tsx` (modify)
- `src/instrumentation.ts` (modify)
- `src/app/global-error.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test (settings): `handleLogout` shows error toast/message when fetch fails (network error)
   - Test (settings): `handleLogout` still redirects on success
   - Test (global-error): error boundary always logs via `console.error` (not just in development)
   - Run: `npm test -- settings global-error`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - **FOO-145** (settings/page.tsx): Wrap logout fetch in try-catch:
     ```typescript
     async function handleLogout() {
       try {
         await fetch("/api/auth/logout", { method: "POST" });
       } catch {
         // Best-effort logout — redirect anyway to clear client state
       }
       window.location.href = "/";
     }
     ```
     Note: Since we redirect regardless and the session cookie is the important thing, logging a client-side error adds little value. The redirect to `/` effectively clears the client state. Keep it simple.

   - **FOO-144** (instrumentation.ts line 28): Add debug-level logging:
     ```typescript
     } catch (error) {
       logger.debug(
         { action: "shutdown_cleanup_error", error: error instanceof Error ? error.message : String(error) },
         "best-effort cleanup failed during shutdown",
       );
     }
     ```

   - **FOO-144** (layout.tsx line 20): The empty catch in the theme script is intentional — it's inline browser JS that must not break page load. Add a comment:
     ```javascript
     } catch (e) { /* Intentional: theme detection must never block page load */ }
     ```

   - **FOO-146** (global-error.tsx): Always log errors, not just in development:
     ```typescript
     useEffect(() => {
       console.error("Global error:", {
         message: error.message,
         digest: error.digest,
       });
     }, [error]);
     ```
     Remove the `process.env.NODE_ENV === "development"` guard. Remove `stack` from production logs (it may contain sensitive paths).

   - Run: `npm test -- settings global-error instrumentation`
   - Verify: All tests pass

3. **REFACTOR** - None needed.

**Notes:**
- FOO-145: The issue says "no error handling" but the correct fix for a logout is to redirect anyway. A failed logout request is not critical — the user wanted to leave.
- FOO-146: `console.error` in a client component gets captured by browser dev tools and error monitoring services.
- FOO-144 theme script: This is browser inline JS — no access to pino logger. Comment is the right approach.

---

### Task 12: Fix import ordering in confidence indicator components and extract shared component

**Issues:** FOO-149, FOO-150
**Files:**
- `src/components/confidence-badge.tsx` (create)
- `src/components/analysis-result.tsx` (modify)
- `src/components/nutrition-editor.tsx` (modify)
- `src/components/__tests__/confidence-badge.test.tsx` (create)

**TDD Steps:**

1. **RED** - Write failing tests for new component:
   - Test: `ConfidenceBadge` renders CheckCircle icon for high confidence
   - Test: `ConfidenceBadge` renders AlertTriangle icon for medium confidence
   - Test: `ConfidenceBadge` renders AlertTriangle with red color for low confidence
   - Test: `ConfidenceBadge` shows tooltip with confidence explanation
   - Run: `npm test -- confidence-badge`
   - Verify: Tests fail (component doesn't exist yet)

2. **GREEN** - Create shared component and refactor:
   - Create `src/components/confidence-badge.tsx`:
     ```typescript
     "use client";

     import {
       Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
     } from "@/components/ui/tooltip";
     import { CheckCircle, AlertTriangle } from "lucide-react";
     import { confidenceColors, confidenceExplanations } from "@/lib/confidence";

     interface ConfidenceBadgeProps {
       confidence: "high" | "medium" | "low";
     }

     export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
       return (
         <TooltipProvider>
           <Tooltip>
             <TooltipTrigger asChild>
               <button type="button" data-testid="confidence-trigger" className="flex items-center gap-2 cursor-help">
                 {confidence === "high" ? (
                   <CheckCircle data-testid="confidence-icon-check" className="w-4 h-4 text-green-500" aria-hidden="true" />
                 ) : (
                   <AlertTriangle data-testid="confidence-icon-alert" className={`w-4 h-4 ${confidence === "medium" ? "text-yellow-500" : "text-red-500"}`} aria-hidden="true" />
                 )}
                 <div data-testid="confidence-indicator" aria-label={`Confidence: ${confidence}`} className={`w-3 h-3 rounded-full ${confidenceColors[confidence]}`} />
                 <span className="text-sm text-muted-foreground capitalize">{confidence}</span>
               </button>
             </TooltipTrigger>
             <TooltipContent className="max-w-xs">
               <p>{confidenceExplanations[confidence]}</p>
             </TooltipContent>
           </Tooltip>
         </TooltipProvider>
       );
     }
     ```
   - **FOO-149**: In `analysis-result.tsx`, move `import { confidenceColors, confidenceExplanations } from "@/lib/confidence"` from line 22 to the top with other imports. Then replace with `import { ConfidenceBadge } from "@/components/confidence-badge"` and replace the inline confidence JSX (lines 72-107) with `<ConfidenceBadge confidence={analysis.confidence} />`.
   - **FOO-149**: Same in `nutrition-editor.tsx` — move import from line 21 to top, replace inline JSX (lines 51-87) with `<ConfidenceBadge confidence={value.confidence} />`.
   - Run: `npm test -- confidence-badge analysis-result nutrition-editor`
   - Verify: All tests pass

3. **REFACTOR** - Remove `confidenceColors`/`confidenceExplanations` imports from both parent components if no longer directly used.

**Notes:**
- The existing test files for `analysis-result.tsx` and `nutrition-editor.tsx` may need updates to accommodate the new component structure.
- Keep `data-testid` attributes consistent for existing tests.

---

### Task 13: Add session cleanup mechanism for expired sessions

**Issue:** FOO-134
**Files:**
- `src/lib/session-db.ts` (modify)
- `src/lib/__tests__/session-db.test.ts` (modify)
- `src/instrumentation.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: `cleanExpiredSessions` deletes sessions where `expiresAt < now`
   - Test: `cleanExpiredSessions` does not delete active sessions
   - Test: `cleanExpiredSessions` returns count of deleted sessions
   - Run: `npm test -- session-db`
   - Verify: Tests fail (function doesn't exist)

2. **GREEN** - Implement:
   - Add `cleanExpiredSessions` to `src/lib/session-db.ts`:
     ```typescript
     export async function cleanExpiredSessions(): Promise<number> {
       const result = await getDb()
         .delete(sessions)
         .where(lt(sessions.expiresAt, new Date()))
         .returning({ id: sessions.id });
       return result.length;
     }
     ```
   - Add periodic cleanup in `src/instrumentation.ts` after migrations:
     ```typescript
     // Clean expired sessions on startup
     const { cleanExpiredSessions } = await import("@/lib/session-db");
     const cleaned = await cleanExpiredSessions();
     if (cleaned > 0) {
       logger.info({ action: "sessions_cleaned", count: cleaned }, "cleaned expired sessions");
     }
     ```
   - Run: `npm test -- session-db`
   - Verify: All tests pass

3. **REFACTOR** - None needed. Startup cleanup is sufficient for a single-user app (no cron needed).

**Notes:**
- Import `lt` from `drizzle-orm` for the less-than comparison.
- Running on startup is simple and effective — the app restarts on each deploy.

---

### Task 14: Add OAuth state to iron-session instead of plain cookie

**Issue:** FOO-129
**Files:**
- `src/app/api/auth/google/route.ts` (modify)
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)
- `src/types/index.ts` (modify — add oauthState to SessionData)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: Google OAuth stores state in iron-session, not plain cookie
   - Test: Google callback reads state from iron-session
   - Test: Fitbit OAuth stores state in iron-session
   - Test: Fitbit callback reads state from iron-session
   - Run: `npm test -- auth/google auth/fitbit`
   - Verify: Tests fail (currently uses plain cookies)

2. **GREEN** - Implement:
   - Add `oauthState?: string` to `SessionData` type in `src/types/index.ts`
   - In Google OAuth route: store state via `getRawSession()`, set `rawSession.oauthState = state`, `await rawSession.save()` instead of `Set-Cookie`
   - In Google callback: read state from `getRawSession()` instead of `getCookieValue(request, "google-oauth-state")`
   - In Fitbit OAuth route: same pattern — store state in session
   - In Fitbit callback: read state from session
   - Run: `npm test -- auth`
   - Verify: All tests pass

3. **REFACTOR** - Remove `getCookieValue` import from callback routes if no longer needed. Consider removing `src/lib/cookies.ts` entirely if unused (check for other callers first).

**Notes:**
- iron-session encrypts the cookie automatically, so the state value is cryptographically protected.
- For Google OAuth (pre-login), the session cookie will be created just for the state and then updated on successful login.
- For Fitbit OAuth (post-login), the session already exists.
- Delete the manual `Set-Cookie` headers for state cookies.

---

### Task 15: Improve middleware session validation

**Issue:** FOO-128
**Files:**
- `middleware.ts` (modify)
- `__tests__/middleware.test.ts` (modify if exists)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: request with expired/invalid cookie value gets redirected (not just missing cookie)
   - Run: `npm test -- middleware`
   - Verify: Test fails

2. **GREEN** - Improve check:
   - The middleware runs in Node.js runtime (already configured). However, iron-session's `getIronSession` requires the cookies API from `next/headers`, which isn't available in middleware context easily.
   - **Pragmatic approach**: Instead of full session validation in middleware (which would add DB calls on every request), verify the cookie value is non-empty and has a minimum expected structure. The real validation still happens in route handlers.
   - Add a basic check that the cookie value is not empty/whitespace:
     ```typescript
     if (!sessionCookie || !sessionCookie.value?.trim()) {
     ```
   - This prevents trivially invalid cookies from reaching route handlers.
   - Run: `npm test -- middleware`
   - Verify: All tests pass

3. **REFACTOR** - None.

**Notes:**
- Full session validation in middleware would require DB access on every request, which is expensive and defeats the purpose of middleware being lightweight.
- The current architecture (middleware checks presence, route handlers validate fully) is sound. Adding a non-empty check is the pragmatic fix.
- iron-session will reject any tampered/invalid cookies in route handlers anyway.

---

### Task 16: Add debug logging to shutdown handler and annotate theme script catch

**Issue:** FOO-144 (addressed partly in Task 11 — this ensures it's fully covered)

This task is merged into Task 11. No separate action needed.

---

### Task 17: Add rate limiting to authentication endpoints

**Issue:** FOO-133
**Files:**
- `src/lib/rate-limit.ts` (create)
- `src/lib/__tests__/rate-limit.test.ts` (create)
- `src/app/api/auth/google/route.ts` (modify)
- `src/app/api/auth/google/callback/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: `checkRateLimit` returns `{ allowed: true }` when under limit
   - Test: `checkRateLimit` returns `{ allowed: false }` when limit exceeded
   - Test: rate limit resets after window expires
   - Test: rate limit tracks by IP
   - Run: `npm test -- rate-limit`
   - Verify: Tests fail (module doesn't exist)

2. **GREEN** - Implement simple in-memory rate limiter:
   ```typescript
   // src/lib/rate-limit.ts
   interface RateLimitEntry {
     count: number;
     resetAt: number;
   }

   const store = new Map<string, RateLimitEntry>();

   export function checkRateLimit(
     key: string,
     maxRequests: number,
     windowMs: number,
   ): { allowed: boolean; remaining: number } {
     const now = Date.now();
     const entry = store.get(key);

     if (!entry || entry.resetAt <= now) {
       store.set(key, { count: 1, resetAt: now + windowMs });
       return { allowed: true, remaining: maxRequests - 1 };
     }

     entry.count++;
     if (entry.count > maxRequests) {
       return { allowed: false, remaining: 0 };
     }

     return { allowed: true, remaining: maxRequests - entry.count };
   }
   ```
   - Apply to Google OAuth route (POST handler): 10 requests per minute per IP
   - Apply to Google callback: 10 requests per minute per IP
   - Return 429 with `errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests", 429)` when blocked
   - Run: `npm test -- rate-limit`
   - Verify: All tests pass

3. **REFACTOR** - Add cleanup for stale entries on a timer or on every check.

**Notes:**
- In-memory is fine for single-process Railway deployment.
- Only protect auth endpoints (Google OAuth initiation and callback).
- Don't rate-limit Fitbit OAuth (already behind session auth from Task 3).
- 10 requests/minute is generous for a single-user app.

---

### Task 18: Encrypt Fitbit tokens at rest

**Issue:** FOO-131
**Files:**
- `src/lib/token-encryption.ts` (create)
- `src/lib/__tests__/token-encryption.test.ts` (create)
- `src/lib/fitbit-tokens.ts` (modify)
- `src/lib/__tests__/fitbit-tokens.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test: `encryptToken` returns a different string than input
   - Test: `decryptToken(encryptToken(input))` returns original input
   - Test: `decryptToken` throws on tampered ciphertext
   - Test: `getFitbitTokens` decrypts tokens when reading from DB
   - Test: `upsertFitbitTokens` encrypts tokens when writing to DB
   - Run: `npm test -- token-encryption fitbit-tokens`
   - Verify: Tests fail

2. **GREEN** - Implement AES-256-GCM encryption:
   ```typescript
   // src/lib/token-encryption.ts
   import crypto from "node:crypto";
   import { getRequiredEnv } from "@/lib/env";

   const ALGORITHM = "aes-256-gcm";

   function getKey(): Buffer {
     const secret = getRequiredEnv("SESSION_SECRET");
     return crypto.createHash("sha256").update(secret).digest();
   }

   export function encryptToken(plaintext: string): string {
     const iv = crypto.randomBytes(12);
     const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
     const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
     const tag = cipher.getAuthTag();
     return Buffer.concat([iv, tag, encrypted]).toString("base64");
   }

   export function decryptToken(ciphertext: string): string {
     const buf = Buffer.from(ciphertext, "base64");
     const iv = buf.subarray(0, 12);
     const tag = buf.subarray(12, 28);
     const encrypted = buf.subarray(28);
     const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
     decipher.setAuthTag(tag);
     return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
   }
   ```
   - Modify `upsertFitbitTokens` to encrypt before writing
   - Modify `getFitbitTokens` to decrypt after reading
   - Add migration to handle existing plain-text tokens (or just re-auth since single user)
   - Run: `npm test -- token-encryption fitbit-tokens`
   - Verify: All tests pass

3. **REFACTOR** - Derive key once at module load instead of on every call.

**Notes:**
- Reuses `SESSION_SECRET` via SHA-256 hash as the encryption key.
- AES-256-GCM provides both encryption and authentication.
- Since this is a single-user app, the simplest migration is to just re-authenticate with Fitbit after deployment. Alternatively, add a migration script that encrypts existing tokens.
- Add `TOKEN_ENCRYPTION_KEY` as optional separate env var if desired, but reusing SESSION_SECRET is simpler.

---

### Task 19: Annotate dangerouslySetInnerHTML with safety comment

**Issue:** FOO-132
**Files:**
- `src/app/layout.tsx` (modify)

**Steps:**

1. Add a safety comment above the `dangerouslySetInnerHTML` usage:
   ```typescript
   {/* SECURITY: themeScript is a static string constant defined in this file.
       No user input flows into it. dangerouslySetInnerHTML is safe here. */}
   <script dangerouslySetInnerHTML={{ __html: themeScript }} />
   ```
   This is documentation-only. No test needed.

**Notes:**
- The issue correctly notes this is safe but fragile. A comment documents the safety invariant.
- No alternative exists in Next.js for inline scripts that must run before hydration.

---

### Task 20: Add test coverage for untested modules

**Issue:** FOO-152
**Files:**
- `src/lib/__tests__/confidence.test.ts` (create)
- `src/lib/__tests__/utils.test.ts` (create)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify — add malformed body test)

**TDD Steps:**

1. **Write tests for `confidence.ts`:**
   - Test: `confidenceColors` has entries for high, medium, low
   - Test: `confidenceExplanations` has entries for high, medium, low
   - Test: all color values are valid Tailwind classes
   - Run: `npm test -- confidence`

2. **Write tests for `utils.ts`:**
   - Test: `cn()` merges class names correctly
   - Test: `cn()` handles conflicting Tailwind classes (twMerge behavior)
   - Test: `cn()` handles falsy values
   - Run: `npm test -- utils`

3. **Add malformed body test for analyze-food:**
   - Test: POST with invalid multipart body returns 400
   - Run: `npm test -- analyze-food`

**Notes:**
- `theme-provider.tsx` and `photo-preview-dialog.tsx` are client components that need jsdom + React testing setup. Skip these for now unless existing test infrastructure supports it.
- Focus on the server-side modules that are straightforward to test.

---

### Task 21: Investigate and resolve esbuild vulnerability

**Issue:** FOO-153
**Files:**
- `package.json` (potentially modify)

**Steps:**

1. Run `npm audit` to confirm the vulnerability
2. Check if `drizzle-kit` has released a newer version that upgrades esbuild
3. If yes: `npm update drizzle-kit` and verify
4. If no: Add `overrides` in `package.json` to force esbuild upgrade:
   ```json
   "overrides": {
     "esbuild": ">=0.25.0"
   }
   ```
5. Run `npm audit` to confirm resolution
6. Run `npm test` to verify no breakage
7. Run `npm run build` to verify build still works

**Notes:**
- This is a dev dependency only (drizzle-kit). Not a production risk.
- The `overrides` approach may break drizzle-kit if it relies on specific esbuild APIs.
- If override breaks things, document as "accepted risk" and close the issue.

---

### Task 22: Integration & Verification

**Issues:** All (FOO-125 through FOO-153)
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Manual verification:
   - [ ] Local dev server starts without errors
   - [ ] OAuth flow works (Google → Fitbit → /app)
   - [ ] Food analysis works (photo → Claude → results)
   - [ ] Food logging works (confirm → Fitbit API)
   - [ ] Settings page works (theme toggle, logout)
   - [ ] Confidence badge renders correctly in both analysis result and editor
6. Verify zero warnings in build output

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add implementation notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Regex metacharacters in cookie name | Escaped, correct match | Unit test (Task 1) |
| Missing ALLOWED_EMAIL env var | Server throws on startup or callback | Unit test (Task 2) |
| Unauthenticated Fitbit OAuth | 401 response | Unit test (Task 3) |
| Claude API null input | Throws ClaudeApiError | Unit test (Task 4) |
| Claude API rate limit | Retry with exponential backoff | Unit test (Task 4) |
| Fitbit 5xx errors | Retry with backoff | Unit test (Task 5) |
| Concurrent token refresh | Single refresh, both callers get result | Unit test (Task 7) |
| Persistent touchSession failures | Escalate log level | Unit test (Task 8) |
| DB connection timeout | Fast failure (5s) | Unit test (Task 9) |
| FileReader non-string result | Reject with error | Unit test (Task 10) |
| Logout fetch failure | Redirect anyway | Unit test (Task 11) |
| Rate limit exceeded on auth | 429 response | Unit test (Task 17) |
| Tampered encrypted token | Decrypt throws | Unit test (Task 18) |

## Risks & Open Questions

- [ ] **Task 14 (OAuth state in iron-session)**: For Google OAuth (pre-login), the session cookie will be created before the user is authenticated. This means an unauthenticated user gets an iron-session cookie. Verify this doesn't interfere with the post-login session flow.
- [ ] **Task 18 (Token encryption)**: Existing plain-text tokens in the DB will break after deploy. Need a migration strategy — either re-auth or a one-time encryption migration script.
- [ ] **Task 7 (Token refresh mutex)**: If the refresh fails, the mutex clears and subsequent requests will retry. Verify this behavior is correct.
- [ ] **Task 21 (esbuild override)**: May break `drizzle-kit generate` command. Test migration generation after applying override.
- [ ] **Task 15 (Middleware validation)**: Full session validation in middleware adds DB calls on every request. Kept minimal (non-empty check) to avoid performance regression.

## Scope Boundaries

**In Scope:**
- All 28 Backlog issues (FOO-125 through FOO-153)
- New shared components (confidence-badge, rate-limit, token-encryption)
- Test coverage for new and modified code
- Error body sanitization in logs

**Out of Scope:**
- Service worker / offline support
- Database indexes (separate optimization)
- Full-page error reporting integration (e.g., Sentry)
- Automated session cleanup via cron (startup cleanup is sufficient)
