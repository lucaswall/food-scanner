# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-399-backlog-sweep
**Issues:** FOO-399, FOO-400, FOO-401, FOO-402, FOO-403, FOO-404, FOO-405, FOO-406, FOO-407, FOO-408, FOO-409, FOO-410, FOO-411, FOO-412, FOO-413, FOO-414, FOO-415, FOO-416, FOO-417, FOO-418, FOO-419, FOO-420, FOO-421, FOO-422, FOO-423, FOO-424, FOO-425, FOO-426, FOO-427, FOO-428, FOO-429, FOO-430, FOO-431, FOO-432, FOO-433, FOO-434
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Comprehensive backlog sweep addressing 36 issues across error handling, timezone consistency, dashboard UX, code quality, and security. Issues originate from code audits and frontend reviews. Tasks are ordered by dependency — foundational library changes first, then route-level fixes, then UI improvements.

## Issues

### FOO-419: isValidDateFormat duplicated across 8 route handlers — extract to date-utils
**Priority:** Low | **Labels:** Convention
**Description:** Identical `isValidDateFormat` function copy-pasted in `fasting/route.ts`, `log-food/route.ts`, `lumen-goals/route.ts`, `nutrition-summary/route.ts`, and 4 v1 routes. `src/lib/date-utils.ts` already exists but lacks this function.

### FOO-404: MealBreakdown duplicates MEAL_TYPE_LABELS instead of using shared constant
**Priority:** Low | **Labels:** Convention
**Description:** `src/components/meal-breakdown.tsx` (lines 7-14) defines local `MEAL_TYPE_LABELS` identical to `FITBIT_MEAL_TYPE_LABELS` in `src/types/index.ts` (lines 141-148).

### FOO-412: FoodAnalyzer `logging` setter dropped — keyboard shortcut can double-submit
**Priority:** High | **Labels:** Bug
**Description:** `const [logging] = useState(false)` on line 43 of `food-analyzer.tsx` has no setter. `logging` is always `false`, making `canLog`, `disabled={logging}`, and button text guards ineffective. Keyboard shortcuts via `useKeyboardShortcuts` can trigger `handleLogToFitbit` during in-flight requests.

### FOO-414: No AbortController on analysis fetch — stale results display after photos cleared
**Priority:** High | **Labels:** Bug
**Description:** `handleAnalyze` calls `fetch("/api/analyze-food")` (line 141) and `fetch("/api/find-matches")` (line 161) without AbortController. If `resetAnalysisState()` is called while fetches are in-flight, they resolve and call `setAnalysis`/`setMatches`, displaying stale results.

### FOO-415: Image compression warning setTimeout can clear real analysis errors
**Priority:** Medium | **Labels:** Bug
**Description:** `setTimeout(() => setError(null), 3000)` (line 113) fires regardless. If the analysis API returns an error within 3 seconds (line 153, `setError`), the timeout clears the real error message.

### FOO-430: ensureFreshToken doesn't handle upsertFitbitTokens failure — refresh token corruption
**Priority:** High | **Labels:** Bug
**Description:** In `ensureFreshToken` (lines 457-468), if `refreshFitbitToken` succeeds but `upsertFitbitTokens` throws (DB error), new tokens are lost. Fitbit's refresh token rotation invalidates the old token, so the DB retains a now-invalid refresh token.

### FOO-428: refreshFitbitToken treats all HTTP errors as FITBIT_TOKEN_INVALID
**Priority:** Low | **Labels:** Bug
**Description:** Line 415: any `!response.ok` throws `Error("FITBIT_TOKEN_INVALID")`. Transient 500s and 429s from Fitbit's OAuth server are misclassified, causing unnecessary "reconnect your Fitbit" prompts.

### FOO-426: FITBIT_TIMEOUT error never surfaced as timeout to users
**Priority:** Medium | **Labels:** Bug
**Description:** `fetchWithRetry` throws `Error("FITBIT_TIMEOUT")` when `DEADLINE_MS` is exceeded. No route handler checks for this error message. It falls to generic catch-all, returning "Failed to log food to Fitbit" without indicating it was a timeout.

### FOO-427: SWR apiFetcher discards error code — Fitbit errors unactionable on dashboard
**Priority:** Medium | **Labels:** Bug
**Description:** `apiFetcher` (line 5) extracts only `body.error?.message`, discarding the error `code`. Components using SWR cannot distinguish `FITBIT_TOKEN_INVALID` from `FITBIT_API_ERROR` from `FITBIT_CREDENTIALS_MISSING`.

### FOO-423: 404 responses use VALIDATION_ERROR error code instead of NOT_FOUND
**Priority:** Low | **Labels:** Convention
**Description:** `food-history/[id]/route.ts` lines 25, 54 return 404 with `VALIDATION_ERROR` instead of `NOT_FOUND`. The `NOT_FOUND` code exists in `ErrorCode` type.

### FOO-422: Inconsistent HTTP status for Fitbit upstream errors — 500 vs 502
**Priority:** Low | **Labels:** Convention
**Description:** Some routes return 502 for `FITBIT_API_ERROR` (nutrition-goals, v1 routes), others return 500 (log-food, food-history DELETE). 502 is semantically correct.

### FOO-429: Inconsistent HTTP status for FITBIT_CREDENTIALS_MISSING — 400 vs 404
**Priority:** Low | **Labels:** Convention
**Description:** Routes returning `FITBIT_CREDENTIALS_MISSING` use different HTTP status codes (400 in log-food, 404 in nutrition-goals and v1 routes). 424 (Failed Dependency) would be more accurate semantically. Standardize to one code.

### FOO-420: Inconsistent Fitbit error handling — routes miss SCOPE_MISSING and RATE_LIMIT
**Priority:** Medium | **Labels:** Bug
**Description:** v1 routes handle `FITBIT_SCOPE_MISSING` but browser routes don't. `FITBIT_RATE_LIMIT` handled only in `log-food`. `FITBIT_TIMEOUT` handled nowhere (see FOO-426).

