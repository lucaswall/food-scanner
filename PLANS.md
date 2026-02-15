# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-497-swr-data-freshness
**Issues:** FOO-497, FOO-503, FOO-498, FOO-499, FOO-502, FOO-501
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Fix a family of SWR data-freshness and error-handling bugs in the QuickSelect, Dashboard, and app-wide components. The issues cover: infinite scroll list resets from an unstable SWR key (FOO-503), no global handler for expired sessions (FOO-497), stale data after food mutations (FOO-498), the Recent tab never revalidating (FOO-499), a wasted prefetch HTTP request (FOO-502), and pending food submissions being silently lost after Fitbit re-auth (FOO-501).

## Issues

### FOO-497: No global 401 handler for expired sessions

**Priority:** High
**Labels:** Bug
**Description:** When a user's session expires (30-day cookie still present but DB session deleted), the middleware passes the request (cookie check only), but all API calls return 401 with `AUTH_MISSING_SESSION`. No global handler catches this — the user sees broken/empty states everywhere with no redirect to login.

**Acceptance Criteria:**
- [ ] Global error handler detects `AUTH_MISSING_SESSION` error code from SWR API responses
- [ ] When detected, redirect to `/` (landing page)
- [ ] Does not interfere with OAuth redirect flows (those happen outside `/app` layout)

### FOO-503: QuickSelect infinite scroll jumps — list resets during pagination

**Priority:** High
**Labels:** Bug
**Description:** `getLocalDateTime()` returns `HH:mm:ss` with seconds. This is called in the QuickSelect component body on every render and embedded in the `useSWRInfinite` key via `useCallback` deps. Every re-render that crosses a second boundary creates a new SWR key, discarding all loaded pages. The sentinel div also causes layout shifts.

**Acceptance Criteria:**
- [ ] SWR key is stable during the component's lifetime (compute `clientTime`/`clientDate` once on mount)
- [ ] `keepPreviousData: true` on `useSWRInfinite` so key changes show old data while loading
- [ ] Sentinel div has fixed minimum height so spinner doesn't cause layout shifts
- [ ] Smooth scrolling through 30+ items with no visible jumps

### FOO-498: No SWR cache invalidation after food mutations

**Priority:** Medium
**Labels:** Improvement
**Description:** After logging or deleting food, no code invalidates SWR caches for related endpoints. The user sees stale calorie totals, stale food history, and stale common-foods lists until SWR's background revalidation catches up (visible "jump").

**Acceptance Criteria:**
- [ ] After successful food log (both analyze and quick-select flows), invalidate nutrition-summary, food-history, common-foods, fasting, and earliest-entry SWR caches
- [ ] After successful food delete in history, also invalidate nutrition-summary and fasting caches
- [ ] Use SWR's `mutate` with a key matcher function for clean invalidation

### FOO-499: QuickSelect "Recent" tab never auto-revalidates on revisit

**Priority:** Medium
**Labels:** Bug
**Description:** `useSWRInfinite` with `revalidateFirstPage: false` + `revalidateOnFocus: false` + a stable Recent tab key means the first page NEVER auto-revalidates. Newly logged foods don't appear when navigating back to quick-select.

**Acceptance Criteria:**
- [ ] Recent tab shows newly logged foods when user navigates back to quick-select
- [ ] Infinite scroll still works correctly
- [ ] No loading flash during revalidation (leverages `keepPreviousData` from FOO-503)

### FOO-502: DashboardPrefetch preloads wrong common-foods key

**Priority:** Low
**Labels:** Performance
**Description:** `DashboardPrefetch` calls `preload("/api/common-foods", apiFetcher)` but no component uses that exact SWR key. QuickSelect uses parameterized keys. The preloaded data is cached but never consumed — one wasted HTTP request per `/app` page load.

**Acceptance Criteria:**
- [ ] Prefetch key matches an actual SWR key used by QuickSelect
- [ ] Or remove the common-foods prefetch if no stable key exists

### FOO-501: Pending food submission only checked in QuickSelect

