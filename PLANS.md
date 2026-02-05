# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-90-backlog-audit-fixes
**Issues:** FOO-90, FOO-91, FOO-92, FOO-93, FOO-94, FOO-95, FOO-96, FOO-97, FOO-98, FOO-99, FOO-100, FOO-101, FOO-102, FOO-103, FOO-104, FOO-105, FOO-106, FOO-107, FOO-108, FOO-109, FOO-110, FOO-111
**Created:** 2026-02-05
**Last Updated:** 2026-02-05

## Summary

Fix all 22 Backlog issues from the code audit. Issues span security hardening (env var validation, security headers, runtime validation), bug fixes (session checks, NaN guards, date validation), reliability improvements (fetch timeouts, graceful shutdown, rate limiting), and technical debt cleanup (duplicated code, test fixture hygiene, dark mode consistency).

Tasks are grouped into logical phases. Earlier phases create shared utilities that later phases depend on.

## Issues

### FOO-93: Critical env vars use non-null assertions without runtime validation
**Priority:** High | **Labels:** Security, Bug
**Description:** `process.env.*!` used in session.ts, auth.ts, fitbit.ts. If undefined at runtime, produces silent failures (weak encryption, broken OAuth URLs). Should fail fast at startup like `url.ts` does with `getAppUrl()`.
**Acceptance Criteria:**
- [ ] All critical env vars validated at startup with clear error messages
- [ ] App refuses to start if any required env var is missing
- [ ] No more `!` assertions on `process.env` for critical vars

### FOO-92: OAuth fetch() calls have no timeout
**Priority:** High | **Labels:** Performance, Bug
**Description:** Four OAuth fetch() calls in auth.ts and fitbit.ts (token exchange + profile + token refresh) have no AbortController/timeout. Can hang indefinitely.
**Acceptance Criteria:**
- [ ] All OAuth fetch calls use AbortController with timeout
- [ ] Timeout is consistent (10s, matching existing fetchWithRetry pattern)

### FOO-91: External API responses not validated at runtime
**Priority:** High | **Labels:** Security, Bug
**Description:** All `response.json()` calls return typed values without runtime validation. Critical fields like `access_token`, `email`, `expires_in` should be validated.
**Acceptance Criteria:**
- [ ] All external API response.json() calls have runtime field validation
- [ ] Invalid responses throw descriptive errors

### FOO-90: Claude API tool_use output lacks runtime validation
**Priority:** High | **Labels:** Security, Bug
**Description:** `toolUseBlock.input as FoodAnalysis` casts AI output without validation. If Claude returns unexpected field types, data propagates silently to Fitbit API.
**Acceptance Criteria:**
- [ ] Claude tool_use output is validated at runtime before use
- [ ] Invalid output throws a descriptive error
- [ ] Reuses validation patterns from FOO-91

### FOO-100: Duplicated session validation logic across protected API routes
**Priority:** Medium | **Labels:** Technical Debt
**Description:** Session validation (check sessionId, expiresAt, fitbit tokens) duplicated in analyze-food and log-food routes. Should be shared.
**Acceptance Criteria:**
- [ ] Session validation extracted to shared utility
- [ ] Both protected routes use the shared utility
- [ ] Behavior unchanged

### FOO-99: Fitbit OAuth callback does not verify authenticated session
**Priority:** Medium | **Labels:** Security
**Description:** Fitbit callback stores OAuth tokens without verifying session.sessionId exists. Anyone with valid OAuth state could store tokens in an unauthenticated session.
**Acceptance Criteria:**
- [ ] Fitbit callback verifies session.sessionId exists before storing tokens
- [ ] Returns error if no authenticated session

### FOO-98: No security headers configured in Next.js
**Priority:** Medium | **Labels:** Security
**Description:** Missing CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy in next.config.ts.
**Acceptance Criteria:**
- [ ] Security headers configured via next.config.ts headers()
- [ ] All standard security headers present

### FOO-95: Session route does not guard against missing expiresAt
**Priority:** Medium | **Labels:** Bug
**Description:** `session.expiresAt < Date.now()` without null check. NaN comparison passes as valid.
**Acceptance Criteria:**
- [ ] Session route uses `!session.expiresAt ||` guard (matching analyze-food/log-food pattern)