### FOO-421: Database operations unprotected by try/catch in 7 route handlers
**Priority:** Medium | **Labels:** Bug
**Description:** Seven route handlers call DB functions outside try/catch. If DB calls throw, error propagates unhandled to Next.js, returning `{"error": "Internal Server Error"}` instead of `ApiErrorResponse`.

### FOO-413: FoodChat missing FITBIT_TOKEN_INVALID handling — no reconnect path
**Priority:** High | **Labels:** Bug
**Description:** `handleLog` (line 301-302) shows generic error message but never checks `result.error?.code` for `FITBIT_TOKEN_INVALID`. User sees "Failed to log food to Fitbit" with no way to reconnect from chat.

### FOO-425: FoodHistory delete error shows no recovery action for FITBIT_TOKEN_INVALID
**Priority:** High | **Labels:** Bug
**Description:** `handleDeleteConfirm` (line 177) shows `result.error?.message` but never checks error code. No link to Settings or reconnect button for token-related errors.

### FOO-432: Pending resubmit ignores error codes — no redirect or Settings link
**Priority:** Medium | **Labels:** Bug
**Description:** Pending resubmit in QuickSelect (lines 144-164) treats all errors generically. Doesn't inspect `result.error?.code` for `FITBIT_TOKEN_INVALID` or `FITBIT_CREDENTIALS_MISSING`.

### FOO-411: Fasting API live mode uses server-side isToday() — fails after UTC midnight
**Priority:** Medium | **Labels:** Bug
**Description:** `isToday(date)` on line 47 of `fasting/route.ts` uses server's `getTodayDate()` (UTC on Railway). Client sending its local "today" may mismatch after UTC midnight.

### FOO-410: Common-foods API ranks suggestions using server UTC date/time
**Priority:** Medium | **Labels:** Bug
**Description:** Lines 50-52 of `common-foods/route.ts`: `const now = new Date(); const currentTime = now.toTimeString().slice(0, 8); const currentDate = now.toISOString().slice(0, 10);` — server UTC time used for time-of-day ranking. A 3-hour offset (UTC-3 user) means breakfast foods suggested at wrong times.

### FOO-403: Nutrition-goals API captures calorie goal with server-side date
**Priority:** Medium | **Labels:** Bug
**Description:** Line 20: `const todayDate = getTodayDate()` — server UTC date. Client's local date may differ, causing goal captured for wrong date.

### FOO-431: Optimistic success + haptic fires before API confirmation — reverts on error
**Priority:** Medium | **Labels:** Improvement
**Description:** `handleLogToFitbit` in QuickSelect sets `logResponse` optimistically (line 190) before the API call. `FoodLogConfirmation` triggers `vibrateSuccess()` on mount. If API fails, success screen disappears and error appears — user already received false positive feedback.

### FOO-433: foodToAnalysis drops Tier 1 nutrients — success screen shows fewer details
**Priority:** Low | **Labels:** Bug
**Description:** `foodToAnalysis()` (lines 32-48) omits `saturated_fat_g`, `trans_fat_g`, `sugars_g`, and `calories_from_fat`. The detail view passes these from `selectedFood` to `NutritionFactsCard`, but the success screen gets the incomplete `foodToAnalysis()` result.

### FOO-434: Quick select loading.tsx skeleton doesn't match page layout
**Priority:** Low | **Labels:** Convention
**Description:** Loading skeleton shows heading + 3 food card skeletons. Actual page renders heading + tab bar (Suggested/Recent) + search input + food cards.

### FOO-416: find-matches API rejects empty keywords array — matches silently suppressed
**Priority:** Medium | **Labels:** Bug
**Description:** `/api/find-matches` (lines 23-24) returns 400 when `keywords.length === 0`. If Claude's analysis returns `keywords: []`, match search silently fails. Should return empty matches instead.

### FOO-417: HEIC files are converted twice — preview and upload paths both convert
**Priority:** Low | **Labels:** Performance
**Description:** HEIC → JPEG conversion happens in `photo-capture.tsx:127` for preview, then again in `compressImage()` at `image.ts:48` when the original `File` objects (not converted blobs) are passed to `handleAnalyze`.

### FOO-399: Dashboard error states lack retry action
**Priority:** Medium | **Labels:** Improvement
**Description:** DailyDashboard (lines 153-161) and WeeklyDashboard (lines 78-96) display error text only. No retry button despite `useSWR` supporting `mutate()` for manual revalidation.

### FOO-400: WeeklyDashboard does not reset to current week on tab re-focus
**Priority:** Medium | **Labels:** Bug
**Description:** DailyDashboard resets to today on visibility change, but WeeklyDashboard has no equivalent. User returning after idle sees stale past-week view.

### FOO-401: DailyDashboard visibility change revalidates all SWR caches
**Priority:** Medium | **Labels:** Performance
**Description:** `globalMutate(() => true)` on line 75 triggers revalidation of every SWR cache key — common-foods, food-history, auth/session, prefetched data — not just dashboard endpoints.

### FOO-402: Dashboard segmented controls lack ARIA tab/pressed attributes
**Priority:** Medium | **Labels:** Improvement
**Description:** Daily/Weekly toggle in `dashboard-shell.tsx` (lines 15-36) and metric selector in `weekly-nutrition-chart.tsx` use plain `<button>` with visual-only active styling. No `role="tab"`, `aria-selected`, or `aria-pressed`.

### FOO-405: WeeklyNutritionChart empty-day check always uses calories regardless of metric
**Priority:** Low | **Labels:** Bug
**Description:** Line 131: `const isEmpty = day.data === null || day.data.calories === 0` — checks calories even when viewing protein/carbs/fat.