**Priority:** Medium
**Labels:** Improvement
**Description:** When Fitbit token expires during food logging, the app saves a pending submission to `sessionStorage` and redirects to OAuth. After OAuth, the callback redirects to `/app` (dashboard). The pending submission is only checked in QuickSelect's `useEffect` — if the user doesn't navigate to quick-select, the food log is silently lost.

**Acceptance Criteria:**
- [ ] Check for pending submissions at the app layout level (not just QuickSelect)
- [ ] Show a visible indicator (toast or banner) when a pending submission exists
- [ ] Auto-resubmit and show success/failure feedback
- [ ] Remove duplicate pending submission logic from QuickSelect

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] No active PLANS.md (previous plan is COMPLETE)

## Implementation Tasks

### Task 1: Global SWR Error Provider (FOO-497)

**Issue:** FOO-497
**Files:**
- `src/components/swr-provider.tsx` (create)
- `src/components/__tests__/swr-provider.test.tsx` (create)
- `src/app/app/layout.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the new `SWRProvider` component:
   - Test that it renders children normally
   - Test that when an SWR hook throws an `ApiError` with code `AUTH_MISSING_SESSION`, `window.location.href` is set to `"/"`
   - Test that errors with other codes (e.g., `FITBIT_TOKEN_INVALID`) do NOT trigger a redirect
   - Test that non-`ApiError` errors do NOT trigger a redirect
   - Run: `npm test -- swr-provider`
   - Verify: Tests fail (module not found)

2. **GREEN** — Create `src/components/swr-provider.tsx`:
   - A `"use client"` component that wraps children in `<SWRConfig>` with an `onError` callback
   - The callback checks if the error is an `ApiError` with code `AUTH_MISSING_SESSION`
   - If so, redirect via `window.location.href = "/"`
   - Pattern reference: `src/components/app-refresh-guard.tsx` (client wrapper in app layout)
   - Pattern reference: `src/lib/swr.ts` for `ApiError` class
   - Run: `npm test -- swr-provider`
   - Verify: Tests pass

3. **REFACTOR** — Integrate into app layout:
   - Wrap the app layout children in `SWRProvider` in `src/app/app/layout.tsx`
   - The provider should wrap inside `AppRefreshGuard` (or alongside it)
   - No test needed for integration — E2E covers this

**Notes:**
- The `SWRConfig` `onError` fires for any SWR hook error within its subtree
- OAuth flows happen at `/api/auth/*` which is outside the `/app` layout, so no interference
- Use `window.location.href` (not `router.push`) to force a full page reload that clears client state
- The `ApiError` class is already exported from `src/lib/swr.ts`

---

### Task 2: Stabilize QuickSelect SWR Key (FOO-503)

**Issue:** FOO-503
**Files:**
- `src/lib/meal-type.ts` (modify)
- `src/lib/__tests__/meal-type.test.ts` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update `getLocalDateTime` tests to expect `HH:mm` format (no seconds):
   - Change the test assertion from `"14:30:45"` to `"14:30"`, etc.
   - Add a test that verifies seconds are NOT included in the time string
   - Run: `npm test -- meal-type`
   - Verify: Tests fail (still returns `HH:mm:ss`)

2. **GREEN** — Modify `getLocalDateTime()` in `src/lib/meal-type.ts`:
   - Remove the seconds component from the returned time string
   - Return format: `HH:mm` instead of `HH:mm:ss`
   - Run: `npm test -- meal-type`
   - Verify: Tests pass

3. **RED** — Add QuickSelect tests for key stability:
   - Test that the SWR key remains the same across re-renders within the same component lifetime (verify `clientTime` is captured once, not recalculated)
   - Test that the sentinel div always has a minimum height (e.g., `min-h-[48px]`) regardless of loading state
   - Update the mock for `getLocalDateTime` in the test file — it already returns `"14:30:00"`, change to `"14:30"`
   - Run: `npm test -- quick-select`
   - Verify: New tests fail

4. **GREEN** — Modify `src/components/quick-select.tsx`:
   - Replace the `getLocalDateTime()` call in the component body with a `useState` initializer: `const [{ time: clientTime, date: clientDate }] = useState(getLocalDateTime)` — this captures the value once on mount and never recalculates
   - Add `keepPreviousData: true` to the `useSWRInfinite` options object
   - Change the sentinel div to always have a fixed minimum height class (e.g., `min-h-[48px]`) instead of conditionally rendering the spinner inside it
   - Run: `npm test -- quick-select`
   - Verify: Tests pass

**Notes:**
- `useState(getLocalDateTime)` (passing a function, not calling it) is the React lazy initializer pattern — it runs once on mount
- The `handleLogToFitbit` function at line 223 also calls `getLocalDateTime()` — that call is CORRECT (it should get the current time at the moment of logging, not mount time). Do not change it.
- The pending resubmission `useEffect` at line 139-141 also calls `getLocalDateTime()` as a fallback — that's also correct (current time at resubmit). Do not change it.
- The `keepPreviousData` option was added in SWR 2.x — verify the project's SWR version supports it
- Existing test mock returns `"14:30:00"` — update to `"14:30"` to match the new format
- The `time` field sent to the API in the request body will now be `HH:mm` instead of `HH:mm:ss`. Verify `parseTimeToMinutes()` in `src/lib/food-log.ts:108-111` handles both formats (it splits on `:` and uses `parts[0]` and `parts[1]`, so `HH:mm` works fine — seconds were always ignored).

---

### Task 3: SWR Cache Invalidation After Food Mutations (FOO-498)

**Issue:** FOO-498
**Files:**
- `src/lib/swr.ts` (modify)
- `src/lib/__tests__/swr.test.ts` (modify)
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests for a new `invalidateFoodCaches()` function in `src/lib/__tests__/swr.test.ts`:
   - Test that calling `invalidateFoodCaches()` calls SWR's `mutate` with a matcher function
   - Test that the matcher function matches keys containing `/api/nutrition-summary`, `/api/food-history`, `/api/common-foods`, `/api/fasting`, `/api/earliest-entry`
   - Test that it does NOT match unrelated keys like `/api/settings`
   - Run: `npm test -- swr`
   - Verify: Tests fail (function doesn't exist)

2. **GREEN** — Add `invalidateFoodCaches()` to `src/lib/swr.ts`:
   - Import `mutate` from `swr` (the global `mutate` function)
   - Define a list of food-related key prefixes: `/api/nutrition-summary`, `/api/food-history`, `/api/common-foods`, `/api/fasting`, `/api/earliest-entry`
   - Call `mutate(key => typeof key === 'string' && prefixes.some(p => key.startsWith(p)))` to revalidate all matching caches
   - Export the function
   - Run: `npm test -- swr`
   - Verify: Tests pass

3. **RED** — Add tests for FoodLogConfirmation calling `invalidateFoodCaches`:
   - Test that `invalidateFoodCaches()` is called when the component mounts with a valid response
   - Run: `npm test -- food-log-confirmation`
   - Verify: Test fails

4. **GREEN** — Modify `src/components/food-log-confirmation.tsx`:
   - Import `invalidateFoodCaches` from `@/lib/swr`
   - Call it in the existing `useEffect` (alongside `vibrateSuccess()`) when `response` is truthy
   - Run: `npm test -- food-log-confirmation`
   - Verify: Tests pass

5. **RED** — Add tests for FoodHistory calling `invalidateFoodCaches` after delete:
   - Test that after a successful delete, `invalidateFoodCaches()` is called (in addition to the existing `mutate()`)
   - Run: `npm test -- food-history`
   - Verify: Test fails

6. **GREEN** — Modify `src/components/food-history.tsx`:
   - Import `invalidateFoodCaches` from `@/lib/swr`
   - Call it in `handleDeleteConfirm` after the existing `mutate()` call on line 193
   - Run: `npm test -- food-history`
   - Verify: Tests pass

**Notes:**
- SWR's global `mutate` with a key matcher function revalidates all matching caches without clearing them (shows stale data while refetching)
- The `mutate` import from `swr` is the global version, different from the per-hook `mutate` returned by `useSWR`
- FoodLogConfirmation is used by BOTH the analyze flow and the quick-select flow, so invalidation in its `useEffect` covers both code paths
- The existing `mutate()` call in food-history.tsx:193 only invalidates the food-history SWR key — `invalidateFoodCaches()` covers the rest

---

### Task 4: Recent Tab Revalidation on Revisit (FOO-499)

**Issue:** FOO-499
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test that verifies the Recent tab revalidates on revisit:
   - Render QuickSelect, load data for the Suggested tab
   - Switch to Recent tab, load data
   - Switch back to Suggested, then back to Recent again
   - Verify that a new fetch is triggered for the Recent tab on the second visit (revalidation)
   - Run: `npm test -- quick-select`
   - Verify: Test fails (no revalidation happens)

2. **GREEN** — Modify the `useSWRInfinite` config in QuickSelect:
   - Change `revalidateFirstPage: false` to `revalidateFirstPage: true`
   - This is now safe because Task 2 added `keepPreviousData: true`, which prevents loading flashes during revalidation — old data shows while the new data loads
   - The `revalidateOnFocus: false` remains unchanged (we don't want revalidation on every window focus event)
   - Run: `npm test -- quick-select`
   - Verify: Tests pass

3. **REFACTOR** — Verify existing tests still pass:
   - The "does not revalidate when window regains focus" test should still pass (we only changed `revalidateFirstPage`, not `revalidateOnFocus`)
   - Run full: `npm test -- quick-select`
   - Verify: All tests pass

**Notes:**
- With `revalidateFirstPage: true`, SWR will revalidate the first page when the key changes (tab switch) or when the component remounts. Combined with `keepPreviousData: true` from Task 2, the old data remains visible during revalidation — no loading flash.
- This also benefits the Suggested tab — if the user revisits after a while, the suggested foods will be refreshed in the background.
- The infinite scroll "load more" behavior is unaffected — `revalidateFirstPage` only affects the first page's revalidation behavior, not subsequent pages.

---

### Task 5: Fix Dashboard Prefetch Key (FOO-502)

**Issue:** FOO-502
**Files:**
- `src/components/dashboard-prefetch.tsx` (modify)
- `src/components/__tests__/dashboard-prefetch.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update the prefetch test to expect the correct key:
   - Change the test assertion from `"/api/common-foods"` to `"/api/common-foods?tab=recent&limit=10"`
   - Run: `npm test -- dashboard-prefetch`
   - Verify: Test fails (still preloads the old key)

2. **GREEN** — Modify `src/components/dashboard-prefetch.tsx`:
   - Change the preload call from `preload("/api/common-foods", apiFetcher)` to `preload("/api/common-foods?tab=recent&limit=10", apiFetcher)`
   - This matches QuickSelect's Recent tab SWR key exactly, so the prefetched data will be consumed when the user navigates to quick-select
   - Run: `npm test -- dashboard-prefetch`
   - Verify: Tests pass

**Notes:**
- The Recent tab key is stable (`/api/common-foods?tab=recent&limit=10`) — it doesn't include time parameters, making it a good prefetch target
- The Suggested tab key includes `clientTime` and `clientDate` which are different per mount, so it can't be prefetched from the dashboard
- The food-history prefetch (`/api/food-history?limit=20`) is already correct and unchanged

---

### Task 6: Pending Submission Handler at App Level (FOO-501)

**Issue:** FOO-501
**Files:**
- `src/components/pending-submission-handler.tsx` (create)
- `src/components/__tests__/pending-submission-handler.test.tsx` (create)
- `src/app/app/layout.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the new `PendingSubmissionHandler` component:
   - Test that it renders nothing when no pending submission exists
   - Test that when a pending submission exists, it auto-resubmits to `/api/log-food`
   - Test that on successful resubmission, it clears the pending submission and shows a success toast/banner
   - Test that on `FITBIT_TOKEN_INVALID` error, it re-saves the pending and redirects to `/api/auth/fitbit`
   - Test that on `FITBIT_CREDENTIALS_MISSING` error, it clears pending and shows a credentials error message
   - Test that on generic error, it clears pending and shows an error message
   - Pattern reference: the existing QuickSelect pending resubmission tests (lines 569-674 in `quick-select.test.tsx`)
   - Run: `npm test -- pending-submission-handler`
   - Verify: Tests fail (module not found)

2. **GREEN** — Create `src/components/pending-submission-handler.tsx`:
   - A `"use client"` component that checks `getPendingSubmission()` in a `useEffect` on mount
   - If a pending submission exists: show a visible banner with "Reconnected! Resubmitting [foodName]..." text
   - Resubmit to `/api/log-food` with the same body-building logic as QuickSelect lines 139-159
   - Handle success: clear pending, show "Successfully resubmitted [foodName]" for ~3 seconds, then hide
   - Handle `FITBIT_TOKEN_INVALID`: re-save pending, redirect to `/api/auth/fitbit`
   - Handle `FITBIT_CREDENTIALS_MISSING`/`FITBIT_NOT_CONNECTED`: clear pending, show credentials error
   - Handle generic error: clear pending, show error message
   - Call `invalidateFoodCaches()` after successful resubmission (from Task 3)
   - Pattern reference: `src/components/fitbit-status-banner.tsx` for banner UI patterns
   - Run: `npm test -- pending-submission-handler`
   - Verify: Tests pass

3. **REFACTOR** — Integrate into app layout:
   - Add `<PendingSubmissionHandler />` to `src/app/app/layout.tsx` alongside the existing components
   - Place it before `{children}` so the banner appears at the top of the app

4. **RED** — Update QuickSelect tests to verify the pending logic is removed:
   - Remove all pending resubmission tests from `quick-select.test.tsx` (the "pending resubmit" describe blocks)
   - Add a test that verifies QuickSelect does NOT check `getPendingSubmission()` on mount
   - Run: `npm test -- quick-select`
   - Verify: Tests fail (QuickSelect still calls `getPendingSubmission`)

5. **GREEN** — Remove pending submission logic from QuickSelect:
   - Remove the `useEffect` at lines 130-197 that handles pending resubmission
   - Remove the `resubmitting`/`resubmitFoodName` state variables and their UI
   - Remove the imports of `getPendingSubmission`/`clearPendingSubmission` (keep `savePendingSubmission` — it's still used for new token expiry saves)
   - Run: `npm test -- quick-select`
   - Verify: All tests pass

**Notes:**
- The `PendingSubmissionHandler` lives in the app layout, so it runs on every `/app/*` page load — no matter where the user lands after OAuth re-auth
- The banner should auto-dismiss after a few seconds on success (use `setTimeout` to clear the state)
- The `savePendingSubmission` call in QuickSelect's `handleLogToFitbit` (line 232-238) and in the analyze flow must remain — those SAVE the pending submission on token expiry. We're only moving the RECOVERY logic.
- The `FoodLogConfirmation` component is not affected — it handles the success UI after a normal (non-pending) log

---

### Task 7: Integration & Verification

**Issue:** FOO-497, FOO-503, FOO-498, FOO-499, FOO-502, FOO-501
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Navigate to `/app` — no wasted prefetch requests in Network tab
   - [ ] Open QuickSelect Suggested tab — scroll through 30+ items without list resets
   - [ ] Switch between Suggested and Recent tabs — no loading flashes
   - [ ] Log a food, navigate to dashboard — calorie total updates immediately (no stale data jump)
   - [ ] Delete a food in history — dashboard calorie total updates immediately
   - [ ] (If testable) Expire session — see redirect to landing page

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Session expired (401) | Global redirect to `/` | Unit test (Task 1) |
| Pending resubmit fails with token invalid | Re-save pending, redirect to OAuth | Unit test (Task 6) |
| Pending resubmit fails with credentials missing | Clear pending, show error | Unit test (Task 6) |
| SWR key changes mid-scroll | Old data stays visible (keepPreviousData) | Unit test (Task 2) |
| Cache invalidation after mutation | All food-related caches revalidate | Unit test (Task 3) |

## Risks & Open Questions

- [ ] SWR version compatibility: Verify `keepPreviousData` is supported by the installed SWR version (requires SWR 2.x+)
- [ ] `getLocalDateTime()` format change from `HH:mm:ss` to `HH:mm`: The time value is sent in API request bodies to `/api/log-food`. Verify `parseTimeToMinutes()` handles `HH:mm` (it does — only uses `parts[0]` and `parts[1]`). Also verify any other consumers of `getLocalDateTime().time` are unaffected.
- [ ] The `invalidateFoodCaches()` function uses SWR's global `mutate` with a key matcher. Verify this works correctly with `useSWRInfinite` keys (which are arrays internally but string-based in the key function).

## Scope Boundaries

**In Scope:**
- Global 401 handler for expired sessions
- SWR key stabilization for QuickSelect
- Cache invalidation after food mutations
- Recent tab revalidation on revisit
- Dashboard prefetch key fix
- Pending submission handler at app layout level

**Out of Scope:**
- FOO-500 (Canceled — duplicate of FOO-503, same root cause)
- Service worker for offline support
- Optimistic updates for food mutations (invalidation-based approach is simpler and sufficient)
- Custom retry logic for failed API calls
- Session expiry prevention or auto-refresh

---

## Iteration 1

**Implemented:** 2026-02-15
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Global SWR Error Provider (FOO-497) - Created SWRProvider with onError handler that redirects to / on AUTH_MISSING_SESSION (worker-1)
- Task 2: Stabilize QuickSelect SWR Key (FOO-503) - Changed getLocalDateTime to HH:mm, used useState initializer for stable key, added keepPreviousData:true, fixed sentinel div height (worker-1)
- Task 3: SWR Cache Invalidation After Food Mutations (FOO-498) - Created invalidateFoodCaches() function, integrated into FoodLogConfirmation and FoodHistory (worker-2)
- Task 4: Recent Tab Revalidation on Revisit (FOO-499) - Enabled revalidateFirstPage:true for automatic revalidation (worker-1)
- Task 5: Fix Dashboard Prefetch Key (FOO-502) - Changed prefetch from /api/common-foods to /api/common-foods?tab=recent&limit=10 (worker-3)
- Task 6: Pending Submission Handler at App Level (FOO-501) - Created PendingSubmissionHandler component in app layout, removed pending logic from QuickSelect (worker-1)

### Files Modified
- `src/components/swr-provider.tsx` - Created: SWRConfig wrapper with global 401 error handler
- `src/components/__tests__/swr-provider.test.tsx` - Created: 4 tests for SWR provider
- `src/app/app/layout.tsx` - Added SWRProvider and PendingSubmissionHandler wrappers
- `src/lib/meal-type.ts` - Changed getLocalDateTime() to return HH:mm format (no seconds)
- `src/lib/__tests__/meal-type.test.ts` - Updated tests for HH:mm format
- `src/components/quick-select.tsx` - useState initializer for clientTime/clientDate, keepPreviousData:true, revalidateFirstPage:true, min-h sentinel, removed pending submission logic
- `src/components/__tests__/quick-select.test.tsx` - Added key stability and revalidation tests, removed pending resubmission tests, removed unused mockAnalysis
- `src/lib/swr.ts` - Added invalidateFoodCaches() function with global SWR mutate
- `src/lib/__tests__/swr.test.ts` - Added 4 tests for cache invalidation
- `src/components/food-log-confirmation.tsx` - Call invalidateFoodCaches() in success useEffect
- `src/components/__tests__/food-log-confirmation.test.tsx` - Added cache invalidation tests, fixed mock to return Promise
- `src/components/food-history.tsx` - Call invalidateFoodCaches() after successful delete
- `src/components/__tests__/food-history.test.tsx` - Added delete cache invalidation tests, fixed mock to return Promise
- `src/components/dashboard-prefetch.tsx` - Fixed preload key to match QuickSelect Recent tab
- `src/components/__tests__/dashboard-prefetch.test.tsx` - Updated test for correct prefetch key
- `src/components/pending-submission-handler.tsx` - Created: global pending submission handler with banner UI
- `src/components/__tests__/pending-submission-handler.test.tsx` - Created: 8 tests for pending handler

### Linear Updates
- FOO-497: Todo → In Progress → Review
- FOO-503: Todo → In Progress → Review
- FOO-498: Todo → In Progress → Review
- FOO-499: Todo → In Progress → Review
- FOO-502: Todo → In Progress → Review
- FOO-501: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 HIGH (unhandled async invalidateFoodCaches), 3 MEDIUM (setTimeout cleanup, docs), 1 LOW — all fixed before commit
- verifier: All tests pass, zero lint errors, zero warnings

### Work Partition
- Worker 1: Tasks 1, 2, 4, 6 (SWR provider, QuickSelect stabilization, Recent tab revalidation, pending submission handler)
- Worker 2: Task 3 (SWR cache invalidation)
- Worker 3: Task 5 (Dashboard prefetch key fix)

### Review Findings

Files reviewed: 17
Reviewers: security, reliability, quality (agent team)
Checks applied: Security (OWASP), Logic, Async, Resources, Type Safety, Conventions, Test Quality

Summary: 1 issue found (Team: security, reliability, quality reviewers + E2E tests)
- FIX: 1 issue — Linear issue created
- DISCARDED: 3 findings — false positives / not applicable

**Issues requiring fix:**
- [HIGH] BUG: `isValidTimeFormat()` in `src/app/api/log-food/route.ts:92` rejects `HH:mm` format — `getLocalDateTime()` was changed from `HH:mm:ss` to `HH:mm` (Task 2/FOO-503) but the API validation regex `^\d{2}:\d{2}:\d{2}$` still requires seconds. ALL food logging is broken.

**Discarded findings (not bugs):**
- [DISCARDED] ERROR: Missing console.error in food-history.tsx:144 fetchEntries catch — Pre-existing code not changed in this iteration; catch block properly handles error via user-facing state
- [DISCARDED] ERROR: Missing console.error in food-history.tsx:195 handleDeleteConfirm catch — Pre-existing catch block; only invalidateFoodCaches() was added in the try block above it
- [DISCARDED] ERROR: Missing console.error in pending-submission-handler.tsx:93 catch — New code but properly handles error via clearPendingSubmission() + user-facing error state; CLAUDE.md says console.error is "correct for" client components, not "required in every catch"

### Linear Updates
- FOO-497: Review → Merge
- FOO-503: Review → Merge
- FOO-498: Review → Merge
- FOO-499: Review → Merge
- FOO-502: Review → Merge
- FOO-501: Review → Merge
- FOO-504: Created in Todo (Fix: isValidTimeFormat rejects HH:mm format)

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Fix Plan

**Source:** Review findings from Iteration 1 (E2E test failure)
**Linear Issues:** [FOO-504](https://linear.app/lw-claude/issue/FOO-504/fix-isvalidtimeformat-rejects-hhmm-format-after-getlocaldatetime)

### Fix 1: Update isValidTimeFormat to accept HH:mm format
**Linear Issue:** [FOO-504](https://linear.app/lw-claude/issue/FOO-504/fix-isvalidtimeformat-rejects-hhmm-format-after-getlocaldatetime)

1. Write test in `src/app/api/log-food/__tests__/route.test.ts` (or existing test file) that verifies `isValidTimeFormat` accepts both `HH:mm` and `HH:mm:ss` formats
2. Update regex in `src/app/api/log-food/route.ts:92` from `^\d{2}:\d{2}:\d{2}$` to `^\d{2}:\d{2}(:\d{2})?$` to accept both formats
3. Update validation logic to handle both 2-part and 3-part time strings
4. Update error message from "Use HH:mm:ss" to "Use HH:mm or HH:mm:ss"
