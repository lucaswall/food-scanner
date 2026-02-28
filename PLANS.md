# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-690-quick-select-stale-data-and-improvements
**Issues:** FOO-690, FOO-689, FOO-688
**Created:** 2026-02-28
**Last Updated:** 2026-02-28

## Summary

Three improvements to food browsing UX: fix a bug where quick-select tabs show stale data after toggling, consolidate duplicated time formatting into a shared 24h utility, and replace the history page's manual "Load More" button with automatic infinite scroll matching the quick-select pattern.

## Issues

### FOO-690: Quick-select tab switching shows stale data after toggling Suggested/Recent

**Priority:** High
**Labels:** Bug
**Description:** Switching between Suggested and Recent tabs in quick-select does not update the food list. After toggling tabs, the displayed foods remain stale. Root cause: `useSWRInfinite` is configured with `keepPreviousData: true` (line 87 of `src/components/quick-select.tsx`), which retains the previous tab's data while revalidating. Combined with `revalidateFirstPage: true`, the old data persists visually until revalidation completes — and if the response shape is similar, users see no change.

**Acceptance Criteria:**
- [ ] Switching from Suggested to Recent shows foods ordered by most recently logged
- [ ] Switching back to Suggested restores the time-of-day ranked list
- [ ] Rapid tab toggling does not cause stale or mixed data
- [ ] Existing infinite scroll continues working after tab switch

### FOO-689: Switch all user-facing times to 24h format and consolidate formatTime()

**Priority:** Medium
**Labels:** Improvement
**Description:** All user-facing times display in 12-hour AM/PM format. Should be 24-hour (HH:MM). Additionally, 4 separate components define their own local time formatting functions with duplicated logic.

Components with 12h time formatting:
- `src/components/meal-type-selector.tsx:22` — `formatTime()` using `toLocaleTimeString()` with `hour12: true`
- `src/components/food-detail.tsx:26` — `formatTime()` with manual `hour % 12` parsing
- `src/components/food-history.tsx:43` — `formatTime()` with manual `hour % 12` parsing
- `src/components/fasting-card.tsx:20` — `formatTime12Hour()` with manual `hours >= 12` parsing

**Acceptance Criteria:**
- [ ] All 4 components display times in HH:MM 24-hour format (no AM/PM)
- [ ] New shared `formatTime()` function added to `src/lib/date-utils.ts`
- [ ] All 4 components import and use the shared utility (remove local functions)
- [ ] `src/lib/chat-tools.ts` internal formatting unchanged
- [ ] Unit tests for the new shared `formatTime()` function

### FOO-688: Replace history Load More button with infinite scroll (like quick-select)

**Priority:** Medium
**Labels:** Improvement
**Description:** The food history page uses a manual "Load More" button for pagination, while quick-select uses automatic infinite scroll. History should match the quick-select pattern. The API already supports cursor-based pagination — no backend changes needed.

**Acceptance Criteria:**
- [ ] History entries auto-load when scrolling near the bottom (IntersectionObserver + sentinel pattern)
- [ ] Switch from `useSWR` to `useSWRInfinite` for page management
- [ ] Remove "Load More" button, replace with loading spinner sentinel
- [ ] Jump-to-date picker preserved — selecting a date resets scroll position and loads from that date, then infinite scroll continues loading older entries from there
- [ ] Existing entry grouping by date with daily calorie totals preserved
- [ ] Detail modal and delete functionality unaffected

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm install` up to date

## Implementation Tasks

### Task 1: Fix quick-select tab stale data

**Issue:** FOO-690
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test to `quick-select.test.tsx` that:
   - Renders QuickSelect with Suggested tab data
   - Clicks the "Recent" tab button
   - Asserts that the food list updates to show recent-tab data (different from suggested)
   - Currently this test will fail because `keepPreviousData: true` causes stale data to persist

2. **GREEN** — Fix `quick-select.tsx`:
   - Remove `keepPreviousData: true` from the `useSWRInfinite` options object (line 87). This is the root cause — it tells SWR to show the old key's data while the new key revalidates, making tab switches appear to do nothing.
   - Alternatively, if removing `keepPreviousData` causes a flash of empty state during tab switch, consider keeping it but adding an `onTabChange` handler that calls `mutate(undefined, { revalidate: true })` to force-clear cached pages before switching. Test both approaches.
   - Verify that `getKey` correctly generates different URLs for each tab (it does — line 69-71 already branches on `activeTab`).

3. **REFACTOR** — Ensure no regressions: infinite scroll still works, search still works, loading states are correct.

**Run:** `npx vitest run quick-select`

**Notes:**
- The `getKey` callback already depends on `activeTab` in its dependency array (line 76), so the key function itself is correct.
- The issue is purely in how SWR handles the transition between key sets.
- Reference: SWR `keepPreviousData` docs — it's designed for smooth transitions but breaks when the user expects an immediate visual switch.

---

### Task 2: Create shared formatTime utility in date-utils

**Issue:** FOO-689
**Files:**
- `src/lib/date-utils.ts` (modify)
- `src/lib/__tests__/date-utils.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests to `date-utils.test.ts` for a new `formatTime()` function:
   - `formatTime("14:30")` → `"14:30"` (already 24h, just strips seconds if present)
   - `formatTime("09:05")` → `"09:05"` (preserves leading zero)
   - `formatTime("00:00")` → `"00:00"` (midnight)
   - `formatTime("23:59")` → `"23:59"` (end of day)
   - `formatTime(null)` → `""` (null input returns empty string)
   - `formatTime("14:30:00")` → `"14:30"` (strips seconds)
   - Also test a `formatTimeFromDate(date: Date)` variant that takes a Date object (used by `meal-type-selector.tsx` which formats `new Date()`)