### FOO-406: WeekNavigator allows infinite backward navigation with no lower bound
**Priority:** Low | **Labels:** Improvement
**Description:** `handlePrevious` (line 23) has no `disabled` guard. Users can scroll infinitely into the past, making unnecessary API calls for weeks with no data. DateNavigator already uses `earliestDate` prop for this.

### FOO-407: FastingCard live duration can display negative values on timezone mismatch
**Priority:** Low | **Labels:** Bug
**Description:** `calculateLiveDuration` (lines 26-31) returns `Math.floor(diffMs / 60000)` with no lower bound clamp. If `startDateTime` is ahead of `now` due to timezone edge cases, displays negative duration.

### FOO-408: MealBreakdown food entries don't link to food detail page
**Priority:** Low | **Labels:** Improvement
**Description:** Entries in expanded meal accordion (lines 84-100) rendered as plain `<div>`. Food detail page exists at `/app/food-detail/[id]` but is only reachable from history page, not dashboard.

### FOO-409: DailyDashboard loading state blocks entire view when goals endpoint is slow
**Priority:** Low | **Labels:** Performance
**Description:** Line 148: `if (summaryLoading || goalsLoading)` — both loading states block entire dashboard skeleton. Nutrition summary data could render while goals are still loading.

### FOO-418: FoodLogConfirmation has no "Log Another" action
**Priority:** Low | **Labels:** Improvement
**Description:** Only "Done" button (lines 84-92) navigating to `/app`. No option to immediately log another food item for users logging multiple items in succession.

### FOO-424: v1 API routes have no rate limiting — external API keys can exhaust Fitbit quotas
**Priority:** Medium | **Labels:** Security
**Description:** All 5 v1 routes authenticate via Bearer token but have no rate limiting. `checkRateLimit` from `src/lib/rate-limit.ts` is used in browser routes (`analyze-food`, `chat-food`, `lumen-goals`) but not in any v1 equivalent.

## Prerequisites

- [ ] All existing tests pass
- [ ] On `main` branch with clean working tree

## Implementation Tasks

### Task 1: Code deduplication foundation (FOO-419, FOO-404)

**Issues:** FOO-419, FOO-404
**Files:**
- `src/lib/date-utils.ts` (modify)
- `src/lib/__tests__/date-utils.test.ts` (create — no existing test file for date-utils)
- `src/app/api/fasting/route.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/lumen-goals/route.ts` (modify)
- `src/app/api/nutrition-summary/route.ts` (modify)
- `src/app/api/v1/nutrition-summary/route.ts` (modify)
- `src/app/api/v1/lumen-goals/route.ts` (modify)
- `src/app/api/v1/activity-summary/route.ts` (modify)
- `src/app/api/v1/food-log/route.ts` (modify)
- `src/components/meal-breakdown.tsx` (modify)
- `src/components/__tests__/meal-breakdown.test.tsx` (modify if existing tests reference local constant)

**TDD Steps:**

