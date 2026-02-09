# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-278-data-freshness-and-bug-fixes
**Issues:** FOO-278, FOO-279, FOO-280, FOO-281, FOO-282, FOO-283, FOO-276, FOO-275, FOO-274, FOO-273
**Created:** 2026-02-09
**Last Updated:** 2026-02-09

## Summary

Fix data freshness issues across the app (stale cache headers and disabled SWR revalidation), fix the Quick Select Done button navigation, add error handling for silent failures in food history, add 5xx retry logic to the Claude API client, and improve resilience for partial failures in Fitbit+DB operations.

## Issues

### FOO-278: Quick Select Done button navigates back to food list instead of Home

**Priority:** Medium
**Labels:** Bug
**Description:** After logging a food via Quick Select, the Done button resets component state and stays on Quick Select instead of navigating to `/app`. The `onDone` callback in `quick-select.tsx:251-256` clears state instead of navigating. The fallback in `food-log-confirmation.tsx:83` already does `router.push("/app")` when no `onDone` is provided.

**Acceptance Criteria:**
- [ ] After logging food via Quick Select, Done button navigates to `/app`
- [ ] SWR cache is still refreshed before navigation

### FOO-279: Common foods API serves stale data for up to 60 seconds

**Priority:** Medium
**Labels:** Bug
**Description:** `/api/common-foods` sets `Cache-Control: private, max-age=60, stale-while-revalidate=300` on both common foods and recent foods response paths (lines 46, 78). User prefers freshness over speed.

**Acceptance Criteria:**
- [ ] Common foods API returns `Cache-Control: private, no-cache` (always revalidate)
- [ ] Recent foods API returns `Cache-Control: private, no-cache`

### FOO-280: Food history API serves stale data for up to 30 seconds

**Priority:** Medium
**Labels:** Bug
**Description:** `/api/food-history` sets `Cache-Control: private, max-age=30, stale-while-revalidate=120` (line 39). This compounds with SWR `revalidateOnFocus: false`.

**Acceptance Criteria:**
- [ ] Food history API returns `Cache-Control: private, no-cache`

### FOO-281: Search foods API serves stale data for up to 30 seconds

**Priority:** Medium
**Labels:** Bug
**Description:** `/api/search-foods` sets `Cache-Control: private, max-age=30, stale-while-revalidate=60` (line 31). After creating a custom food, searching for it won't return it for up to 30 seconds.

**Acceptance Criteria:**
- [ ] Search foods API returns `Cache-Control: private, no-cache`

### FOO-282: Quick Select does not revalidate data on tab focus

**Priority:** Medium
**Labels:** Bug
**Description:** `quick-select.tsx` sets `revalidateOnFocus: false` for all three SWR hooks (common foods via SWRInfinite, recent foods, and search). When user switches back to browser, food lists are not refreshed.

**Acceptance Criteria:**
- [ ] `revalidateOnFocus: false` removed from useSWRInfinite and useSWR hooks in quick-select.tsx
- [ ] SWR default `revalidateOnFocus: true` takes effect

### FOO-283: Food history does not revalidate on tab focus

**Priority:** Medium
**Labels:** Bug
**Description:** `food-history.tsx` sets `revalidateOnFocus: false` for the initial history SWR hook (line 81). When user switches back to browser, history list is not refreshed.

**Acceptance Criteria:**
- [ ] `revalidateOnFocus: false` removed from useSWR hook in food-history.tsx
- [ ] SWR default `revalidateOnFocus: true` takes effect

### FOO-276: Empty catch block in food-history fetchEntries silently swallows errors

**Priority:** Low
**Labels:** Bug
**Description:** `food-history.tsx:141` — `fetchEntries()` has an empty catch block that silently swallows all errors. Both "Load More" and "Jump to Date" silently fail with no error state or retry option.

**Acceptance Criteria:**
- [ ] `fetchEntries` catch block sets an error state
- [ ] Error message is displayed to the user
- [ ] User can retry after an error

### FOO-275: Claude API client does not retry on 5xx errors

**Priority:** Low
**Labels:** Bug
**Description:** In both `analyzeFood` and `refineAnalysis`, the retry logic only handles timeout and rate limit (429) errors. 5xx server errors are NOT retried, unlike the Fitbit API client which retries on 5xx with exponential backoff.

