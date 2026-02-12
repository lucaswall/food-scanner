# Implementation Plan

**Status:** IN_PROGRESS
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
