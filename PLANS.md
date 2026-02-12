# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-330-budget-marker-and-resume-reset
**Issues:** FOO-330, FOO-331
**Created:** 2026-02-12
**Last Updated:** 2026-02-12

## Summary

Two UX fixes for the daily dashboard's date navigation feature:
1. **FOO-330:** Hide the calorie ring's budget marker when viewing past dates (it only has meaning for today).
2. **FOO-331:** Auto-reset the dashboard to today when the PWA tab is resumed after a day change or 1hr+ idle, preventing stale data display.

## Issues

### FOO-330: Hide budget marker when viewing past dates

**Priority:** High
**Labels:** Bug
**Description:** The calorie ring's budget marker (amber tick showing remaining calorie ceiling) is rendered for all dates including past days. Budget is derived from live Fitbit burn data and only makes sense for the current day. Past dates show a misleading marker suggesting calories remain.

**Acceptance Criteria:**
- [ ] Budget marker is visible only when `selectedDate` is today
- [ ] Budget marker is hidden when navigating to any past date

### FOO-331: Reset dashboard to today when app is resumed after date change or 1h+ idle

**Priority:** High
**Labels:** Improvement
**Description:** `DailyDashboard` initializes `selectedDate` via `useState(getTodayDate())`, which only evaluates on first mount. When the PWA stays open in a browser tab and the user returns later, `selectedDate` stays on the previous day. The user sees stale data and stale Lumen goals instead of today's empty state.

**Acceptance Criteria:**
- [ ] When the tab becomes visible and the calendar date has changed since last active, reset `selectedDate` to today and revalidate all SWR caches
- [ ] When the tab becomes visible and >1hr has elapsed since last active (even if same day), reset `selectedDate` to today and revalidate all SWR caches
- [ ] Track "last active" state (date + timestamp), updated on each `visibilitychange` to hidden

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Hide budget marker for past dates

**Issue:** FOO-330
**Files:**
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)

**TDD Steps:**

1. **RED** — Write failing test:
   - In `daily-dashboard.test.tsx`, add a test: "does not show budget marker when viewing a past date even with activity data"
   - Approach: use `vi.useFakeTimers()` and `vi.setSystemTime()` to fix "today" to a known date (e.g., `2026-02-10`). Set up mockFetch to return activity data and earliest-entry. Render dashboard, then use `userEvent.click` on the "Previous day" button to navigate to `2026-02-09`. Wait for re-render, then assert `budget-marker` testid is NOT in the document.
   - Also add a companion test: "shows budget marker when viewing today with activity data" (under fake timers for consistency) to confirm the marker IS shown for today. This may overlap with the existing "passes budget prop" test but ensures the condition is explicit.
   - Run: `npm test -- daily-dashboard`
   - Verify: The first test fails because budget is currently passed unconditionally.

2. **GREEN** — Make it pass:
   - In `daily-dashboard.tsx`, conditionally pass `budget` to `CalorieRing` only when `selectedDate` equals today.
   - Use the existing `isToday()` helper from `@/lib/date-utils` (already exported) or inline `selectedDate === getTodayDate()`. The `isToday` import is cleaner.
   - The change is on the line that passes `budget={budget}` to `<CalorieRing>` — wrap it: `budget={isToday(selectedDate) ? budget : undefined}`.
   - Run: `npm test -- daily-dashboard`
   - Verify: All tests pass, including existing budget marker tests (they render at today by default).

3. **REFACTOR** — Clean up:
   - If `isToday` was imported, verify no unused imports remain. No other cleanup expected — this is a one-line change.

**Notes:**
- The existing test "passes budget prop to CalorieRing when activity data is available" renders at default (today) so it should continue passing.
- Fake timers are needed because `getTodayDate()` uses `new Date()` — without them, tests are date-dependent.
- Reference pattern: `src/lib/__tests__/date-utils.test.ts` lines 17-24 for fake timer setup.

### Task 2: Add visibility-change auto-reset to today

**Issue:** FOO-331
**Files:**
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)

**TDD Steps:**