1. **RED** — Write tests for `isValidDateFormat` in `src/lib/__tests__/date-utils.test.ts`:
   - Valid: `"2026-02-14"` → true
   - Invalid: `"2026-13-01"` → false (bad month)
   - Invalid: `"2026-02-30"` → false (Feb 30 doesn't exist)
   - Invalid: `"not-a-date"` → false
   - Run: `npm test -- date-utils`

2. **GREEN** — Export `isValidDateFormat` from `src/lib/date-utils.ts` (move the existing implementation from any route file). Replace all 8 local copies with `import { isValidDateFormat } from "@/lib/date-utils"`.

3. **GREEN** — In `meal-breakdown.tsx`, replace the local `MEAL_TYPE_LABELS` constant with `import { FITBIT_MEAL_TYPE_LABELS } from "@/types"` and update all references from `MEAL_TYPE_LABELS[...]` to `FITBIT_MEAL_TYPE_LABELS[...]`.

4. **REFACTOR** — Verify all 8 route files still import `isValidDateFormat` correctly. Run affected route tests.

**Notes:**
- The local `isValidDateFormat` implementations are identical across all 8 files
- `FITBIT_MEAL_TYPE_LABELS` in `src/types/index.ts` (lines 141-148) is identical to local `MEAL_TYPE_LABELS` in `meal-breakdown.tsx` (lines 7-14)

---

### Task 2: Critical client-side bugs (FOO-412, FOO-414, FOO-415)

**Issues:** FOO-412, FOO-414, FOO-415
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (create if not exists, or modify)

**TDD Steps:**

1. **RED** — FOO-412: Write test that `logging` state setter exists and is called during `handleLogToFitbit`:
   - After calling the log function, verify the log button becomes disabled
   - Verify `canLog` evaluates to false during the API call
   - Run: `npm test -- food-analyzer`

2. **GREEN** — FOO-412: Change `const [logging] = useState(false)` to `const [logging, setLogging] = useState(false)`. Add `setLogging(true)` at start of `handleLogToFitbit` and `setLogging(false)` in the finally block (matching the pattern already used in `food-chat.tsx:280-316`).

3. **RED** — FOO-414: Write test that clearing photos aborts in-flight analysis fetch:
   - Start analysis, then clear photos before response
   - Verify `setAnalysis` is NOT called with stale data
   - Run: `npm test -- food-analyzer`

4. **GREEN** — FOO-414: Add `AbortController` ref to `FoodAnalyzer`. In `handleAnalyze`, create a new controller, pass its `signal` to both `fetch("/api/analyze-food")` and the match search fetch. In `resetAnalysisState`, call `controller.abort()`. Handle `AbortError` silently in catch blocks. Reference pattern: `food-chat.tsx:244` already uses `AbortSignal.timeout(30000)`.

5. **RED** — FOO-415: Write test that a real analysis error is NOT cleared by the compression warning timeout:
   - Simulate partial compression failure (warning with setTimeout)
   - Then simulate analysis API error within 3 seconds
   - Verify the analysis error message persists after 3+ seconds
   - Run: `npm test -- food-analyzer`

6. **GREEN** — FOO-415: Store the warning timeout ID in a ref. In the error handler (line 153), clear the warning timeout if it exists before setting the new error. This ensures the warning timeout cannot clear a real error.

**Notes:**
- The `logging` setter pattern already exists in `food-chat.tsx` (line 57: `const [logging, setLogging] = useState(false)`) and `quick-select.tsx` (line 112) — follow those patterns
- For AbortController, use a `useRef<AbortController | null>(null)` pattern

---

### Task 3: Fitbit token management (FOO-430, FOO-428, FOO-426)

**Issues:** FOO-430, FOO-428, FOO-426
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** — FOO-430: Write test for `ensureFreshToken` when `upsertFitbitTokens` throws:
   - Mock `refreshFitbitToken` to succeed with new tokens
   - Mock `upsertFitbitTokens` to throw on first call, succeed on retry
   - Verify function retries the DB upsert once
   - Verify the new access_token is returned (not thrown)
   - Write another test where retry also fails — verify error propagates with descriptive message
   - Run: `npm test -- fitbit`

2. **GREEN** — FOO-430: Wrap `upsertFitbitTokens` in a try/catch within `ensureFreshToken`. On failure, log a warning and retry once. If retry also fails, throw an error with a message like `"FITBIT_TOKEN_SAVE_FAILED"` (distinct from `FITBIT_TOKEN_INVALID`) so the caller can handle it differently.

3. **RED** — FOO-428: Write tests for `refreshFitbitToken` HTTP error classification:
   - 401 response → throws `FITBIT_TOKEN_INVALID` (genuine token issue)
   - 500 response → throws `FITBIT_REFRESH_TRANSIENT` (server error, retryable)
   - 429 response → throws `FITBIT_REFRESH_TRANSIENT` (rate limit, retryable)
   - Run: `npm test -- fitbit`

4. **GREEN** — FOO-428: In `refreshFitbitToken`, check `response.status` before throwing. Only throw `FITBIT_TOKEN_INVALID` for 400/401 responses (client errors indicating genuinely bad credentials). For 429/5xx, throw `FITBIT_REFRESH_TRANSIENT`.

5. **RED** — FOO-426: Write test for route handling of `FITBIT_TIMEOUT`:
   - In `log-food` route test, mock `ensureFreshToken` to throw `Error("FITBIT_TIMEOUT")`
   - Verify response returns a timeout-specific error message (e.g., "Request timed out") with appropriate code
   - Run: `npm test -- log-food`

6. **GREEN** — FOO-426: Add `FITBIT_TIMEOUT` to the `ErrorCode` union in `src/types/index.ts`. In route handler catch blocks, check for `error.message === "FITBIT_TIMEOUT"` and return `errorResponse("FITBIT_TIMEOUT", "Request to Fitbit timed out. Please try again.", 504)`.

**Notes:**
- `FITBIT_TIMEOUT` handling will be applied consistently across routes in Task 6 (FOO-420)
- `FITBIT_REFRESH_TRANSIENT` won't cause "reconnect your Fitbit" prompts — `ensureFreshToken` should re-throw it as-is so callers can display "Temporary error, try again" instead
- `FITBIT_TOKEN_SAVE_FAILED` should also be added to `ErrorCode` in `src/types/index.ts`

---

### Task 4: SWR error code preservation (FOO-427)

**Issues:** FOO-427
**Files:**
- `src/lib/swr.ts` (modify)
- `src/lib/__tests__/swr.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write test that `apiFetcher` preserves the error code from API responses:
   - Mock `fetch` to return `{ success: false, error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" } }`
   - Catch the thrown error and verify it has a `code` property set to `"FITBIT_TOKEN_INVALID"`
   - Run: `npm test -- swr`

2. **GREEN** — Create an `ApiError` class extending `Error` with a `code: string` property. Update `apiFetcher` to throw `new ApiError(message, code)` instead of `new Error(message)`. Export `ApiError` so components can check `error instanceof ApiError && error.code === "FITBIT_TOKEN_INVALID"`.

3. **REFACTOR** — Verify existing SWR test cases still pass. The change should be backward-compatible since `ApiError extends Error`.

**Notes:**
- Components receiving SWR errors can now do `if (error instanceof ApiError && error.code === "FITBIT_TOKEN_INVALID") { /* redirect */ }`
- This is a foundation for Task 7 (Fitbit error recovery UI) which will use the error code in components

---

### Task 5: API convention fixes (FOO-423, FOO-422, FOO-429)

**Issues:** FOO-423, FOO-422, FOO-429
**Files:**
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)
- Multiple route files for HTTP status standardization

**TDD Steps:**

1. **RED** — FOO-423: Update existing `food-history/[id]` route tests:
   - Verify GET for non-existent entry returns `{ error: { code: "NOT_FOUND" } }` with 404
   - Verify DELETE for non-existent entry returns `{ error: { code: "NOT_FOUND" } }` with 404
   - Run: `npm test -- food-history`

2. **GREEN** — FOO-423: Change `errorResponse("VALIDATION_ERROR", ...)` to `errorResponse("NOT_FOUND", ...)` for 404 responses in `food-history/[id]/route.ts` (lines 25 and ~54 for GET and DELETE).

3. **RED** — FOO-422: Update route tests to expect 502 for `FITBIT_API_ERROR`:
   - In `log-food` and `food-history` DELETE route tests, verify `FITBIT_API_ERROR` returns 502, not 500
   - Run: `npm test -- log-food`

4. **GREEN** — FOO-422: In routes that return 500 for `FITBIT_API_ERROR`, change to 502. Search for `errorResponse("FITBIT_API_ERROR"` across all route files and standardize to HTTP 502.

5. **RED** — FOO-429: Update route tests to expect consistent HTTP status for `FITBIT_CREDENTIALS_MISSING`:
   - All routes should return the same status (pick 424 Failed Dependency)
   - Run: `npm test -- log-food nutrition-goals`

6. **GREEN** — FOO-429: Standardize all `FITBIT_CREDENTIALS_MISSING` responses to HTTP 424 (Failed Dependency). Update `log-food/route.ts` (currently 400), `nutrition-goals/route.ts` (currently 404), and v1 routes.

**Notes:**
- `NOT_FOUND` already exists in the `ErrorCode` type
- HTTP 424 (Failed Dependency) semantically means "the request failed because it depends on another action" — appropriate for missing Fitbit credentials
- `FITBIT_TIMEOUT` should also be added to ErrorCode here (from Task 3)

---

### Task 6: Consistent route error handling + DB safety (FOO-420, FOO-421)

**Issues:** FOO-420, FOO-421
**Files:**
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (modify)
- `src/app/api/api-keys/route.ts` (modify)
- `src/app/api/api-keys/__tests__/route.test.ts` (modify)
- `src/app/api/api-keys/[id]/route.ts` (modify)
- `src/app/api/api-keys/[id]/__tests__/route.test.ts` (modify)
- Additional routes as identified in FOO-421

**TDD Steps:**

1. **RED** — FOO-420: Write test for `nutrition-goals` route handling `FITBIT_SCOPE_MISSING`:
   - Mock `ensureFreshToken` to throw `Error("FITBIT_SCOPE_MISSING")`
   - Verify response returns error code `FITBIT_SCOPE_MISSING` with 403 and reconnect message
   - Run: `npm test -- nutrition-goals`

2. **RED** — FOO-420: Write test for `nutrition-goals` route handling `FITBIT_RATE_LIMIT`:
   - Mock to throw `Error("FITBIT_RATE_LIMIT")`
   - Verify 429 response with rate limit message
   - Run: `npm test -- nutrition-goals`

3. **RED** — FOO-420: Write test for `nutrition-goals` route handling `FITBIT_TIMEOUT` (from Task 3):
   - Mock to throw `Error("FITBIT_TIMEOUT")`
   - Verify 504 response with timeout message
   - Run: `npm test -- nutrition-goals`

4. **GREEN** — FOO-420: Add `FITBIT_SCOPE_MISSING`, `FITBIT_RATE_LIMIT`, `FITBIT_TIMEOUT`, and `FITBIT_REFRESH_TRANSIENT` handling to ALL routes that call Fitbit APIs. Follow the pattern from `v1/activity-summary/route.ts` (lines 58-59) for SCOPE_MISSING and `log-food/route.ts` (line 417) for RATE_LIMIT. Apply to: `nutrition-goals`, `food-history/[id]` DELETE, `fasting` (if it calls Fitbit), and any others.

5. **RED** — FOO-421: Write test for `api-keys` route when DB throws:
   - Mock DB function to throw `Error("Connection refused")`
   - Verify response returns `INTERNAL_ERROR` with 500, NOT an unhandled exception
   - Run: `npm test -- api-keys`

6. **GREEN** — FOO-421: Wrap unprotected DB operations in try/catch blocks. Return `errorResponse("INTERNAL_ERROR", "...", 500)` on DB failure. Apply to all 7 route handlers identified in the issue.

**Notes:**
- The standard Fitbit error handling pattern should be:
  - `FITBIT_CREDENTIALS_MISSING` → 424
  - `FITBIT_TOKEN_INVALID` → 401
  - `FITBIT_SCOPE_MISSING` → 403
  - `FITBIT_RATE_LIMIT` → 429
  - `FITBIT_TIMEOUT` → 504
  - `FITBIT_REFRESH_TRANSIENT` → 502
  - `FITBIT_API_ERROR` → 502
  - `FITBIT_TOKEN_SAVE_FAILED` → 500

---

### Task 7: Fitbit error recovery UI (FOO-413, FOO-425, FOO-432)

**Issues:** FOO-413, FOO-425, FOO-432
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- Tests for each component (modify)

**TDD Steps:**

1. **RED** — FOO-413: Write test for FoodChat handling `FITBIT_TOKEN_INVALID` on log:
   - Mock `/api/log-food` to return `{ success: false, error: { code: "FITBIT_TOKEN_INVALID", message: "..." } }`
   - Verify the component saves pending submission data and redirects to `/api/auth/fitbit`
   - Run: `npm test -- food-chat`

2. **GREEN** — FOO-413: In `handleLog`, after checking `!response.ok || !result.success`, inspect `result.error?.code`:
   - If `FITBIT_TOKEN_INVALID`: save pending submission via `savePendingSubmission()` (include analysis + mealTypeId + date/time), then redirect to `/api/auth/fitbit`. Follow the pattern from `food-analyzer.tsx` (which already does this) and `quick-select.tsx` handleLogToFitbit (lines 206-217).
   - If `FITBIT_CREDENTIALS_MISSING`: show specific error message with Settings guidance

3. **RED** — FOO-425: Write test for FoodHistory showing reconnect action on token error:
   - Mock DELETE to return `FITBIT_TOKEN_INVALID`
   - Verify a "Reconnect Fitbit" button or link to Settings appears
   - Run: `npm test -- food-history`

4. **GREEN** — FOO-425: In `handleDeleteConfirm`, inspect `result.error?.code`. If `FITBIT_TOKEN_INVALID`, show the error message plus a "Reconnect" button that redirects to `/api/auth/fitbit` (or a link to Settings). Use the existing `deleteError` state but render a button alongside the error text when the code indicates a recoverable auth issue.

5. **RED** — FOO-432: Write test for pending resubmit inspecting error codes:
   - Mock `/api/log-food` resubmit to return `FITBIT_TOKEN_INVALID`
   - Verify the component redirects to re-auth (save pending again, redirect to `/api/auth/fitbit`)
   - Run: `npm test -- quick-select`

6. **GREEN** — FOO-432: In the pending resubmit `.then()` handler (lines 150-156), check `result.error?.code`:
   - `FITBIT_TOKEN_INVALID`: re-save the pending submission and redirect to `/api/auth/fitbit`
   - `FITBIT_CREDENTIALS_MISSING`: show "configure credentials in Settings" error with link

**Notes:**
- The reconnect-via-redirect pattern already exists in `food-analyzer.tsx` handleLogToFitbit (lines 228-248) and `quick-select.tsx` handleLogToFitbit (lines 206-217) — follow those patterns
- Pending submission is managed by `src/lib/pending-submission.ts` (savePendingSubmission, getPendingSubmission, clearPendingSubmission)

---

### Task 8: Server-side timezone fixes (FOO-411, FOO-410, FOO-403)

**Issues:** FOO-411, FOO-410, FOO-403
**Files:**
- `src/app/api/fasting/route.ts` (modify)
- `src/app/api/fasting/__tests__/route.test.ts` (modify)
- `src/app/api/common-foods/route.ts` (modify)
- `src/app/api/common-foods/__tests__/route.test.ts` (modify)
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)
- Client components that call these APIs (modify to pass date/time)