**Acceptance Criteria:**
- [ ] Both `analyzeFood` and `refineAnalysis` retry on 5xx errors with exponential backoff
- [ ] Existing timeout and rate limit retry behavior is preserved
- [ ] New `is5xxError` helper function added

### FOO-274: Partial failure on food history delete — Fitbit deleted but local record persists

**Priority:** Low
**Labels:** Bug
**Description:** In `food-history/[id]/route.ts:27-36`, if Fitbit deletion succeeds but `deleteFoodLogEntry` throws, the local DB record persists while the Fitbit log is already deleted. No catch/rollback for this partial failure.

**Acceptance Criteria:**
- [ ] If `deleteFoodLogEntry` fails after Fitbit delete succeeds, still return success (Fitbit is the primary system)
- [ ] Log a warning about the DB failure so it can be investigated
- [ ] User sees success (the Fitbit entry is gone, which is what matters)

### FOO-273: Fitbit log succeeds but local DB insert can fail — orphaned entries

**Priority:** Medium
**Labels:** Bug
**Description:** In `log-food/route.ts:192-208, 258-290`, if `insertFoodLogEntry` throws after Fitbit log succeeds, the response returns `success: true` with `foodLogId` undefined. This creates an orphaned Fitbit entry that won't appear in the app's food history.

**Acceptance Criteria:**
- [ ] When DB insert fails after Fitbit log succeeds, response includes a warning flag
- [ ] The `FoodLogResponse` type includes an optional `dbError` field
- [ ] Client-side displays a warning when `dbError` is present in the response

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Remove stale Cache-Control headers from API routes