2. **GREEN** — Add `formatTime(time: string | null): string` and `formatTimeFromDate(date: Date): string` to `src/lib/date-utils.ts`:
   - `formatTime`: Takes an `HH:MM` or `HH:MM:SS` string, returns `HH:MM` in 24h format. Returns `""` for null.
   - `formatTimeFromDate`: Takes a Date object, returns `HH:MM` in 24h format using `getHours()` and `getMinutes()` with zero-padding.

3. **REFACTOR** — Export both functions from date-utils.

**Run:** `npx vitest run date-utils`

**Notes:**
- The input format is already 24h (the DB stores `HH:MM:SS`, API returns `HH:MM` or `HH:MM:SS`). The function mainly standardizes the format and replaces the 12h conversion logic.
- Pattern reference: existing functions in `src/lib/date-utils.ts` (e.g., `getTodayDate`, `formatDisplayDate`).

---

### Task 3: Replace local formatTime functions in all 4 components

**Issue:** FOO-689
**Files:**
- `src/components/meal-type-selector.tsx` (modify)
- `src/components/food-detail.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/fasting-card.tsx` (modify)
- `src/components/__tests__/meal-type-selector.test.tsx` (modify)
- `src/components/__tests__/food-detail.test.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)
- `src/components/__tests__/fasting-card.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update existing tests in each component's test file to expect 24h format instead of 12h AM/PM:
   - `meal-type-selector.test.tsx`: Any assertions checking time display should expect `HH:MM` format (e.g., `"14:30"` instead of `"2:30 PM"`)
   - `food-detail.test.tsx`: Update assertions for time display (e.g., `"14:30"` instead of `"2:30 PM"`)
   - `food-history.test.tsx`: Update assertions for time display in entry rows
   - `fasting-card.test.tsx`: Update assertions for fasting window times (e.g., `"Since 20:30"` instead of `"Since 8:30 PM"`)

2. **GREEN** — In each component:
   - Delete the local `formatTime()` / `formatTime12Hour()` function
   - Import `formatTime` (or `formatTimeFromDate` for meal-type-selector) from `@/lib/date-utils`
   - Replace all call sites to use the imported function
   - Specific changes per component:
     - `meal-type-selector.tsx`: Replace local `formatTime(date: Date)` at line 22-28 with imported `formatTimeFromDate`. Update the usage at line 83.
     - `food-detail.tsx`: Replace local `formatTime(time: string | null)` at line 26-33 with imported `formatTime`. Usage at line 101.
     - `food-history.tsx`: Replace local `formatTime(time: string | null)` at line 43-50 with imported `formatTime`. Usage at line 363.
     - `fasting-card.tsx`: Replace local `formatTime12Hour(time24: string)` at line 20-24 with imported `formatTime`. Usages at lines 99, 114, 114.

3. **REFACTOR** — Verify no dead imports remain. Run all 4 component test files.

**Run:** `npx vitest run meal-type-selector food-detail food-history fasting-card`

**Notes:**
- `fasting-card.tsx` calls its function as `formatTime12Hour(window.lastMealTime)` where `lastMealTime` is always a non-null string. The shared `formatTime` accepts `string | null`, so the call is type-compatible.
- `meal-type-selector.tsx` uses a Date object input, so it needs `formatTimeFromDate` not `formatTime`.

---

### Task 4: Convert food-history from useSWR to useSWRInfinite

**Issue:** FOO-688
**Files:**
- `src/components/food-history.tsx` (modify — major rewrite)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update food-history tests to reflect the new infinite scroll architecture:
   - Remove tests that assert "Load More" button behavior
   - Add tests for the infinite scroll sentinel element being present when `hasMore` is true
   - Add test for loading spinner appearing in the sentinel during pagination
   - Preserve tests for: date grouping, date picker "Jump to date", delete functionality, entry detail dialog, empty state