**TDD Steps:**

1. **RED** — FOO-411: Write test for fasting API accepting client-provided `clientDate` query param:
   - Send request with `?date=2026-02-14&clientDate=2026-02-14`
   - Verify the `isToday` check uses `clientDate` instead of server's `getTodayDate()`
   - Run: `npm test -- fasting`

2. **GREEN** — FOO-411: Accept optional `clientDate` query parameter in the fasting route. Use it instead of `isToday(date)` for the live mode check: `const liveCheck = clientDate ? date === clientDate : isToday(date)`. Update the client-side `FastingCard` component to pass `clientDate` via `getTodayDate()` (runs client-side in browser, so it returns local date).

3. **RED** — FOO-410: Write test for common-foods API accepting client-provided time:
   - Send request with `?clientTime=14:30:00&clientDate=2026-02-14`
   - Verify the ranking function receives the client time/date, not server time
   - Run: `npm test -- common-foods`

4. **GREEN** — FOO-410: Accept optional `clientTime` and `clientDate` query parameters. If provided, use them instead of `new Date()` for ranking. Update `QuickSelect` component to pass these params from `getLocalDateTime()`.

5. **RED** — FOO-403: Write test for nutrition-goals using client date for calorie goal capture:
   - Send request with `X-Client-Date: 2026-02-14` header (or query param)
   - Verify `upsertCalorieGoal` is called with the client date, not server date
   - Run: `npm test -- nutrition-goals`