1. **RED** — Write failing tests for visibility-change behavior. Add a new `describe("visibility change auto-reset", ...)` block in `daily-dashboard.test.tsx`. All tests in this block should use `vi.useFakeTimers()` to control both `Date.now()` and `getTodayDate()`.

   Three tests needed:

   a. **"resets selectedDate to today when tab becomes visible after a new day"**
      - Set system time to `2026-02-10T20:00:00`. Render dashboard (selectedDate = "2026-02-10").
      - Dispatch `visibilitychange` with `document.visibilityState = "hidden"`.
      - Advance system time to `2026-02-11T08:00:00` (next day, >1hr elapsed).
      - Dispatch `visibilitychange` with `document.visibilityState = "visible"`.
      - Assert: the date display shows "Today" (which `formatDisplayDate` returns for the current date). Also assert new fetch calls are made with `date=2026-02-11`.

   b. **"resets selectedDate to today when tab becomes visible after 1hr+ idle on same day"**
      - Set system time to `2026-02-10T10:00:00`. Render dashboard.
      - Navigate to previous day (click "Previous day") so selectedDate = "2026-02-09".
      - Dispatch `visibilitychange` hidden.
      - Advance system time by 2 hours (still 2026-02-10 but >1hr elapsed).
      - Dispatch `visibilitychange` visible.
      - Assert: display shows "Today" and fetch calls include `date=2026-02-10`.

   c. **"does not reset when tab becomes visible within 1hr on same day"**
      - Set system time to `2026-02-10T10:00:00`. Render dashboard.
      - Navigate to previous day so selectedDate = "2026-02-09".
      - Dispatch `visibilitychange` hidden.
      - Advance time by 30 minutes (same day, <1hr).
      - Dispatch `visibilitychange` visible.
      - Assert: display still shows "Yesterday" (since selected date is still 2026-02-09 relative to 2026-02-10). The selected date was NOT reset.

   Testing technique for `document.visibilityState`: use `Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })` before dispatching `new Event('visibilitychange')`. Restore in afterEach.

   Run: `npm test -- daily-dashboard`
   Verify: All three tests fail (no visibilitychange handler exists yet).

