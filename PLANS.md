# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-686-dashboard-layout-cleanup
**Issues:** FOO-686, FOO-685, FOO-684
**Created:** 2026-02-20
**Last Updated:** 2026-02-20

## Summary

Restructure the dashboard layout to improve mobile UX: move the Lumen CTA banner from the page bottom to immediately after macro bars, move settings access from the header gear icon into the dashboard body as a button, and remove the "Food Scanner" title to reclaim vertical space.

## Issues

### FOO-686: Lumen goals CTA banner lost at bottom of dashboard — move below macro bars

**Priority:** High
**Labels:** Bug
**Description:** The "Set today's macro goals — Upload Lumen screenshot" blue banner is rendered in `page.tsx` after `DashboardShell`, placing it below all DailyDashboard content (calorie ring, macro bars, fasting card, meal breakdown, "Update Lumen goals" button). When the user has no goals set, this is the most important action on the screen but is completely lost.

**Acceptance Criteria:**
- [ ] LumenBanner renders immediately after MacroBars in the DailyDashboard (before FastingCard)
- [ ] LumenBanner only shows when viewing today's date (not past dates)
- [ ] LumenBanner still hides itself when goals exist for today
- [ ] LumenBanner no longer renders outside DashboardShell in page.tsx
- [ ] Weekly view does not show LumenBanner (it's daily-specific)

### FOO-685: Move settings access from header gear to button below "Update Lumen goals"

**Priority:** Medium
**Labels:** Improvement
**Description:** The gear icon in the top-right header is small and easy to miss. With the title being removed (FOO-684), the gear icon loses its anchor. Settings should be a full-width button placed below "Update Lumen goals" in the DailyDashboard body.

**Acceptance Criteria:**
- [ ] Settings gear icon removed from the dashboard header
- [ ] A settings button (navigating to /settings) appears below "Update Lumen goals" in DailyDashboard
- [ ] Settings button meets 44px touch target minimum
- [ ] HeaderActions component deleted (no longer used anywhere)

### FOO-684: Remove "Food Scanner" title from dashboard header

**Priority:** Low
**Labels:** Improvement
**Description:** The "Food Scanner" `<h1>` in the dashboard header takes up vertical space without adding value. The user already knows what app they're in.

**Acceptance Criteria:**
- [ ] "Food Scanner" heading removed from the dashboard page
- [ ] Header flex wrapper removed from page.tsx (becomes empty after FOO-685)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Move LumenBanner from page.tsx into DailyDashboard after MacroBars

**Issue:** FOO-686
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)
- `src/app/app/page.tsx` (modify)
- `src/app/app/__tests__/page.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update `daily-dashboard.test.tsx`:
   - Add a test: "renders LumenBanner after MacroBars when viewing today and no goals exist". Mock LumenBanner as a div with `data-testid="lumen-banner"`. Assert it appears in the rendered output when lumenGoals data returns `{ goals: null }` and selectedDate equals today.
   - Add a test: "does not render LumenBanner when viewing a past date". Navigate to previous day via DateNavigator, assert LumenBanner is not in the document.
   - Add a test: "does not render LumenBanner when lumen goals exist for today". Mock lumenGoals with valid goals, assert LumenBanner is not in the document.
   - Run: `npm test -- daily-dashboard`
   - Verify: Tests fail (LumenBanner not rendered yet)

2. **GREEN** — Update `daily-dashboard.tsx`:
   - Import `LumenBanner` from `@/components/lumen-banner`
   - Import `getTodayDate` (already imported) — use it to check `selectedDate === getTodayDate()`
   - After `MacroBars` and before `FastingCard`, conditionally render `<LumenBanner />` when `selectedDate === getTodayDate()` AND `lumenGoals` data has loaded AND `!lumenGoals?.goals`
   - The LumenBanner component already handles its own loading/error/hide states internally, but we add the date guard and goals guard at the parent level to avoid showing it on past dates or when goals exist
   - Run: `npm test -- daily-dashboard`
   - Verify: New tests pass

3. **RED** — Update `page.test.tsx`:
   - Remove the `vi.mock("@/components/lumen-banner"...)` mock
   - Remove the test "renders LumenBanner component after DashboardShell"
   - Run: `npm test -- app/__tests__/page`
   - Verify: Tests pass (mock removal is the change; if any test still references lumen-banner, it will fail)

4. **GREEN** — Update `page.tsx`:
   - Remove the `import { LumenBanner } from "@/components/lumen-banner"` line
   - Remove `<LumenBanner />` from the JSX
   - Run: `npm test -- app/__tests__/page`
   - Verify: All page tests pass

**Notes:**
- LumenBanner uses `getTodayDate()` internally for its SWR key. DailyDashboard also fetches lumenGoals with `selectedDate`. SWR deduplicates by key, so when viewing today both will share the same cache entry.
- The condition at the parent level (`selectedDate === getTodayDate() && !lumenGoals?.goals`) prevents rendering LumenBanner on past dates. LumenBanner's internal `data?.goals` check provides defense-in-depth.
- When `lumenGoals` is still loading (undefined), don't render LumenBanner — avoid a flash. Once data arrives and goals are null, show it.

### Task 2: Remove "Food Scanner" title and header wrapper from dashboard

**Issue:** FOO-684, FOO-685
**Files:**
- `src/app/app/page.tsx` (modify)
- `src/app/app/__tests__/page.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update `page.test.tsx`:
   - Remove the test "renders 'Food Scanner' heading"
   - Remove the test "renders HeaderActions component"
   - Remove the `vi.mock("@/components/header-actions"...)` mock
   - Add a test: "does not render a heading element" — assert `screen.queryByRole("heading")` returns null
   - Run: `npm test -- app/__tests__/page`
   - Verify: New test fails (heading still exists)