6. **GREEN** — FOO-403: Accept `clientDate` query parameter (or header) in nutrition-goals route. Pass to `upsertCalorieGoal` instead of `getTodayDate()`. Update `DailyDashboard` SWR URL to include client date.

**Notes:**
- Client components already have access to local date/time via `getTodayDate()` (client-side) and `getLocalDateTime()` from `src/lib/meal-type.ts`
- The approach is: client SENDS its local date/time, server TRUSTS it (single-user app behind auth — no spoofing risk)
- Server still validates that the date format is valid, just doesn't generate it
- **Migration note:** No data migration needed. This only changes runtime behavior for future requests.

---

### Task 9: Quick select & analyzer UX fixes (FOO-431, FOO-433, FOO-434, FOO-416, FOO-417)

**Issues:** FOO-431, FOO-433, FOO-434, FOO-416, FOO-417
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)
- `src/app/app/quick-select/loading.tsx` (modify)
- `src/app/app/quick-select/__tests__/loading.test.tsx` (modify)
- `src/app/api/find-matches/route.ts` (modify)
- `src/app/api/find-matches/__tests__/route.test.ts` (modify)
- `src/components/food-analyzer.tsx` (modify — pass converted blobs)
- `src/components/photo-capture.tsx` (modify — expose converted blobs)

**TDD Steps:**

1. **RED** — FOO-431: Write test that success haptic does NOT fire before API confirmation:
   - Click log button
   - Verify `vibrateSuccess` is NOT called during the loading state
   - After API responds successfully, verify `vibrateSuccess` IS called
   - Run: `npm test -- quick-select`

2. **GREEN** — FOO-431: Remove the optimistic `setLogResponse(optimisticResponse)` on line 190. Instead, show a loading spinner during the API call (use the existing `logging` state). Only call `setLogResponse(result.data)` after the API succeeds (line 231). This matches how `FoodChat.handleLog` works — it doesn't optimistically set the response.

3. **RED** — FOO-433: Write test that `foodToAnalysis` includes Tier 1 nutrients:
   - Create a `CommonFood` with `saturatedFatG`, `transFatG`, `sugarsG`, `caloriesFromFat`
   - Verify `foodToAnalysis()` output includes `saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`
   - Run: `npm test -- quick-select`

4. **GREEN** — FOO-433: Add the four missing fields to the `foodToAnalysis` function: `saturated_fat_g: food.saturatedFatG ?? undefined`, `trans_fat_g: food.transFatG ?? undefined`, `sugars_g: food.sugarsG ?? undefined`, `calories_from_fat: food.caloriesFromFat ?? undefined`.

5. **RED** — FOO-434: Write test that loading skeleton includes tab bar and search input skeletons:
   - Render the loading component
   - Verify skeleton for tabs (two pill shapes) and search input are present
   - Run: `npm test -- quick-select/loading`