2. **GREEN** — Rewrite `FoodHistory` component to use `useSWRInfinite`:
   - Replace `useSWR` import with `useSWRInfinite` from `swr/infinite`
   - Remove all manual state management: `entries`, `loading`, `loadingMore`, `hasMore`, `hasPaginated` ref, `abortControllerRef`, `fetchEntries` callback
   - Add a `getKey` callback similar to quick-select's pattern:
     - Page 0: `/api/food-history?limit=20` (plus `&endDate=...` if jump-to-date is active)
     - Page N: Use `lastDate`, `lastTime`, `lastId` from the last entry of the previous page as cursor params
     - Return `null` when previous page returned fewer than 20 entries (no more data)
   - Use `useSWRInfinite<{ entries: FoodLogHistoryEntry[] }>` — the API returns `{ entries: [...] }` via `conditionalResponse`
   - Derive `entries` by flatMapping all pages: `pages?.flatMap(p => p.entries) ?? []`
   - Derive `hasMore` from last page having 20 entries
   - Add IntersectionObserver on a sentinel `<div>` (follow quick-select pattern at lines 102-118)
   - Replace "Load More" button with sentinel div + spinner
   - Jump-to-date: store `endDate` in state, include it in `getKey` base URL. On date change, reset SWR state by calling `mutate(undefined)` and updating `endDate`.
   - Delete: after successful delete, call the `mutate()` from `useSWRInfinite` to revalidate all pages. Remove `invalidateFoodCaches()` call or keep it for cross-component cache invalidation.
   - Keep `groupByDate()` and `formatDateHeader()` helper functions (they operate on the derived `entries` array).

3. **REFACTOR** — Clean up removed state variables and ensure the component is simpler than before. The manual `fetchEntries` function with AbortController is no longer needed since SWR handles fetching/cancellation.

**Run:** `npx vitest run food-history`

**Notes:**
- The API route (`src/app/api/food-history/route.ts`) already supports cursor-based pagination via `lastDate`, `lastTime`, `lastId` query params — no backend changes needed.
- Reference implementation: `src/components/quick-select.tsx` lines 65-118 for the `useSWRInfinite` + IntersectionObserver pattern.
- The cursor for food-history is a composite `{lastDate, lastTime, lastId}` (3 separate query params), unlike quick-select which uses a JSON-encoded cursor. Build the cursor from the last entry in each page.
- `apiFetcher` from `@/lib/swr.ts` already unwraps `result.data`, so `useSWRInfinite` pages will receive `{ entries: [...] }` directly.
- `SWRConfig` wrapper with `dedupingInterval: 0` may be needed in tests to prevent SWR caching between test cases (follow the pattern in `quick-select.test.tsx`).

---

### Task 5: Integration & Verification

**Issue:** FOO-690, FOO-689, FOO-688
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification steps:
   - [ ] Quick-select: toggle Suggested/Recent tabs rapidly — data should update immediately
   - [ ] Quick-select: infinite scroll still loads more foods when scrolling down
   - [ ] Quick-select: search still works after tab switching
   - [ ] Food history: scroll to bottom — new entries auto-load
   - [ ] Food history: use date picker to jump to a past date — entries load from that date, then infinite scroll continues loading older entries
   - [ ] Food history: delete an entry — list updates correctly
   - [ ] Food history: tap entry to see detail dialog — still works
   - [ ] All time displays show 24h format (HH:MM, no AM/PM)
   - [ ] Meal type selector shows current time in 24h format
   - [ ] Fasting card shows fasting window times in 24h format

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| API returns error during infinite scroll | Error message shown, sentinel stops loading | Unit test |
| Tab switch during in-flight request | Previous request ignored, new tab data shown | Unit test |
| Jump-to-date with invalid date | Button disabled when no date selected | Existing test |
| Delete fails during infinite scroll view | Error banner shown, entries unchanged | Existing test |
| Null time value in history entry | Empty string displayed (no crash) | Unit test |

## Risks & Open Questions

- [ ] Removing `keepPreviousData` from quick-select may cause a brief flash of empty state when switching tabs. If this is visually jarring, an alternative approach is to clear the cache explicitly on tab switch while keeping the option. Test both approaches.
- [ ] The food-history IntersectionObserver approach requires the scroll container to be the viewport (not a nested scrollable div). Verify the history page layout doesn't use a fixed-height container that would prevent the sentinel from intersecting.

## Scope Boundaries

**In Scope:**
- Fix stale tab data in quick-select (FOO-690)
- Consolidate time formatting to 24h shared utility (FOO-689)
- Replace history Load More with infinite scroll (FOO-688)

**Out of Scope:**
- Backend API changes (not needed — cursor pagination already supported)
- Other pagination improvements beyond matching quick-select pattern
- Changing time format in non-user-facing code (e.g., `chat-tools.ts`)