### FOO-96: parseInt in nutrition-editor can produce NaN
**Priority:** Medium | **Labels:** Bug
**Description:** `parseInt(newUnitId, 10)` can produce NaN if select value is non-numeric.
**Acceptance Criteria:**
- [ ] NaN check added after parseInt
- [ ] Invalid values silently ignored (don't update state)

### FOO-94: ensureFreshToken mutates session but does not save it
**Priority:** Medium | **Labels:** Bug
**Description:** ensureFreshToken() updates session.fitbit but relies on caller to save. Fragile contract.
**Acceptance Criteria:**
- [ ] ensureFreshToken accepts full session object (with save method) and saves internally
- [ ] Callers updated to not save redundantly

### FOO-103: Empty catch blocks in OAuth callback routes lose error context
**Priority:** Medium | **Labels:** Bug
**Description:** Catch blocks in Google/Fitbit callbacks don't log the error before returning error response.
**Acceptance Criteria:**
- [ ] Catch blocks log the error with appropriate context
- [ ] Error logging follows existing pino patterns

### FOO-105: Date and time validation accepts semantically invalid values
**Priority:** Low | **Labels:** Bug
**Description:** `9999-99-99` passes date regex, `99:99:99` passes time regex. Should validate actual date/time validity.
**Acceptance Criteria:**
- [ ] Date validation checks month 01-12, day 01-31
- [ ] Time validation checks hours 00-23, minutes 00-59, seconds 00-59
- [ ] Invalid semantic values rejected with clear error

### FOO-107: No rate limit handling for Claude API 429 responses
**Priority:** Low | **Labels:** Performance
**Description:** Claude API client retries only on timeouts, not 429s. Fitbit client handles 429 correctly.
**Acceptance Criteria:**
- [ ] Claude API client handles 429 with retry + backoff
- [ ] Pattern consistent with existing Fitbit rate limit handling

### FOO-104: console.error in global-error.tsx leaks internals and bypasses logger
**Priority:** Low | **Labels:** Bug
**Description:** Uses console.error in production. Error details exposed in browser console.
**Acceptance Criteria:**
- [ ] Production: no console.error with error details
- [ ] Development: console.error OK for debugging

### FOO-97: dangerouslySetInnerHTML for theme script reads unvalidated localStorage
**Priority:** Low | **Labels:** Security
**Description:** Theme script applies localStorage value directly as CSS class. Could inject arbitrary class names.
**Acceptance Criteria:**
- [ ] Theme script validates stored value against allowlist ("dark", "light", "system")
- [ ] Invalid values treated as "system"

### FOO-106: No graceful shutdown handling for in-flight requests
**Priority:** Low | **Labels:** Performance
**Description:** No SIGTERM/SIGINT handlers. In-progress requests abruptly terminated on Railway redeployment.
**Acceptance Criteria:**
- [ ] SIGTERM handler added in instrumentation.ts
- [ ] Logs shutdown event
- [ ] Allows brief drain period for in-flight requests

### FOO-101: Duplicated getCookieValue function in OAuth callbacks
**Priority:** Low | **Labels:** Technical Debt
**Description:** Identical getCookieValue() in both OAuth callback routes.
**Acceptance Criteria:**
- [ ] Extracted to shared utility in src/lib/
- [ ] Both callbacks import from shared location

### FOO-102: Duplicated confidenceColors and confidenceExplanations objects
**Priority:** Low | **Labels:** Technical Debt
**Description:** Identical objects in analysis-result.tsx and nutrition-editor.tsx.
**Acceptance Criteria:**
- [ ] Extracted to shared location
- [ ] Both components import from shared location

### FOO-109: Duplicated HEIC_EXTENSIONS constant between photo-capture and image lib
**Priority:** Low | **Labels:** Technical Debt
**Description:** HEIC_EXTENSIONS duplicated. image.ts already exports isHeicFile() which encapsulates this.
**Acceptance Criteria:**
- [ ] photo-capture.tsx uses isHeicFile() from image.ts instead of own constant
- [ ] Local HEIC_EXTENSIONS removed from photo-capture.tsx

### FOO-108: Hardcoded colors not adapting to dark mode in several components
**Priority:** Low | **Labels:** Convention
**Description:** Multiple components use hardcoded Tailwind colors instead of theme tokens.
**Acceptance Criteria:**
- [ ] All listed locations replaced with theme-aware equivalents
- [ ] Dark mode renders correctly for all affected components

### FOO-110: Tests use real user email and name as test fixtures
**Priority:** Low | **Labels:** Technical Debt
**Description:** Tests contain real email "wall.lucas@gmail.com" and name "Lucas Wall" as fixtures.
**Acceptance Criteria:**
- [ ] Test fixtures use fictional values (e.g., "test@example.com", "Test User")
- [ ] ALLOWED_EMAIL env stub updated to match fictional email

### FOO-111: Type assertion test in types/index.test.ts has no meaningful runtime assertions
**Priority:** Low | **Labels:** Technical Debt
**Description:** FoodAnalysis type test creates typed object and asserts fields — compile-time check pretending to be runtime test.
**Acceptance Criteria:**
- [ ] Test removed or replaced with meaningful runtime tests (e.g., testing getUnitById, getUnitLabel)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All dependencies installed (`npm install`)
- [ ] Tests pass (`npm test`)

## Implementation Tasks

### Task 1: Create env var validation module

**Issue:** FOO-93
**Files:**
- `src/lib/__tests__/env.test.ts` (create)
- `src/lib/env.ts` (create)

**TDD Steps:**

1. **RED** - Write failing test:
   - Create `src/lib/__tests__/env.test.ts`
   - Test `getRequiredEnv(name)` throws when env var is missing
   - Test `getRequiredEnv(name)` returns value when present
   - Test `validateRequiredEnvVars()` throws listing all missing vars
   - Run: `npm test -- env`
   - Verify: Tests fail (module doesn't exist)

2. **GREEN** - Make it pass:
   - Create `src/lib/env.ts`
   - Implement `getRequiredEnv(name: string): string` — throws with clear message if missing
   - Implement `validateRequiredEnvVars()` — checks all required vars at once, throws listing all missing
   - Required vars: `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FITBIT_CLIENT_ID`, `FITBIT_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `APP_URL`, `ALLOWED_EMAIL`
   - Run: `npm test -- env`
   - Verify: Tests pass

3. **REFACTOR** - Pattern follows `url.ts` — use logger for error reporting before throwing.

**Notes:**
- Reference: `src/lib/url.ts` for the validated env var pattern
- Do NOT import logger at module level in env.ts — logger itself may depend on env vars. Use lazy import or accept logger dependency.

### Task 2: Wire env validation into startup and replace non-null assertions

**Issue:** FOO-93
**Files:**
- `src/instrumentation.ts` (modify)
- `src/lib/session.ts` (modify)
- `src/lib/auth.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/session.test.ts` (modify — update env stubs if needed)
- Existing tests in auth, fitbit, claude directories (modify — ensure env stubs cover new imports)

**TDD Steps:**

1. **RED** - Update existing tests:
   - Verify existing tests still pass with the new env module (they should since they stub env vars)
   - Add test to `instrumentation.ts` tests (or create one) verifying `validateRequiredEnvVars()` is called at startup
   - Run: `npm test`
   - Verify: New test fails

2. **GREEN** - Wire it up:
   - In `src/instrumentation.ts` `register()`: call `validateRequiredEnvVars()` at the top
   - In `src/lib/session.ts`: replace `process.env.SESSION_SECRET!` with `getRequiredEnv("SESSION_SECRET")`
   - In `src/lib/auth.ts`: replace all `process.env.GOOGLE_CLIENT_ID!` and `process.env.GOOGLE_CLIENT_SECRET!` with `getRequiredEnv()`
   - In `src/lib/fitbit.ts`: replace all `process.env.FITBIT_CLIENT_ID!` and `process.env.FITBIT_CLIENT_SECRET!` with `getRequiredEnv()`
   - In `src/lib/claude.ts`: replace `process.env.ANTHROPIC_API_KEY` with `getRequiredEnv("ANTHROPIC_API_KEY")`
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** - Remove all `!` assertions on `process.env` for critical vars. Verify no remaining non-null assertions with grep.

### Task 3: Add timeouts to OAuth fetch calls

**Issue:** FOO-92
**Files:**
- `src/lib/__tests__/auth.test.ts` (modify or create)
- `src/lib/__tests__/fitbit.test.ts` (modify or create)
- `src/lib/auth.ts` (modify)
- `src/lib/fitbit.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test that `exchangeGoogleCode` aborts after timeout
   - Test that `getGoogleProfile` aborts after timeout
   - Test that `exchangeFitbitCode` aborts after timeout
   - Test that `refreshFitbitToken` aborts after timeout
   - Use `vi.useFakeTimers()` + mock fetch that never resolves
   - Run: `npm test -- auth fitbit`
   - Verify: Tests fail (no timeout implemented)

2. **GREEN** - Add timeouts:
   - In `src/lib/auth.ts`: create a local `OAUTH_TIMEOUT_MS = 10000` constant
   - Wrap each fetch in AbortController with setTimeout, matching the pattern from `fetchWithRetry` in fitbit.ts
   - In `src/lib/fitbit.ts`: add same pattern to `exchangeFitbitCode` and `refreshFitbitToken` (the only two without timeouts)
   - Run: `npm test -- auth fitbit`
   - Verify: Tests pass

3. **REFACTOR** - Consider extracting a shared `fetchWithTimeout` helper if the pattern is identical across all 4 calls. Place in `src/lib/fetch.ts` if extracted.

**Notes:**
- Reference: `src/lib/fitbit.ts:29-64` for the existing AbortController + timeout pattern
- The 4 affected calls: auth.ts:21, auth.ts:47, fitbit.ts:215, fitbit.ts:253

### Task 4: Add runtime validation for external API responses

**Issue:** FOO-91
**Files:**
- `src/lib/__tests__/auth.test.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/lib/auth.ts` (modify)
- `src/lib/fitbit.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test `exchangeGoogleCode` throws when response missing `access_token`
   - Test `getGoogleProfile` throws when response missing `email` or `name`
   - Test `exchangeFitbitCode` throws when response missing `access_token`, `refresh_token`, `user_id`, or `expires_in`
   - Test `refreshFitbitToken` throws when response missing required fields
   - Test `createFood` throws when response missing `food.foodId`
   - Test `logFood` throws when response missing `foodLog.logId`
   - Run: `npm test -- auth fitbit`
   - Verify: Tests fail

2. **GREEN** - Add validation:
   - After each `response.json()` call, validate required fields exist and have correct types
   - Pattern: check typeof for strings, numbers, objects; throw descriptive error on mismatch
   - Keep validation inline (no validation library — project doesn't use zod)
   - Example for auth.ts `exchangeGoogleCode`:
     ```typescript
     const data = await response.json();
     if (typeof data.access_token !== "string") {
       throw new Error("Invalid Google token response: missing access_token");
     }
     return data as { access_token: string };
     ```
   - Run: `npm test -- auth fitbit`
   - Verify: Tests pass

3. **REFACTOR** - Ensure error messages are descriptive enough for debugging but don't leak sensitive values.

### Task 5: Add runtime validation for Claude API tool_use output

**Issue:** FOO-90
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify or create)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Test that `analyzeFood` throws when tool_use output has missing fields
   - Test that `analyzeFood` throws when numeric fields are strings
   - Test that `analyzeFood` throws when numeric fields are negative
   - Test that `analyzeFood` throws when confidence is not "high"/"medium"/"low"
   - Test that valid output passes validation
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** - Add validation:
   - Create a `validateFoodAnalysis(input: unknown): FoodAnalysis` function in claude.ts
   - Validate all fields: food_name (non-empty string), amount (positive number), unit_id (number), calories/protein_g/carbs_g/fat_g/fiber_g/sodium_mg (non-negative numbers), confidence (enum), notes (string)
   - Replace `toolUseBlock.input as FoodAnalysis` with `validateFoodAnalysis(toolUseBlock.input)`
   - Throw `ClaudeApiError` with descriptive message on validation failure
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** - The `validateFoodAnalysis` function is also useful for the `isValidFoodLogRequest` guard in log-food/route.ts. Consider if they can share validation logic. But keep scope tight — only validate Claude output here.

**Notes:**
- Reference: `src/app/api/log-food/route.ts:17-45` for the existing `isValidFoodLogRequest` runtime type guard pattern.

### Task 6: Extract shared session validation utility

**Issue:** FOO-100, FOO-95
**Files:**
- `src/lib/__tests__/session.test.ts` (modify)
- `src/lib/session.ts` (modify)
- `src/app/api/auth/session/route.ts` (modify)
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests for the shared validator:
   - Test `validateSession(session)` returns error response when sessionId is missing
   - Test returns error response when expiresAt is missing (FOO-95 fix)
   - Test returns error response when session expired
   - Test returns error response when fitbit is missing (optional param to require it)
   - Test returns null when session is valid
   - Run: `npm test -- session`
   - Verify: Tests fail

2. **GREEN** - Implement shared validator:
   - Add to `src/lib/session.ts`:
     ```typescript
     export function validateSession(
       session: SessionData,
       options?: { requireFitbit?: boolean }
     ): Response | null
     ```
   - Returns an `errorResponse()` for the first failing check, or `null` if valid
   - Checks: `!session.sessionId`, `!session.expiresAt || session.expiresAt < Date.now()`, optionally `!session.fitbit`
   - Update all three routes to use `validateSession(session, { requireFitbit: true })` (for analyze-food and log-food) and `validateSession(session)` (for auth/session route)
   - This also fixes FOO-95 (session route now checks `!session.expiresAt`)
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** - Remove duplicated validation blocks from each route. Keep logger calls inside the shared validator.

### Task 7: Add session verification to Fitbit OAuth callback

**Issue:** FOO-99
**Files:**
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` (modify or create)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test:
   - Test that Fitbit callback returns 401 when no authenticated session exists (session.sessionId is missing)
   - Run: `npm test -- fitbit/callback`
   - Verify: Test fails (currently stores tokens without checking)

2. **GREEN** - Add check:
   - After `const session = await getSession()`, add:
     ```typescript
     if (!session.sessionId) {
       logger.warn({ action: "fitbit_callback_no_session" }, "fitbit callback without authenticated session");
       return errorResponse("AUTH_MISSING_SESSION", "No authenticated session", 401);
     }
     ```
   - Run: `npm test -- fitbit/callback`
   - Verify: Test passes

3. **REFACTOR** - Verify existing tests still pass.

### Task 8: Add error logging to OAuth callback catch blocks

**Issue:** FOO-103
**Files:**
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` (modify)
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests verifying errors are logged:
   - Mock logger and verify `logger.error` is called when exchangeGoogleCode fails
   - Same for getGoogleProfile failure
   - Same for exchangeFitbitCode failure
   - Run: `npm test -- callback`
   - Verify: Tests fail

2. **GREEN** - Add error logging:
   - Change bare `catch {` to `catch (error) {` and add logger.error before returning error response
   - Pattern:
     ```typescript
     } catch (error) {
       logger.error(
         { action: "google_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
         "failed to exchange google authorization code"
       );
       return errorResponse(...);
     }
     ```
   - Run: `npm test -- callback`
   - Verify: Tests pass

### Task 9: Extract shared getCookieValue utility

**Issue:** FOO-101
**Files:**
- `src/lib/__tests__/cookies.test.ts` (create)
- `src/lib/cookies.ts` (create)
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests:
   - Test `getCookieValue(request, "name")` returns value when cookie exists
   - Test returns undefined when cookie is missing
   - Test handles multiple cookies
   - Test handles empty cookie header
   - Run: `npm test -- cookies`
   - Verify: Tests fail

2. **GREEN** - Extract:
   - Create `src/lib/cookies.ts` with `export function getCookieValue(...)`
   - Move the implementation from either callback route
   - Update both callback routes to import from `@/lib/cookies`
   - Remove local `getCookieValue` from both routes
   - Run: `npm test`
   - Verify: All tests pass

### Task 10: Extract shared confidence display constants

**Issue:** FOO-102
**Files:**
- `src/lib/confidence.ts` (create)
- `src/components/analysis-result.tsx` (modify)
- `src/components/nutrition-editor.tsx` (modify)

**TDD Steps:**

1. **RED** - No tests needed for pure constant extraction. Verify existing component tests pass before and after.

2. **GREEN** - Extract:
   - Create `src/lib/confidence.ts` exporting `confidenceColors` and `confidenceExplanations` as const objects
   - Update both components to import from `@/lib/confidence`
   - Remove local definitions from both components
   - Run: `npm test`
   - Verify: All tests pass

### Task 11: Remove duplicated HEIC_EXTENSIONS from photo-capture

**Issue:** FOO-109
**Files:**
- `src/lib/image.ts` (modify — export HEIC_EXTENSIONS or isHeicFile)
- `src/components/photo-capture.tsx` (modify)

**TDD Steps:**

1. **RED** - Verify existing tests pass before making changes.

2. **GREEN** - Deduplicate:
   - In `src/lib/image.ts`: export the `HEIC_EXTENSIONS` constant (add `export` keyword)
   - In `src/components/photo-capture.tsx`: import `HEIC_EXTENSIONS` from `@/lib/image` and remove local definition
   - Alternative: use `isHeicFile()` from image.ts if the usage pattern allows
   - Run: `npm test`
   - Verify: All tests pass

### Task 12: Add security headers to Next.js config

**Issue:** FOO-98
**Files:**
- `next.config.ts` (modify)

**TDD Steps:**

1. **RED** - No unit test for config file. Manual verification via build.

2. **GREEN** - Add headers:
   - Add `headers()` async function to `next.config.ts`:
     ```typescript
     const nextConfig: NextConfig = {
       async headers() {
         return [
           {
             source: "/(.*)",
             headers: [
               { key: "X-Frame-Options", value: "DENY" },
               { key: "X-Content-Type-Options", value: "nosniff" },
               { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
               { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
               { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
             ],
           },
         ];
       },
     };
     ```
   - Note: CSP is complex with Next.js (inline scripts, etc). Add basic headers first; CSP can be a follow-up.
   - Run: `npm run build`
   - Verify: Build succeeds

### Task 13: Fix parseInt NaN in nutrition-editor

**Issue:** FOO-96
**Files:**
- `src/components/__tests__/nutrition-editor.test.tsx` (modify or create)
- `src/components/nutrition-editor.tsx` (modify)

**TDD Steps:**

1. **RED** - Write test:
   - Test that selecting a non-numeric unit value doesn't produce NaN in state
   - Run: `npm test -- nutrition-editor`
   - Verify: Test fails

2. **GREEN** - Fix:
   - After `parseInt(newUnitId, 10)`, add NaN guard:
     ```typescript
     const parsed = parseInt(newUnitId, 10);
     if (isNaN(parsed)) return;
     ```
   - Run: `npm test -- nutrition-editor`
   - Verify: Test passes

### Task 14: Fix ensureFreshToken to save session internally

**Issue:** FOO-94
**Files:**
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write test:
   - Test that `ensureFreshToken` calls `session.save()` after refreshing tokens
   - Use mock session object with spy on `save`
   - Run: `npm test -- fitbit`
   - Verify: Test fails

2. **GREEN** - Fix:
   - Change `ensureFreshToken` signature to accept the iron-session object (with `.save()` method) instead of plain `SessionData`
   - Type: `session: SessionData & { save: () => Promise<void> }`
   - After updating `session.fitbit`, call `await session.save()`
   - In `src/app/api/log-food/route.ts`: remove the redundant `await session.save()` call after `ensureFreshToken`
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** - Consider adding an `IronSessionWithData` type alias if useful. Keep it simple.

### Task 15: Improve date and time validation

**Issue:** FOO-105
**Files:**
- `src/app/api/log-food/__tests__/route.test.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)

**TDD Steps:**

1. **RED** - Write tests:
   - Test `isValidDateFormat("9999-99-99")` returns false
   - Test `isValidDateFormat("2024-02-30")` returns false (Feb 30 doesn't exist)
   - Test `isValidDateFormat("2024-01-15")` returns true
   - Test `isValidTimeFormat("99:99:99")` returns false
   - Test `isValidTimeFormat("14:30:00")` returns true
   - Run: `npm test -- log-food`
   - Verify: Tests fail for invalid semantic values

2. **GREEN** - Fix validation:
   - `isValidDateFormat`: after regex check, parse year/month/day and verify month 1-12, day 1-31, and that `new Date(date)` produces a valid date
   - `isValidTimeFormat`: after regex check, parse hours/minutes/seconds and verify hours 0-23, minutes 0-59, seconds 0-59
   - Run: `npm test -- log-food`
   - Verify: Tests pass

### Task 16: Add rate limit handling for Claude API

**Issue:** FOO-107
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** - Write test:
   - Test that `analyzeFood` retries on 429 error with exponential backoff
   - Test that it gives up after max retries on persistent 429
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** - Add 429 handling:
   - In the catch block, detect rate limit errors (Anthropic SDK throws `RateLimitError` or similar)
   - Add retry logic similar to existing timeout retry: wait with exponential backoff, retry up to maxRetries
   - Update `isTimeoutError` or add `isRateLimitError` helper
   - Run: `npm test -- claude`
   - Verify: Tests pass

**Notes:**
- Reference: `src/lib/fitbit.ts:47-58` for the existing 429 + exponential backoff pattern
- The Anthropic SDK may throw a specific error class for 429s. Check `@anthropic-ai/sdk` error types.

### Task 17: Fix console.error leak in global-error.tsx

**Issue:** FOO-104
**Files:**
- `src/app/__tests__/global-error.test.tsx` (modify or create)
- `src/app/global-error.tsx` (modify)

**TDD Steps:**

1. **RED** - Write test:
   - Test that in production mode, console.error is NOT called with error details
   - Test that in development mode, console.error IS called
   - Run: `npm test -- global-error`
   - Verify: Test fails

2. **GREEN** - Fix:
   - Wrap console.error in a `process.env.NODE_ENV !== "production"` check
   - In production, log only a generic message like "Application error occurred"
   - Run: `npm test -- global-error`
   - Verify: Test passes

### Task 18: Validate localStorage theme value

**Issue:** FOO-97
**Files:**
- `src/app/layout.tsx` (modify)

**TDD Steps:**

1. **RED** - No unit test for inline script. Visual verification.

2. **GREEN** - Fix the theme script:
   - Add validation before `root.classList.add(stored)`:
     ```javascript
     var allowed = ["dark", "light", "system"];
     if (allowed.indexOf(stored) === -1) stored = "system";
     ```
   - Run: `npm run build`
   - Verify: Build succeeds

### Task 19: Add graceful shutdown handling

**Issue:** FOO-106
**Files:**
- `src/instrumentation.ts` (modify)

**TDD Steps:**

1. **RED** - Difficult to unit test signal handlers. Manual verification.

2. **GREEN** - Add shutdown handling:
   - In `register()`, add SIGTERM/SIGINT handlers:
     ```typescript
     const shutdown = (signal: string) => {
       logger.info({ action: "server_shutdown", signal }, "graceful shutdown initiated");
       // Give in-flight requests a brief window to complete
       setTimeout(() => {
         logger.info({ action: "server_exit" }, "server exiting");
         process.exit(0);
       }, 5000);
     };
     process.on("SIGTERM", () => shutdown("SIGTERM"));
     process.on("SIGINT", () => shutdown("SIGINT"));
     ```
   - Run: `npm run build`
   - Verify: Build succeeds

### Task 20: Fix hardcoded colors for dark mode

**Issue:** FOO-108
**Files:**
- `src/app/global-error.tsx` (modify)
- `src/components/analysis-result.tsx` (modify)
- `src/components/description-input.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **RED** - Visual changes, no unit tests needed. Verify build.

2. **GREEN** - Replace hardcoded colors:
   - `global-error.tsx:34`: `bg-zinc-900` → `bg-background` (or appropriate theme class)
   - `analysis-result.tsx:52,108`: `text-gray-500`/`text-gray-600` → `text-muted-foreground`
   - `description-input.tsx:30`: `text-gray-500` → `text-muted-foreground`
   - `photo-capture.tsx:240`: `text-gray-500` → `text-muted-foreground`
   - `food-analyzer.tsx:339`: `bg-red-50 border-red-200` → `bg-destructive/10 border-destructive/20` (or similar theme-aware)
   - Run: `npm run build`
   - Verify: Build succeeds

### Task 21: Replace real user data in test fixtures

**Issue:** FOO-110
**Files:**
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)
- Any other test files containing "wall.lucas@gmail.com" or "Lucas Wall"

**TDD Steps:**

1. **RED** - Grep for real email/name in test files to find all occurrences.

2. **GREEN** - Replace:
   - Change `"wall.lucas@gmail.com"` to `"test@example.com"` in test fixtures
   - Change `"Lucas Wall"` to `"Test User"` in test fixtures
   - Update `vi.stubEnv("ALLOWED_EMAIL", ...)` to match the fictional email
   - Run: `npm test`
   - Verify: All tests pass

### Task 22: Fix or replace type assertion test

**Issue:** FOO-111
**Files:**
- `src/types/__tests__/index.test.ts` (modify)

**TDD Steps:**

1. **RED** - Read the existing test to understand what it does.

2. **GREEN** - Replace with meaningful tests:
   - Remove the FoodAnalysis type assertion test (it's a compile-time check, not a runtime test)
   - Add meaningful runtime tests for `getUnitById()` and `getUnitLabel()` which are actual functions in `src/types/index.ts`
   - Test `getUnitById(147)` returns the gram unit
   - Test `getUnitById(999)` returns undefined
   - Test `getUnitLabel(147, 1)` returns "1g"
   - Test `getUnitLabel(147, 2)` returns "2g"
   - Test `getUnitLabel(91, 1)` returns "1 cup"
   - Test `getUnitLabel(91, 2)` returns "2 cups"
   - Test `getUnitLabel(999, 1)` returns "1 units" (unknown unit fallback)
   - Run: `npm test -- types`
   - Verify: Tests pass

### Task 23: Integration & Verification

**Issues:** All
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] App starts without missing env var errors (when all vars are set)
   - [ ] Dark mode toggles correctly in all affected components
   - [ ] Security headers appear in response (check via browser devtools)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move each issue to "In Progress" when starting its task, "Done" when complete |
| Linear | `create_comment` | Add comments if implementation deviates from plan |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Missing env var at startup | App refuses to start with clear error listing missing vars | Unit test (Task 1) |
| OAuth fetch timeout | Request aborted after 10s, error thrown | Unit test (Task 3) |
| Malformed API response | Descriptive error thrown, no silent propagation | Unit test (Task 4, 5) |
| Claude 429 rate limit | Retry with exponential backoff | Unit test (Task 16) |
| Corrupted session (missing expiresAt) | Treated as expired, returns 401 | Unit test (Task 6) |
| NaN from parseInt in nutrition editor | Silently ignored, state not updated | Unit test (Task 13) |
| Invalid date/time values | Rejected with validation error | Unit test (Task 15) |

## Risks & Open Questions

- [ ] Task 2 (env validation at startup): Must be careful not to break test setup. All existing tests that stub env vars must still work. The `validateRequiredEnvVars()` call in `register()` only runs at server startup, not during test imports.
- [ ] Task 12 (security headers): CSP is intentionally omitted from this plan because Next.js uses inline scripts (including the theme script). A proper CSP with nonces would be a separate, more involved task.
- [ ] Task 14 (ensureFreshToken): Changing the function signature is a breaking change, but this project has a "breaking changes OK" policy. Only one caller exists (log-food/route.ts).
- [ ] Task 16 (Claude rate limits): The Anthropic SDK error classes may vary by version. Need to check the actual error type thrown for 429s during implementation.

## Scope Boundaries

**In Scope:**
- All 22 Backlog issues listed above
- Shared utility extraction where explicitly called for
- Test updates to maintain coverage

**Out of Scope:**
- Content-Security-Policy header (complex with Next.js inline scripts)
- Zod or other validation library (project doesn't use one; keep inline validation)
- Refactoring fetchWithRetry to be truly shared (would require more refactoring than warranted)
- Any new features not mentioned in the issues