6. **GREEN** — FOO-434: Update `src/app/app/quick-select/loading.tsx` to include skeleton placeholders for:
   - Tab bar (two rounded pill skeletons side by side, matching the `flex gap-1 p-1 bg-muted rounded-full` pattern)
   - Search input (one full-width skeleton, height matching the search input)

7. **RED** — FOO-416: Write test for find-matches accepting empty keywords:
   - Send `{ keywords: [], food_name: "test", ... }` to the route
   - Verify response returns `{ success: true, data: { matches: [] } }` instead of 400
   - Run: `npm test -- find-matches`

8. **GREEN** — FOO-416: Remove the `keywords.length === 0` check from the validation (lines 23-24). If keywords is an empty array, `findMatchingFoods` should handle it gracefully (return empty matches). Check if `findMatchingFoods` needs updating too — if it requires non-empty keywords, add a short-circuit that returns `[]` immediately.

9. **RED** — FOO-417: Write test that HEIC file is only converted once during the full flow:
   - This is a component-level behavior test
   - Mock `convertHeicToJpeg` and track call count
   - Process a HEIC file through capture → compress → analyze
   - Verify `convertHeicToJpeg` is called exactly once, not twice
   - Run: `npm test -- food-analyzer`

10. **GREEN** — FOO-417: The fix is to pass the already-converted preview blobs from `PhotoCapture` to `FoodAnalyzer` instead of the original `File` objects. `PhotoCapture` already converts HEIC for preview — expose those converted blobs via the `onPhotosChange` callback (alongside the original Files for display). In `FoodAnalyzer`, if converted blobs are available, pass them to `compressImage` instead of the original Files. `compressImage` will skip HEIC conversion since the blob is already JPEG.

**Notes:**
- FOO-431 "optimistic success" removal: the loading state should show a spinner on the log button (using existing `logging` state), similar to how the analyze button shows a spinner during analysis
- FOO-417 is the most complex change — it touches the PhotoCapture→FoodAnalyzer interface

---

### Task 10: Dashboard UX improvements (FOO-399, FOO-400, FOO-401, FOO-402, FOO-405, FOO-406, FOO-407, FOO-408, FOO-409)

**Issues:** FOO-399, FOO-400, FOO-401, FOO-402, FOO-405, FOO-406, FOO-407, FOO-408, FOO-409
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/weekly-dashboard.tsx` (modify)
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/__tests__/dashboard-shell.test.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)
- `src/components/week-navigator.tsx` (modify)
- `src/components/fasting-card.tsx` (modify)
- `src/components/__tests__/fasting-card.test.tsx` (modify)
- `src/components/meal-breakdown.tsx` (modify)
- `src/components/__tests__/meal-breakdown.test.tsx` (modify)

**TDD Steps:**

1. **RED** — FOO-399: Write test that DailyDashboard error state includes a retry button:
   - Mock SWR to return an error for nutrition-summary
   - Verify a "Retry" button is rendered in the error state
   - Verify clicking it calls `mutate()` to revalidate
   - Run: `npm test -- daily-dashboard`

2. **GREEN** — FOO-399: In DailyDashboard's error state (lines 153-161), add a "Retry" Button that calls the SWR `mutate` function. Same pattern for WeeklyDashboard's error states (lines 78-96).

3. **RED** — FOO-400: Write test that WeeklyDashboard resets to current week on visibility change:
   - Set week to a past week
   - Simulate `visibilitychange` event (hidden then visible)
   - Verify `weekStart` resets to current week
   - Run: `npm test -- weekly-dashboard`

4. **GREEN** — FOO-400: Add a `useEffect` with `visibilitychange` listener to WeeklyDashboard, mirroring the pattern in DailyDashboard (lines 57-84). On tab re-focus, if the date changed or idle > 1hr, reset `weekStart` to the current week's start.

5. **RED** — FOO-401: Write test that visibility change only revalidates dashboard-related SWR keys:
   - Verify that `mutate` is called with a filter matching dashboard keys (nutrition-summary, nutrition-goals, fasting, lumen-goals), NOT a blanket `() => true`
   - Run: `npm test -- daily-dashboard`

6. **GREEN** — FOO-401: Replace `globalMutate(() => true)` with targeted mutations. Either call `mutate` on each specific SWR key used by the dashboard, or use `globalMutate((key) => typeof key === "string" && (key.includes("/api/nutrition-summary") || key.includes("/api/nutrition-goals") || key.includes("/api/fasting") || key.includes("/api/lumen-goals") || key.includes("/api/earliest-entry")))`.

7. **GREEN** — FOO-402: Add ARIA attributes to the segmented controls in `dashboard-shell.tsx`:
   - Wrap buttons in `<div role="tablist">`
   - Add `role="tab"`, `aria-selected={view === "daily"}` to each button
   - Do the same for the metric selector in `weekly-nutrition-chart.tsx`

8. **GREEN** — FOO-405: In `weekly-nutrition-chart.tsx` line 131, change the empty-day check to use the selected metric instead of always calories: `const isEmpty = day.data === null || value === 0` (where `value` is already computed on line 132 via `getMetricData`).

9. **GREEN** — FOO-406: Add `earliestDate` support to `WeekNavigator`. Fetch `/api/earliest-entry` in `WeeklyDashboard` (or pass as prop) and disable the previous button when the current week contains or is before the earliest date.

10. **GREEN** — FOO-407: In `calculateLiveDuration` (fasting-card.tsx lines 26-31), clamp the return value to a minimum of 0: `return Math.max(0, Math.floor(diffMs / 60000))`.

11. **GREEN** — FOO-408: In MealBreakdown, wrap each food entry `<div>` (lines 84-100) with a `<Link href={/app/food-detail/${entry.id}}>` component. Import `Link` from `next/link`. Add `hover:bg-muted/50 transition-colors cursor-pointer` styles.

12. **GREEN** — FOO-409: Decouple summary and goals loading in DailyDashboard. Remove `goalsLoading` from line 148's skeleton condition. Render the calorie ring section with a fallback (plain number display) when goals haven't loaded yet, and show the goal ring when goals arrive. The summary data should display immediately.

**Notes:**
- For FOO-406, `WeeklyDashboard` can fetch `/api/earliest-entry` (same endpoint `DailyDashboard` uses) and pass `earliestDate` to `WeekNavigator`
- For FOO-409, the pattern is: render everything with summary data immediately, use inline loading indicators only for goals
- For FOO-408, `entry.id` is the food_log_entries primary key, which matches the `[id]` param in `/app/food-detail/[id]`

---

### Task 11: Feature additions (FOO-418)

**Issues:** FOO-418
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write test for "Log Another" button in FoodLogConfirmation:
   - Render FoodLogConfirmation with a response
   - Verify a "Log Another" button is visible alongside "Done"
   - Verify clicking "Log Another" navigates to `/app/analyze`
   - Run: `npm test -- food-log-confirmation`

2. **GREEN** — Add a "Log Another" button next to the existing "Done" button in the `flex gap-3` container (line 84). Use `variant="default"` for "Log Another" (primary action) and keep `variant="outline"` for "Done". The "Log Another" button should navigate to `/app/analyze` (for the main photo analysis flow). Apply `min-h-[44px] min-w-[120px]` for touch target compliance.

**Notes:**
- The button navigates to `/app/analyze` where users can take another photo
- Consider whether to also add this to the QuickSelect success screen — both use `FoodLogConfirmation`, so the button will appear in both contexts

---

### Task 12: v1 API rate limiting (FOO-424)

**Issues:** FOO-424
**Files:**
- `src/app/api/v1/food-log/route.ts` (modify)
- `src/app/api/v1/food-log/__tests__/route.test.ts` (modify)
- `src/app/api/v1/nutrition-summary/route.ts` (modify)
- `src/app/api/v1/nutrition-summary/__tests__/route.test.ts` (modify)
- `src/app/api/v1/nutrition-goals/route.ts` (modify)
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` (modify)
- `src/app/api/v1/activity-summary/route.ts` (modify)
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` (modify)
- `src/app/api/v1/lumen-goals/route.ts` (modify)
- `src/app/api/v1/lumen-goals/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write test for v1 food-log route rejecting requests after rate limit exceeded:
   - Call the route `maxRequests + 1` times
   - Verify the last call returns 429 with error code `"RATE_LIMIT_EXCEEDED"`
   - Run: `npm test -- v1/food-log`

