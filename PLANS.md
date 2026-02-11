# Fix Plan: Lumen Date Timezone + History Stale Data

**Issues:** [FOO-324](https://linear.app/lw-claude/issue/FOO-324/fix-lumen-goals-date-mismatch-between-client-and-server-timezone), [FOO-323](https://linear.app/lw-claude/issue/FOO-323/fix-history-page-showing-stale-data-after-navigation-and-focus-return)
**Date:** 2026-02-11
**Status:** COMPLETE
**Branch:** fix/FOO-324-lumen-date-timezone

## FOO-324: Lumen Goals Date Mismatch Between Client and Server Timezone

### Root Cause

Timezone mismatch between client-side and server-side `getTodayDate()` functions. When the user's local timezone is behind UTC, the client and server disagree on what "today" is. Goals get saved under the UTC date but queried by the local date, causing a permanent miss.

### Evidence

Staging logs show POST saves with server UTC date `2026-02-11` but GET queries use client local date `2026-02-10` — always `hasGoals=false`.

### Related Code

- `src/components/lumen-banner.tsx:10-16` — client-side `getTodayDate()`, used for SWR GET key at line 25
- `src/components/lumen-banner.tsx:47-48` — POST FormData only appends `image`, no `date`
- `src/components/daily-dashboard.tsx:15-21` — duplicate client-side `getTodayDate()`, used for SWR GET key at line 72
- `src/components/daily-dashboard.tsx:86-87` — POST FormData only appends `image`, no `date`
- `src/app/api/lumen-goals/route.ts:19-25` — server-side `getTodayDate()` in UTC (Railway)
- `src/app/api/lumen-goals/route.ts:129` — defaults to server UTC today when no date sent

### Step 1: Add date to LumenBanner POST request (FOO-324)
**File:** `src/components/lumen-banner.tsx` (modify)
**Test:** `src/components/__tests__/lumen-banner.test.tsx` (modify)

**Behavior:**
- `handleFileChange` should append `date` field to FormData alongside the image
- The date value is `today` (already computed at line 19 from client-side `getTodayDate()`)
- This ensures the server saves goals under the same date the SWR GET queries

**Tests:**
1. POST fetch body (FormData) includes a `date` field matching the client-side today date
2. All existing LumenBanner tests continue to pass

### Step 2: Add date to DailyDashboard Lumen update POST request (FOO-324)
**File:** `src/components/daily-dashboard.tsx` (modify)
**Test:** `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**Behavior:**
- `handleLumenFileChange` should append `date` field to FormData alongside the image
- The date value is `today` (already computed at line 48 from client-side `getTodayDate()`)

**Tests:**
1. POST fetch body (FormData) includes a `date` field matching the client-side today date
2. All existing DailyDashboard tests continue to pass

---

## FOO-323: Fix History Page Showing Stale Data After Navigation and Focus Return

### Root Cause

`src/components/food-history.tsx:95-105` — The `hasSeeded` ref is a boolean that, once set to `true` on first SWR data seed, permanently blocks all subsequent SWR revalidation data from updating local `entries` state.

On re-navigation (bottom nav): component remounts, SWR returns stale cached data synchronously, seeds entries and sets `hasSeeded = true`. When background revalidation completes with fresh data, `hasSeeded` is already `true` — fresh data is discarded.

The `hasSeeded` pattern was designed to protect paginated entries from being overwritten by SWR revalidation (which only returns page 1). But it also prevents fresh data from appearing on re-navigation and focus return.

### Related Code

- `src/components/food-history.tsx:98` — `const hasSeeded = useRef(false)`
- `src/components/food-history.tsx:99-105` — useEffect that seeds entries only when `!hasSeeded.current`
- `src/components/food-history.tsx:152-160` — `handleLoadMore` pagination
- `src/components/food-history.tsx:192-196` — `handleJumpToDate`
- `src/components/food-history.tsx:183` — `mutate()` after delete (triggers SWR revalidation)

### Design Decision

Replace the boolean `hasSeeded` ref with a `hasPaginated` ref that tracks whether the user has performed pagination actions (Load More or Jump to Date). The key insight:

- **User hasn't paginated** → local entries match SWR page 1 → safe to update from SWR revalidation
- **User has paginated** → local entries include page 2+ data → SWR revalidation would lose paginated entries → block updates

This preserves the pagination protection while allowing fresh data on re-navigation and focus return.

### Step 3: Replace hasSeeded with hasPaginated in FoodHistory (FOO-323)
**File:** `src/components/food-history.tsx` (modify)
**Test:** `src/components/__tests__/food-history.test.tsx` (modify)

**Behavior:**
- Replace `hasSeeded` ref (boolean, set once on first seed) with `hasPaginated` ref (boolean, set when user paginates)
- The useEffect seeding `entries` from `initialData` should update entries whenever `initialData` changes, UNLESS `hasPaginated.current` is `true`
- Set `hasPaginated.current = true` in `handleLoadMore` (line 152) and `handleJumpToDate` (line 192)
- This means: on fresh mount and on SWR revalidation (focus return, re-navigation), entries update from SWR data — unless the user has paginated in this session

**Tests:**
1. SWR revalidation updates entries when user has NOT paginated (new test) — mount with initial data, simulate SWR returning new data, verify entries update
2. SWR revalidation after navigation shows fresh data (new test) — mount with cache, unmount, remount with updated SWR data, verify new entries appear
3. Existing test "SWR revalidation after delete does not overwrite paginated entries" (line 615) must still pass — user paginates then deletes, SWR revalidation is blocked
4. Existing test "shows cached data instantly on re-mount (SWR cache)" (line 914) must still pass
5. All other existing food-history tests continue to pass

---

## Verification (both issues)

- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds

## Notes

- Server-side `getTodayDate()` in `route.ts:19-25` remains as fallback for direct API calls without a date field
- The `getTodayDate()` duplication across 3 files is acceptable since client and server versions intentionally use different timezones
- The `hasPaginated` flag resets on each mount (component unmount destroys refs), so re-navigation always starts fresh

---

## Iteration 1

**Implemented:** 2026-02-11
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Add date to LumenBanner POST (FOO-324) - Added `formData.append("date", today)` to handleFileChange (worker-1)
- Task 2: Add date to DailyDashboard POST (FOO-324) - Added `formData.append("date", today)` to handleLumenFileChange (worker-2)
- Task 3: Replace hasSeeded with hasPaginated (FOO-323) - Replaced boolean ref to allow SWR revalidation when user hasn't paginated (worker-3)

### Files Modified
- `src/components/lumen-banner.tsx` - Added date field to POST FormData
- `src/components/__tests__/lumen-banner.test.tsx` - Added test verifying date in POST body
- `src/components/daily-dashboard.tsx` - Added date field to POST FormData
- `src/components/__tests__/daily-dashboard.test.tsx` - Added test verifying date in POST body
- `src/components/food-history.tsx` - Replaced hasSeeded with hasPaginated ref logic
- `src/components/__tests__/food-history.test.tsx` - Added 2 new tests for SWR revalidation behavior

### Linear Updates
- FOO-324: Todo → In Progress → Review
- FOO-323: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: No critical/high bugs found. 2 medium test-only style notes, 1 low naming note.
- verifier: All 1254 tests pass, zero warnings, build succeeds

### Work Partition
- Worker 1: Task 1 (lumen-banner files)
- Worker 2: Task 2 (daily-dashboard files)
- Worker 3: Task 3 (food-history files)

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 6
Reviewers: security, reliability, quality (agent team)
Checks applied: Security (OWASP), Logic, Async, Resources, Type Safety, Conventions, Test Quality

No issues found in changed code — all implementations are correct and follow project conventions.

Reviewer notes on pre-existing code (out of scope, not blocking):
- Error messages from API displayed without sanitization (medium, pre-existing)
- summary.meals potential undefined access (pre-existing, type guarantees `meals: MealGroup[]`)
- fetch() calls without timeout (pre-existing pattern across all components)

### Linear Updates
- FOO-324: Review → Merge
- FOO-323: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