2. **GREEN** — Implement the visibility-change handler:
   - Import `useSWRConfig` from `"swr"` in `daily-dashboard.tsx`.
   - Add `const { mutate: globalMutate } = useSWRConfig();` inside `DailyDashboard`.
   - Add `const lastActiveRef = useRef({ date: getTodayDate(), timestamp: Date.now() });` to track when the tab was last active.
   - Add a `useEffect` that:
     - Registers a `visibilitychange` event listener on `document`.
     - On `hidden`: updates `lastActiveRef.current` to `{ date: getTodayDate(), timestamp: Date.now() }`.
     - On `visible`: computes `today = getTodayDate()`, checks if `today !== lastActiveRef.current.date` (date changed) OR `Date.now() - lastActiveRef.current.timestamp > 3_600_000` (1hr+ elapsed). If either is true: calls `setSelectedDate(today)` and `globalMutate(() => true)` to revalidate all SWR caches.
     - Cleanup: removes the event listener on unmount.
   - Dependencies array: `[globalMutate]` (setSelectedDate is stable from useState; the ref read doesn't need to be a dep).
   - Run: `npm test -- daily-dashboard`
   - Verify: All tests pass.

3. **REFACTOR** — Clean up:
   - Verify the `useRef` import is already present (line 3 currently imports `useRef`). `useSWRConfig` import is new.
   - Ensure no ESLint warnings from the effect deps.
   - Consider whether the 1-hour threshold should be a named constant (e.g., `IDLE_RESET_MS = 3_600_000`). Keep it inline if the plan-implement workers follow the spec; a named constant is fine too.

**Notes:**
- `globalMutate(() => true)` revalidates all keys in the SWR cache. This covers `/api/nutrition-goals` and `/api/earliest-entry` (no date param) as well as the date-dependent endpoints.
- When `selectedDate` doesn't actually change (e.g., user was on today, idle >1hr, comes back still today), the SWR keys with `?date=` won't change — but `globalMutate(() => true)` still forces a revalidation, ensuring fresh data.
- `useRef` for lastActive state avoids re-renders when the tab is hidden/shown.
- No persistence needed — tab reload already re-mounts the component and resets everything.

### Task 3: Integration & Verification

**Issues:** FOO-330, FOO-331
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification checklist:
   - [ ] Run `npm run dev`, open dashboard — budget marker visible for today
   - [ ] Navigate to yesterday — budget marker hidden
   - [ ] Navigate back to today — budget marker reappears
   - [ ] Open dashboard, switch to another tab, wait a few seconds, switch back — no reset (same day, <1hr)
   - [ ] (Hard to test manually) Simulate day change by editing system clock

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-330 and FOO-331 to "In Progress" at start, "Done" at completion |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Activity data unavailable on past date | No budget marker (same as today without activity) | Existing tests cover this |
| `visibilitychange` not supported (SSR) | `document` check implicit — component is `'use client'` so always in browser | N/A |
| Rapid hidden/visible toggling | Each visible event independently checks conditions — no race condition risk | N/A |

## Risks & Open Questions

- [ ] **SWR global mutate and provider isolation in tests:** The `SWRConfig` wrapper in tests uses `provider: () => new Map()` which isolates caches. `globalMutate(() => true)` should work within this provider. If not, the test can verify behavior via mockFetch call counts instead.
- [ ] **Fake timers interaction with SWR:** SWR uses `setTimeout` internally. Tests may need `vi.advanceTimersByTimeAsync()` or `vi.runAllTimersAsync()` after triggering visibility changes to flush SWR operations.

## Scope Boundaries

**In Scope:**
- Hiding budget marker for past dates (FOO-330)
- Auto-resetting selectedDate on tab resume (FOO-331)
- Revalidating SWR caches on resume (FOO-331)

**Out of Scope:**
- Budget marker styling changes
- Persisting selectedDate across tab reloads
- Service worker / background sync
- Activity summary for past dates (existing behavior unchanged)

---

## Iteration 1

**Implemented:** 2026-02-12
**Method:** Agent team (1 worker)

### Tasks Completed This Iteration
- Task 1: Hide budget marker for past dates (FOO-330) - Conditionally pass budget to CalorieRing only when selectedDate is today using isToday() helper (worker-1)
- Task 2: Add visibility-change auto-reset to today (FOO-331) - Added useEffect with visibilitychange listener, lastActiveRef for tracking, globalMutate for SWR cache revalidation (worker-1)
- Task 3: Integration & Verification - Full test suite, lint, typecheck, build all pass (lead)

### Files Modified
- `src/components/daily-dashboard.tsx` - Added isToday import, useEffect/useSWRConfig imports, conditional budget prop, visibility-change handler with lastActiveRef
- `src/components/__tests__/daily-dashboard.test.tsx` - Added 5 new tests: 2 for budget marker visibility (today vs past date), 3 for visibility-change auto-reset (date change, 1hr+ idle, no reset within 1hr)

### Linear Updates
- FOO-330: Todo → In Progress → Review
- FOO-331: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 1374 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 1-2 (daily-dashboard component and tests)
- Lead: Task 3 (verification), bug-hunter, verifier

### Continuation Status
All tasks completed.

### Review Findings

Summary: 1 issue(s) found (Team: security, reliability, quality reviewers)
- CRITICAL: 0
- HIGH: 1
- MEDIUM: 1 (documented only)
- LOW: 1 (documented only)

**Issues requiring fix:**
- [HIGH] BUG: File input not reset on failed upload (`src/components/daily-dashboard.tsx:143-145`) — if upload fails, the file input retains the selected file, preventing onChange from firing on retry with the same file

**Documented (no fix needed):**
- [MEDIUM] TIMEOUT: No timeout on fetch POST to `/api/lumen-goals` (`src/components/daily-dashboard.tsx:129`) — general pattern throughout the app, not a regression from this iteration
- [LOW] TYPE: Untyped error response body (`src/components/daily-dashboard.tsx:135-136`) — optional chaining + fallback string provides adequate safety

### Linear Updates
- FOO-330: Review → Merge (original task completed)
- FOO-331: Review → Merge (original task completed)
- FOO-333: Created in Todo (Fix: file input not reset on failed upload)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-333](https://linear.app/lw-claude/issue/FOO-333/fix-file-input-not-reset-on-failed-lumen-goals-upload)

### Fix 1: File input not reset on failed Lumen goals upload
**Linear Issue:** [FOO-333](https://linear.app/lw-claude/issue/FOO-333/fix-file-input-not-reset-on-failed-lumen-goals-upload)

1. Write test in `src/components/__tests__/daily-dashboard.test.tsx` that simulates a failed upload, then verifies the file input value is reset (allowing re-selection of the same file)
2. Move the file input reset block (lines 143-145) from inside the `try` block to the `finally` block in `src/components/daily-dashboard.tsx`

---

## Iteration 2

**Implemented:** 2026-02-12
**Method:** Agent team (1 worker)

### Tasks Completed This Iteration
- Fix 1: File input not reset on failed Lumen goals upload (FOO-333) - Moved file input reset from try to finally block; added test for failed upload file input reset (worker-1)

### Files Modified
- `src/components/daily-dashboard.tsx` - Moved file input reset (`fileInputRef.current.value = ""`) from `try` block to `finally` block in handleLumenFileChange
- `src/components/__tests__/daily-dashboard.test.tsx` - Added test "resets file input value after failed Lumen goals upload"; fixed dead mock branch (GET condition matched by query param `?` instead of HTTP method string)

### Linear Updates
- FOO-333: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 MEDIUM bug (dead mock branch in test), fixed by lead before commit
- verifier: All 1375 tests pass, zero warnings

### Work Partition
- Worker 1: Fix 1 (daily-dashboard component and tests)
- Lead: Bug-hunter fix (test mock correction), verification

### Continuation Status
All tasks completed.

### Review Findings

Summary: 0 issue(s) requiring fix (Team: security, reliability, quality reviewers)
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 1 (documented only — duplicate of Iteration 1 finding)
- LOW: 0

**Documented (no fix needed):**
- [MEDIUM] ASYNC: No timeout on fetch POST to `/api/lumen-goals` (`src/components/daily-dashboard.tsx:129-131`) — duplicate of Iteration 1 documented finding; general pattern throughout the app, not a regression

### Linear Updates
- FOO-333: Review → Merge (fix verified)

<!-- REVIEW COMPLETE -->

---

## Skipped Findings Summary

Findings documented but not fixed across all review iterations:

| Severity | Category | File | Finding | Rationale |
|----------|----------|------|---------|-----------|
| MEDIUM | TIMEOUT | `src/components/daily-dashboard.tsx:129` | No timeout on fetch POST to `/api/lumen-goals` | General pattern throughout the app, not a regression from this plan |
| LOW | TYPE | `src/components/daily-dashboard.tsx:135-136` | Untyped error response body | Optional chaining + fallback string provides adequate safety |

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
- FOO-330: Merge
- FOO-331: Merge
- FOO-333: Merge