2. **GREEN** — Update `page.tsx`:
   - Remove `import { HeaderActions } from "@/components/header-actions"`
   - Remove the entire `<div className="flex items-center justify-between">` block (contains `<h1>` and `<HeaderActions />`)
   - Run: `npm test -- app/__tests__/page`
   - Verify: All tests pass

**Notes:**
- After this task, the page structure becomes: `SkipLink` → `main` → `FitbitStatusBanner` → `DashboardShell` → `DashboardPrefetch`
- The `SkipLink` still targets `#main-content` which remains on the `<main>` element

### Task 3: Add Settings button to DailyDashboard

**Issue:** FOO-685
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update `daily-dashboard.test.tsx`:
   - Add a test: "renders a Settings link below 'Update Lumen goals' button". Assert `screen.getByRole("link", { name: /settings/i })` exists with `href="/settings"`.
   - Add a test: "Settings link meets 44px touch target". Assert the link has `min-h-[44px]` class.
   - Add a test: "Settings link is full-width". Assert the link has `w-full` class.
   - Run: `npm test -- daily-dashboard`
   - Verify: Tests fail (no Settings link yet)

2. **GREEN** — Update `daily-dashboard.tsx`:
   - Import `Settings` icon from `lucide-react`
   - Import `Link` from `next/link` (already imported)
   - After the "Update Lumen goals" `<div className="flex flex-col gap-2">` block, add a new `Link` to `/settings` styled as a secondary button (use Button component with `asChild` or style a Link directly matching the existing button pattern)
   - The link should be full-width, have `min-h-[44px]`, use the Settings icon, and read "Settings"
   - Run: `npm test -- daily-dashboard`
   - Verify: Tests pass

**Notes:**
- Use `variant="ghost"` or `variant="outline"` to visually differentiate from the "Update Lumen goals" secondary button
- Reference the existing "Update Lumen goals" Button pattern for styling consistency
- The Settings icon is already used in `header-actions.tsx` — same import from lucide-react

### Task 4: Delete unused HeaderActions component