2. **GREEN** — Add `checkRateLimit` from `src/lib/rate-limit.ts` to all 5 v1 routes. Use the API key (from `validateApiRequest`) as the rate limit key. Apply reasonable limits:
   - Routes calling external APIs (Fitbit): 30 requests/minute
   - DB-only routes: 60 requests/minute
   - Follow the pattern from `analyze-food/route.ts` or `chat-food/route.ts` (which already use `checkRateLimit`)

3. **REFACTOR** — Add `RATE_LIMIT_EXCEEDED` to `ErrorCode` in `src/types/index.ts` if not already present.

**Notes:**
- `checkRateLimit` already exists in `src/lib/rate-limit.ts` and is used by browser routes
- Use the API key value as the rate limit key so different API keys get independent limits
- Browser routes use IP-based rate limiting; v1 routes should use API-key-based

---

### Task 13: Integration & Verification

**Issues:** All
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] FoodAnalyzer: logging button disables during API call
   - [ ] FoodAnalyzer: clearing photos during analysis doesn't show stale results
   - [ ] QuickSelect: success screen shows all Tier 1 nutrients
   - [ ] QuickSelect: no premature haptic/success before API responds
   - [ ] FoodChat: FITBIT_TOKEN_INVALID during log triggers reconnect flow
   - [ ] FoodHistory: delete token error shows reconnect option
   - [ ] Dashboard: error states have retry buttons
   - [ ] Dashboard: visibility change only revalidates dashboard keys
   - [ ] Weekly view: resets to current week on tab re-focus
   - [ ] Meal entries: tappable, navigate to food detail

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Fitbit token refresh fails (transient) | Show "temporary error, try again" instead of "reconnect" | Unit test (Task 3) |
| Fitbit token refresh fails (permanent) | Show "reconnect your Fitbit" with redirect | Unit test (Task 3) |
| DB upsert fails after token refresh | Retry once, return new access token | Unit test (Task 3) |
| SWR fetch returns error with code | Error code preserved in thrown ApiError | Unit test (Task 4) |
| Photos cleared during analysis | In-flight fetch aborted, no stale state | Unit test (Task 2) |
| Empty keywords from Claude analysis | find-matches returns empty matches (not 400) | Unit test (Task 9) |
| v1 API rate limit exceeded | 429 response with RATE_LIMIT_EXCEEDED | Unit test (Task 12) |

## Risks & Open Questions

- [ ] FOO-417 (HEIC double conversion): Changing the PhotoCapture→FoodAnalyzer interface requires careful testing on actual HEIC files. May need to verify on iOS device.
- [ ] FOO-408 (MealBreakdown links): Need to confirm `entry.id` matches the food_log_entries primary key used by `/app/food-detail/[id]` page.
- [ ] FOO-410/411/403 (timezone): Client sends date/time as query params — need to validate format server-side to prevent malformed dates.
- [ ] FOO-424 (v1 rate limits): Rate limit values (30/60 req/min) are estimates. May need tuning based on actual usage patterns.

## Scope Boundaries

**In Scope:**
- All 36 issues listed above
- Required test coverage for each fix
- ErrorCode type updates in `src/types/index.ts`

**Out of Scope:**
- New features beyond what the issues request
- Refactoring code not directly affected by the issues
- Database schema changes (none needed)
- Deployment or environment changes
