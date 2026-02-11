# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-326-dashboard-always-visible
**Issues:** FOO-326, FOO-325
**Created:** 2026-02-11
**Last Updated:** 2026-02-11

## Summary

Fix two related UX issues on the main app page: (1) the dashboard hides completely when no food is logged, blocking access to calorie/macro goals and the "Update Lumen goals" button; (2) the Lumen banner doesn't appear reliably on initial page load, preventing users from setting daily macro goals.

FOO-326 is implemented first because it's simpler and unblocks the "Update Lumen goals" button as a workaround for FOO-325.

## Issues

### FOO-326: Show dashboard always

**Priority:** Medium
**Labels:** Improvement
**Description:** Dashboard component hides completely when no food is logged today. The empty state at `src/components/daily-dashboard.tsx:131-143` returns a "No food logged today" message instead of showing CalorieRing, MacroBars, activity budget, and "Update Lumen goals" button. Users expect to see their goals and current progress (0) even before logging food.

**Acceptance Criteria:**
- [ ] Dashboard always renders, even when no food is logged
- [ ] Calorie ring shows 0% progress with goal visible
- [ ] Macro bars show 0g with goal values visible (if Lumen goals are set)
- [ ] Fitbit activity budget displays (using 0 logged calories)
- [ ] "Update Lumen goals" button is always visible
- [ ] Lumen day type badge shows if goals are set
- [ ] Empty state message ("No food logged today") removed
- [ ] MealBreakdown section naturally absent when meals array is empty (it already returns null)

### FOO-325: Lumen banner doesn't appear on initial page load

**Priority:** Medium
**Labels:** Bug
**Description:** LumenBanner at `src/components/lumen-banner.tsx:30` returns `null` during `isLoading || !data`, making it invisible during the initial SWR fetch. The banner also doesn't destructure `error` from SWR, so fetch failures silently hide the banner. After navigating away and returning, SWR cache has data so the banner renders immediately.