**Issues:** FOO-279, FOO-280, FOO-281
**Files:**
- `src/app/api/common-foods/route.ts` (modify)
- `src/app/api/food-history/route.ts` (modify)
- `src/app/api/search-foods/route.ts` (modify)
- `src/app/api/common-foods/__tests__/route.test.ts` (modify)
- `src/app/api/food-history/__tests__/route.test.ts` (modify)
- `src/app/api/search-foods/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update existing Cache-Control test assertions:
   - In each test file, find assertions checking for `max-age=60` or `max-age=30` headers
   - Change them to assert `Cache-Control: private, no-cache`
   - Run: `npm test -- common-foods/route.test search-foods/route.test food-history/__tests__/route.test`
   - Verify: Tests fail because current code still returns `max-age` headers

2. **GREEN** - Update the API route handlers:
   - In `src/app/api/common-foods/route.ts`: Change both lines 46 and 78 from `"private, max-age=60, stale-while-revalidate=300"` to `"private, no-cache"`
   - In `src/app/api/food-history/route.ts`: Change line 39 from `"private, max-age=30, stale-while-revalidate=120"` to `"private, no-cache"`
   - In `src/app/api/search-foods/route.ts`: Change line 31 from `"private, max-age=30, stale-while-revalidate=60"` to `"private, no-cache"`
   - Run: `npm test -- common-foods/route.test search-foods/route.test food-history/__tests__/route.test`
   - Verify: Tests pass

3. **REFACTOR** - None needed, these are one-line changes.

**Notes:**
- `no-cache` means "always revalidate with server before using cached response" — the browser still caches but always checks freshness. This is the right choice for user-specific data that changes frequently.

### Task 2: Enable SWR revalidateOnFocus in Quick Select and Food History

**Issues:** FOO-282, FOO-283
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Check if any existing tests assert `revalidateOnFocus: false` behavior. If so, update them to expect the default SWR behavior (revalidation on focus). Run: `npm test -- quick-select.test food-history.test`

2. **GREEN** - Remove the option:
   - In `src/components/food-history.tsx:81`: Remove `revalidateOnFocus: false` from the useSWR options (or remove the entire options object if it only contains that key)
   - In `src/components/quick-select.tsx:80`: Remove `revalidateOnFocus: false` from useSWRInfinite options (keep `revalidateFirstPage: false`)
   - In `src/components/quick-select.tsx:87`: Remove `revalidateOnFocus: false` from useSWR options (or remove the entire options object)
   - Run: `npm test -- quick-select.test food-history.test`
   - Verify: Tests pass

3. **REFACTOR** - None needed, these are simple option removals.

**Notes:**
- SWR default `focusThrottleInterval` is 5 seconds, which prevents excessive refetching on rapid tab switches.
- `revalidateFirstPage: false` in the SWRInfinite hook should remain — it prevents refetching already-loaded pages on new page loads.

### Task 3: Fix Quick Select Done button navigation

**Issue:** FOO-278
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write/update test asserting Done button navigates to `/app`:
   - In the test file, find or add a test case for the post-log Done button behavior
   - Assert that after logging a food, clicking Done calls `router.push("/app")`
   - Run: `npm test -- quick-select.test`
   - Verify: Test fails because current `onDone` resets state instead of navigating

2. **GREEN** - Remove the `onDone` prop from `FoodLogConfirmation`:
   - In `src/components/quick-select.tsx:251-256`: Remove the `onDone` callback entirely
   - This lets the fallback `router.push("/app")` in `food-log-confirmation.tsx:83` kick in
   - Run: `npm test -- quick-select.test`
   - Verify: Test passes

3. **REFACTOR** - Clean up:
   - Remove the now-unused `mutate` from the success screen path (the Home page will refetch on mount via SWR revalidateOnFocus, which we just enabled in Task 2)
   - Verify Quick Select tests still pass

**Notes:**
- The `FoodLogConfirmation` component at `src/components/food-log-confirmation.tsx:83` already has: `onClick={() => (onDone ? onDone() : router.push("/app"))}`. Removing `onDone` uses this fallback.
- SWR will revalidate data when the user returns to Quick Select later, so explicit `mutate()` before navigating away is not needed.

### Task 4: Add error handling to food-history fetchEntries

**Issue:** FOO-276
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write test asserting error state is shown on fetch failure:
   - Add a test that mocks `fetch` to reject
   - Assert that an error message is displayed to the user
   - Assert that "Load More" and "Jump to Date" show the error
   - Run: `npm test -- food-history.test`
   - Verify: Tests fail because current code silently swallows errors

2. **GREEN** - Add error state to `fetchEntries`:
   - Add a new state: `const [fetchError, setFetchError] = useState<string | null>(null)`
   - In the catch block at line 141, replace empty catch with: `setFetchError("Failed to load entries. Please try again.")`
   - Clear `fetchError` at the start of `fetchEntries`: `setFetchError(null)`
   - Add error display in the JSX (similar to `deleteError` pattern at line 240-244)
   - Run: `npm test -- food-history.test`
   - Verify: Tests pass

3. **REFACTOR** - Consider whether the error message pattern could reuse the existing `deleteError` display pattern.

**Notes:**
- Reference the existing `deleteError` display at lines 240-244 for consistent error UI pattern.
- Clear the error on subsequent fetch attempts so the error disappears when the user retries.

### Task 5: Add 5xx retry logic to Claude API client

**Issue:** FOO-275
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write test for 5xx retry behavior:
   - Add a test in `claude.test.ts` that simulates a 5xx error from the Anthropic SDK
   - The Anthropic SDK throws an `InternalServerError` with `status: 500` — create a mock Error with `status: 500`
   - Assert that the function retries and succeeds on the second attempt
   - Add a test that 5xx retries are exhausted after `maxRetries` attempts
   - Run: `npm test -- claude.test`
   - Verify: Tests fail because current code doesn't retry on 5xx

2. **GREEN** - Add 5xx retry logic:
   - Add a helper function `is5xxError(error: unknown): boolean` that checks for `error instanceof Error && "status" in error && status >= 500 && status < 600`
   - In both `analyzeFood` (after the `isRateLimitError` check around line 262) and `refineAnalysis` (after the `isRateLimitError` check around line 375), add:
     ```
     if (is5xxError(error) && attempt < maxRetries) {
       const delay = Math.pow(2, attempt) * 1000;
       logger.warn({ attempt, delay }, "Claude API 5xx error, retrying");
       lastError = error as Error;
       await new Promise((resolve) => setTimeout(resolve, delay));
       continue;
     }
     ```
   - Run: `npm test -- claude.test`
   - Verify: Tests pass

3. **REFACTOR** - Verify existing timeout and rate limit tests still pass.

**Notes:**
- Pattern follows the existing Fitbit client at `src/lib/fitbit.ts:101-111` which retries on `response.status >= 500`.
- The Anthropic SDK throws typed errors with a `status` property — check for `error.status >= 500`.
- Use the same exponential backoff pattern as rate limit retries.

### Task 6: Handle partial failure on food history delete

**Issue:** FOO-274
**Files:**
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write test for partial failure (Fitbit delete succeeds, DB delete fails):
   - Mock `deleteFoodLog` to resolve successfully
   - Mock `deleteFoodLogEntry` to throw an error
   - Assert that the response is still `success: true` (Fitbit is the primary system)
   - Assert that a warning is logged
   - Run: `npm test -- food-history/\\[id\\]`
   - Verify: Test fails because current code lets the error propagate to the outer catch

2. **GREEN** - Wrap `deleteFoodLogEntry` in try/catch:
   - In `src/app/api/food-history/[id]/route.ts:36`, wrap `deleteFoodLogEntry` call:
     ```
     try {
       await deleteFoodLogEntry(session!.userId, id);
     } catch (dbError) {
       logger.error(
         { action: "delete_food_log_db_error", entryId: id, error: dbError instanceof Error ? dbError.message : String(dbError) },
         "Fitbit delete succeeded but local DB delete failed — entry may be orphaned locally"
       );
     }
     ```
   - Run: `npm test -- food-history/\\[id\\]`
   - Verify: Tests pass

3. **REFACTOR** - None needed.

**Notes:**
- The approach mirrors the existing pattern in `log-food/route.ts:192-208` where DB failures are non-fatal.
- Fitbit is the system of record — if Fitbit delete succeeds, the user's intent is fulfilled.

### Task 7: Improve partial failure handling in log-food route

**Issue:** FOO-273
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)
- `src/types/index.ts` (modify)

**TDD Steps:**

1. **RED** - Write test for partial failure (Fitbit log succeeds, DB insert fails):
   - Mock `insertCustomFood` or `insertFoodLogEntry` to throw
   - Mock Fitbit API calls to succeed
   - Assert that response includes `success: true` AND `dbError: true`
   - Run: `npm test -- log-food/route.test`
   - Verify: Test fails because current code doesn't set `dbError`

2. **GREEN** - Add `dbError` flag:
   - In `src/types/index.ts`, add `dbError?: boolean` to the `FoodLogResponse` interface
   - In `src/app/api/log-food/route.ts`: In both the reuse flow (lines 192-208) and new food flow (lines 258-290), when the DB catch block fires, set a `dbError` flag
   - Include `dbError: true` in the response object when the DB insert fails
   - Run: `npm test -- log-food/route.test`
   - Verify: Tests pass

3. **REFACTOR** - Verify existing log-food tests still pass.

**Notes:**
- The current code already logs DB errors and continues — we just need to propagate the `dbError` flag to the client.
- Client-side handling of `dbError` is a nice-to-have but not required for this task — the primary goal is making the partial failure visible in the response.

### Task 8: Integration & Verification

**Issues:** FOO-278, FOO-279, FOO-280, FOO-281, FOO-282, FOO-283, FOO-276, FOO-275, FOO-274, FOO-273
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification steps:
   - [ ] All tests pass with zero failures
   - [ ] No lint warnings
   - [ ] No type errors
   - [ ] Build succeeds with zero warnings

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| API route returns no-cache header | Browser always revalidates | Unit test (check header value) |
| SWR refetches on tab focus | Fresh data shown on return | Component test |
| Quick Select Done clicked | Navigate to /app | Component test |
| fetchEntries network failure | Error message shown to user | Component test |
| Claude API returns 5xx | Retry with backoff | Unit test |
| Fitbit delete ok, DB delete fails | Return success, log warning | Unit test |
| Fitbit log ok, DB insert fails | Return success with dbError flag | Unit test |

## Risks & Open Questions

- [ ] Removing `max-age` headers means every browser navigation triggers a server request. For a single-user app this is fine — the DB queries are fast. If performance becomes an issue later, consider `max-age=5` instead of `no-cache`.
- [ ] Removing `onDone` from Quick Select's FoodLogConfirmation means the SWR cache won't be explicitly mutated before navigating away. This is acceptable because SWR will revalidate when the user returns (revalidateOnFocus is now enabled).

## Scope Boundaries

**In Scope:**
- Cache-Control header changes on 3 API routes
- SWR revalidateOnFocus option removal on 2 components
- Quick Select Done button navigation fix
- Error handling in food-history fetchEntries
- 5xx retry logic in Claude API client
- Partial failure handling in food history delete route
- Partial failure flag in log-food route response

**Out of Scope:**
- FOO-277 (Canceled): Duplicated pending-submission resubmit logic — premature abstraction, working correctly
- FOO-272 (Canceled): Fire-and-forget stale state updates — React no-op, no real impact
- FOO-271 (Canceled): In-memory row loading — correct approach for single-user data volumes
- FOO-270 (Canceled): Token encryption key derivation — SHA-256 of high-entropy secret is adequate
- FOO-269 (Canceled): Middleware cookie validation — functionally correct, route handlers always validate
- FOO-268 (Canceled): CSP header — complex standalone effort, low current risk

---

## Iteration 1

**Implemented:** 2026-02-09
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Remove stale Cache-Control headers (FOO-279, FOO-280, FOO-281) — Changed `max-age` headers to `no-cache` on 3 API routes (worker-2)
- Task 2: Enable SWR revalidateOnFocus (FOO-282, FOO-283) — Removed `revalidateOnFocus: false` from 3 SWR hooks (worker-1)
- Task 3: Fix Quick Select Done button navigation (FOO-278) — Removed `onDone` callback, uses fallback `router.push("/app")` (worker-1)
- Task 4: Add error handling to food-history fetchEntries (FOO-276) — Added `fetchError` state and error display UI (worker-1)
- Task 5: Add 5xx retry logic to Claude API client (FOO-275) — Added `is5xxError` helper and retry blocks in both `analyzeFood` and `refineAnalysis` (worker-3)
- Task 6: Handle partial failure on food history delete (FOO-274) — Wrapped `deleteFoodLogEntry` in try/catch, DB failures non-fatal (worker-4)
- Task 7: Improve partial failure handling in log-food route (FOO-273) — Added `dbError` flag to `FoodLogResponse` type and response (worker-4)

### Files Modified
- `src/app/api/common-foods/route.ts` — Cache-Control → `private, no-cache`
- `src/app/api/common-foods/__tests__/route.test.ts` — Updated header assertions
- `src/app/api/food-history/route.ts` — Cache-Control → `private, no-cache`
- `src/app/api/food-history/__tests__/route.test.ts` — Updated header assertions
- `src/app/api/search-foods/route.ts` — Cache-Control → `private, no-cache`
- `src/app/api/search-foods/__tests__/route.test.ts` — Updated header assertions
- `src/components/quick-select.tsx` — Removed `revalidateOnFocus: false`, removed `onDone` callback, removed unused `mutate`
- `src/components/__tests__/quick-select.test.tsx` — Updated mock, added Done navigation test
- `src/components/food-history.tsx` — Removed `revalidateOnFocus: false`, added `fetchError` state and error UI
- `src/components/__tests__/food-history.test.tsx` — Added 3 error handling tests
- `src/lib/claude.ts` — Added `is5xxError` helper, 5xx retry blocks in both functions
- `src/lib/__tests__/claude.test.ts` — Added 6 retry tests
- `src/app/api/food-history/[id]/route.ts` — Wrapped `deleteFoodLogEntry` in try/catch
- `src/app/api/food-history/[id]/__tests__/route.test.ts` — Added 2 partial failure tests
- `src/app/api/log-food/route.ts` — Added `dbError` flag to both reuse and new food flows
- `src/app/api/log-food/__tests__/route.test.ts` — Added 4 partial failure tests
- `src/types/index.ts` — Added `dbError?: boolean` to `FoodLogResponse`
- `CLAUDE.md` — Updated Cache-Control performance policy

### Linear Updates
- FOO-279: Todo → In Progress → Review
- FOO-280: Todo → In Progress → Review
- FOO-281: Todo → In Progress → Review
- FOO-282: Todo → In Progress → Review
- FOO-283: Todo → In Progress → Review
- FOO-278: Todo → In Progress → Review
- FOO-276: Todo → In Progress → Review
- FOO-275: Todo → In Progress → Review
- FOO-274: Todo → In Progress → Review
- FOO-273: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: 8 findings triaged — 2 HIGH by-design (per plan acceptance criteria), 1 MEDIUM actioned (CLAUDE.md updated), 4 false positives, 2 out-of-scope
- verifier: All 1006 tests pass, zero warnings, lint/typecheck/build clean

### Work Partition
- Worker 1: Tasks 2, 3, 4 (component files: quick-select, food-history)
- Worker 2: Task 1 (API route files: common-foods, food-history, search-foods)
- Worker 3: Task 5 (lib file: claude.ts)
- Worker 4: Tasks 6, 7 (API route files: food-history/[id], log-food + types)

### Continuation Status
All tasks completed.