**Issue:** FOO-685
**Files:**
- `src/components/header-actions.tsx` (delete)
- `src/components/__tests__/header-actions.test.tsx` (delete)

**Steps:**

1. Delete `src/components/header-actions.tsx`
2. Delete `src/components/__tests__/header-actions.test.tsx`
3. Run: `npm test` — verify no test failures from missing imports
4. Run: `npm run typecheck` — verify no type errors from missing component

**Notes:**
- HeaderActions was only imported in `page.tsx` (removed in Task 2) and its own test file
- No other components import or reference it

### Task 5: Integration & Verification

**Issue:** FOO-686, FOO-685, FOO-684
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Dashboard loads without "Food Scanner" title
   - [ ] No gear icon in header
   - [ ] LumenBanner appears after macro bars (when no goals set)
   - [ ] LumenBanner disappears when navigating to a past date
   - [ ] "Update Lumen goals" button still works
   - [ ] Settings button appears below "Update Lumen goals"
   - [ ] Settings button navigates to /settings
   - [ ] Weekly view does not show LumenBanner

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| LumenBanner SWR error on past date | Banner not shown (date guard) | Unit test (Task 1) |
| LumenBanner SWR error on today | Banner shows upload prompt (existing behavior) | Existing unit test |
| Settings link click | Navigates to /settings | Unit test (Task 3) |

## Risks & Open Questions

- [ ] LumenBanner renders inside DailyDashboard but not WeeklyDashboard — acceptable since it's about "today's" goals which is daily-view-specific
- [ ] The LumenBanner in `page.tsx` was visible on both Daily and Weekly views. Moving it inside DailyDashboard means weekly users won't see it. This is the intended behavior per the issue description.

## Scope Boundaries

**In Scope:**
- Moving LumenBanner rendering position
- Removing dashboard title
- Relocating settings access from header to dashboard body
- Deleting unused HeaderActions component

**Out of Scope:**
- Changes to WeeklyDashboard layout
- Changes to LumenBanner internal logic (upload flow, styling)
- Changes to the /settings page itself
- Changes to BottomNav or other navigation elements

---

## Iteration 1

**Implemented:** 2026-02-20
**Method:** Single-agent (2 independent units, effort score 6 — worker overhead exceeds implementation time)

### Tasks Completed This Iteration
- Task 1: Move LumenBanner from page.tsx into DailyDashboard after MacroBars (FOO-686)
- Task 2: Remove "Food Scanner" title and header wrapper from dashboard (FOO-684, FOO-685)
- Task 3: Add Settings button to DailyDashboard (FOO-685)
- Task 4: Delete unused HeaderActions component (FOO-685)
- Task 5: Integration & Verification (FOO-686, FOO-685, FOO-684)

### Files Modified
- `src/components/daily-dashboard.tsx` — Added LumenBanner conditional rendering after MacroBars, added Settings link
- `src/components/__tests__/daily-dashboard.test.tsx` — Added LumenBanner placement tests (3) and Settings button tests (3), added LumenBanner mock
- `src/app/app/page.tsx` — Removed h1 heading, HeaderActions import, LumenBanner import, header flex wrapper
- `src/app/app/__tests__/page.test.tsx` — Removed heading/HeaderActions/LumenBanner tests and mocks, added "no heading" test
- `src/components/header-actions.tsx` — Deleted (no longer used)
- `src/components/__tests__/header-actions.test.tsx` — Deleted (component removed)
- `src/components/bottom-nav.tsx` — Removed unused TAB_PATHS import (lint fix)

### Linear Updates
- FOO-686: Todo → In Progress → Review
- FOO-685: Todo → In Progress → Review
- FOO-684: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 real bugs (missing earliest-entry mock in Settings tests, stale blank line), fixed before proceeding. 1 false positive (SWR deduplication concern — by design per plan notes).
- verifier: All 2105 tests pass, zero lint warnings, clean typecheck, clean build.

### Continuation Status
All tasks completed.