**Acceptance Criteria:**
- [ ] Banner appears reliably on initial page load when no Lumen goals exist for today
- [ ] Up to 2-second delay is acceptable while fetching data (skeleton placeholder)
- [ ] Banner does not render prematurely (wait for data confirmation)
- [ ] Banner hides after Lumen goals are successfully set
- [ ] Fetch errors handled gracefully (show banner anyway — if we can't confirm goals exist, offer the upload)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Remove empty state from DailyDashboard

**Issue:** FOO-326
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update empty state tests to assert new behavior:
   - Modify the test "shows empty state when summary returns zero entries" to instead assert:
     - CalorieRing renders with 0 calories and the goal value
     - MacroBars renders with 0g values
     - "Update Lumen goals" button is visible
     - "No food logged today" text is NOT present
   - Modify the test "empty state includes link to scan food" to instead assert:
     - Dashboard components render (not empty state)
     - No `/app` link in the empty state context
   - Run: `npm test -- daily-dashboard`
   - Verify: Updated tests fail (empty state still rendered)

2. **GREEN** — Remove empty state block and use data directly:
   - Remove lines 131-143 (the `if (!summary || summary.meals.length === 0)` block)
   - Add a fallback for the `!summary` edge case: construct a zero-state totals object `{ calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }` and use it in place of `summary.totals` when summary is undefined
   - The `summary.meals` array (empty `[]`) is already handled by MealBreakdown which returns null for empty arrays
   - The budget calculation at line 151-153 already uses `summary.totals.calories` — with 0 value, it computes correctly: `caloriesOut - (estimatedCaloriesOut - goals.calories) - 0`
   - Run: `npm test -- daily-dashboard`
   - Verify: All tests pass

3. **REFACTOR** — Clean up:
   - Remove the `Link` import from `next/link` if no longer used in the component
   - Verify no dead code remains from the removed empty state

**Notes:**
- CalorieRing already handles 0 values: `progress = goal > 0 ? Math.min(0/goal, 1) : 0` → 0% progress, displays "0 / 2,000 cal"
- MacroBars already handles 0g: relative percent calculation handles `total = 0` (returns 0%), goal-based mode shows "0 / 120g"
- MealBreakdown returns null for empty meals array (line 47-49 of `meal-breakdown.tsx`) — no changes needed
- Reference existing component patterns in `src/components/calorie-ring.tsx` and `src/components/macro-bars.tsx`

### Task 2: Fix LumenBanner loading and error states

**Issue:** FOO-325
**Files:**
- `src/components/lumen-banner.tsx` (modify)
- `src/components/__tests__/lumen-banner.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update loading test and add error test:
   - Modify the test "returns null when loading" to instead assert that a Skeleton placeholder renders (matching the banner's approximate dimensions), not an empty container
   - Add a new test "shows banner when SWR returns error" that mocks `useSWR` returning `{ data: undefined, error: new Error('fetch failed'), isLoading: false, mutate: vi.fn() }` and asserts the banner's "Set today's macro goals" text is visible (generous: if we can't check goals, show the upload option)
   - Add a new test "returns null when data is undefined and no error (edge case)" for the scenario where `isLoading=false, data=undefined, error=undefined` — banner should render the skeleton (this is a transient SWR state)
   - Run: `npm test -- lumen-banner`
   - Verify: New/updated tests fail

2. **GREEN** — Implement loading skeleton and error handling:
   - Import `Skeleton` from `@/components/ui/skeleton`
   - Destructure `error` from the `useSWR` call (currently only destructures `data`, `isLoading`, `mutate`)
   - Replace the `if (isLoading || !data) return null;` with:
     - If `isLoading`: return a Skeleton placeholder matching the Alert banner dimensions (use Skeleton component with classes matching the Alert's min-height and width)
     - If `error` or `!data` (after loading): fall through to render the banner (generous approach — show upload option when state is uncertain)
   - Keep the `if (data.goals) return null;` check — only hide banner when we positively know goals exist
   - Add a null guard: only check `data.goals` when `data` is defined
   - Run: `npm test -- lumen-banner`
   - Verify: All tests pass

3. **REFACTOR** — Clean up:
   - Ensure the Skeleton placeholder has appropriate dimensions matching the Alert component
   - Verify no unused imports

**Notes:**
- The Skeleton component is already used in `src/components/daily-dashboard.tsx` — follow the same import pattern
- SWR deduplication: both LumenBanner and DailyDashboard fetch the same `/api/lumen-goals?date=${today}` key, so only one network request is made. The fix ensures the banner renders content during the shared fetch lifecycle.
- The generous error approach aligns with the single-user context: if the API fails, it's better to show the upload option than hide it

### Task 3: Integration and verification

**Issue:** FOO-326, FOO-325
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification scenarios:
   - [ ] Dashboard shows CalorieRing with 0/goal when no food logged
   - [ ] Dashboard shows MacroBars with 0g when no food logged
   - [ ] "Update Lumen goals" button visible when no food logged
   - [ ] Lumen banner shows skeleton then resolves on first page load
   - [ ] Lumen banner hides after goals are set
   - [ ] Navigating to /app/analyze and back shows banner immediately (cached)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-326, FOO-325 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Nutrition summary returns empty meals | Dashboard shows zero-state (ring, bars, button) | Unit test (Task 1) |
| Nutrition summary is undefined after loading | Dashboard uses zero-state fallback totals | Unit test (Task 1) |
| Lumen goals fetch fails | LumenBanner shows upload option anyway | Unit test (Task 2) |
| Lumen goals loading | LumenBanner shows Skeleton placeholder | Unit test (Task 2) |
| Lumen goals fetch succeeds with goals | LumenBanner hidden | Existing test (unchanged) |
| Lumen goals fetch succeeds without goals | LumenBanner shows upload prompt | Existing test (unchanged) |

## Risks & Open Questions

- [ ] MealBreakdown returns null for empty meals — verify no visual gap or spacing issue when MealBreakdown is absent from the dashboard layout (the `space-y-6` gap class on the parent div handles this naturally)
- [ ] SWR deduplication between LumenBanner and DailyDashboard — verify both components update when the shared fetch completes (covered by integration testing)

## Scope Boundaries

**In Scope:**
- Remove dashboard empty state, show zero-progress dashboard always
- Fix LumenBanner loading/error states to show skeleton then banner
- Update existing tests for both components

**Out of Scope:**
- Changes to MealBreakdown component (already handles empty array)
- Changes to CalorieRing or MacroBars (already handle zero values)
- Changes to API routes (data structure is correct)
- Changes to DashboardPrefetch component
- Service worker or offline support
