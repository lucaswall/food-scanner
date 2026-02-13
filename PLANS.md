# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-375-budget-marker-and-chat-ux
**Issues:** FOO-375, FOO-376, FOO-377
**Created:** 2026-02-13
**Last Updated:** 2026-02-13

## Summary

Three improvements: (1) Remove the broken budget marker from the calorie ring since Fitbit doesn't expose TDEE via API, (2) replace the hidden chat trigger with a proper CTA button, and (3) restructure the food chat as a full-screen view that replaces the analyzer instead of nesting inside it.

## Issues

### FOO-375: Budget marker on calorie ring uses wrong Fitbit field, producing incorrect position

**Priority:** Medium
**Labels:** Bug
**Description:** The budget marker (yellow tick) on the calorie ring uses `goals.caloriesOut` (the user's activity GOAL, e.g. 3,598) as the estimated daily burn instead of the actual estimated TDEE. Fitbit doesn't expose their proprietary TDEE projection via the API, so there's no reliable way to replicate their budget calculation. The marker produces incorrect positions (often negative budget, hidden behind consumed arc).

**Acceptance Criteria:**
- [ ] CalorieRing no longer accepts or renders a `budget` prop
- [ ] DailyDashboard no longer fetches `/api/activity-summary`
- [ ] Browser-facing `/api/activity-summary` route is deleted (no remaining consumer)
- [ ] `estimatedCaloriesOut` removed from `ActivitySummary` type
- [ ] `getActivitySummary` simplified to only return `caloriesOut`
- [ ] V1 API route updated for simplified type
- [ ] All related tests updated

### FOO-376: Full-screen chat replaces analysis view

**Priority:** Medium
**Labels:** Improvement
**Description:** The food chat is currently embedded as a small sub-panel inside the FoodAnalyzer component with a `max-h-[80vh]` constraint. It should take over the full viewport when opened, replacing the analyzer view entirely. Back button returns to analysis.

**Acceptance Criteria:**
- [ ] When chat is opened, it replaces the entire FoodAnalyzer UI (not nests inside it)
- [ ] Chat has a back/close button in header to return to analysis view
- [ ] Messages area fills available vertical space with proper scrolling
- [ ] Bottom area has: text input + send button, then meal type selector + "Log to Fitbit" button
- [ ] All controls remain accessible and touch-friendly (44px minimum)
- [ ] initialAnalysis and compressedImages passed via component state

### FOO-377: Replace hidden chat affordance with clear CTA button

**Priority:** Medium
**Labels:** Improvement
**Description:** After analysis completes, the chat is triggered by clicking a muted text div ("Add details or correct something...") that looks like a disabled text input. Replace with an explicit Button component.

**Acceptance Criteria:**
- [ ] Chat trigger is a proper `<Button>` with button semantics
- [ ] Uses secondary/outline variant (doesn't compete with "Log to Fitbit")
- [ ] Includes a chat/message icon for visual clarity
- [ ] Minimum 44px touch target
- [ ] Obviously interactive at a glance on mobile

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Remove budget marker from CalorieRing (FOO-375)

**Issue:** FOO-375
**Files:**
- `src/components/calorie-ring.tsx` (modify)
- `src/components/__tests__/calorie-ring.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update tests first:
   - Delete the entire `describe("budget marker", ...)` block (lines 106-201 in test file) — these tests verify behavior we're removing
   - Remove any test that passes a `budget` prop to `CalorieRing`
   - Add a test: `it("does not accept a budget prop")` — render `<CalorieRing calories={1000} goal={2000} />` and verify no `budget-marker` testid exists (this test already exists at line 113, but make it the canonical budget-free test)
   - Run: `npm test -- calorie-ring`
   - Verify: Tests fail because component still accepts budget prop (or some deleted tests cause issues)

2. **GREEN** — Remove budget from component:
   - Remove `budget` from `CalorieRingProps` interface
   - Remove `budgetPosition` calculation (lines 25-27)
   - Remove the entire budget marker SVG rendering block (lines 72-98)
   - Run: `npm test -- calorie-ring`
   - Verify: All remaining tests pass

3. **REFACTOR** — Clean up:
   - Remove `isAtOrOverGoal` variable if it's no longer used (it was only used by the budget marker conditional)
   - Verify `isOverGoal` is still used for the text-destructive class

**Notes:**
- The `isAtOrOverGoal` check (`calories >= goal`) is only used in the budget marker conditional render. After removal, only `isOverGoal` (`calories > goal`) remains for the over-goal text styling.
- Reference existing pattern: the "over-goal visual indicators" tests should remain unchanged.

---

### Task 2: Remove activity data fetching from DailyDashboard (FOO-375)

**Issue:** FOO-375
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update tests:
   - Remove all mock fetch responses for `/api/activity-summary` in test fixtures
   - Remove the budget-related test cases (any test asserting budget marker presence or budget calculation behavior)
   - Remove the `activityError` display test cases (Fitbit permissions warning)
   - Remove the `ActivitySummary` import from the test file
   - Update remaining tests that mock `/api/activity-summary` in their fetch setup — remove those URL handlers from mock fetch implementations
   - Run: `npm test -- daily-dashboard`
   - Verify: Tests fail because component still fetches activity-summary and passes budget

2. **GREEN** — Remove activity from dashboard:
   - Remove the `useSWR<ActivitySummary>` call for `/api/activity-summary`
   - Remove the `ActivitySummary` import from types
   - Remove the `budget` calculation (line 191-193)
   - Remove `budget` prop from `<CalorieRing>` (just pass `calories` and `goal`)
   - Remove the `activityError` display block (lines 236-245)
   - Remove unused imports: `ActivitySummary` from `@/types`
   - Run: `npm test -- daily-dashboard`
   - Verify: All remaining tests pass

3. **REFACTOR** — Verify no dead code remains related to activity/budget in the component.

**Notes:**
- The `activityError` block showed "Fitbit permissions need updating" — this only matters if we're fetching activity data. Since we're not, no need to display it.
- The CalorieRing still renders with `calories` and `goal` props (from nutrition-summary and nutrition-goals). No visual regression on the ring itself.
- Many test fixtures include `/api/activity-summary` in their mock fetch — all of these need updating.

---

### Task 3: Delete browser-facing activity-summary route and simplify types (FOO-375)

**Issue:** FOO-375
**Files:**
- `src/app/api/activity-summary/route.ts` (delete)
- `src/app/api/activity-summary/__tests__/route.test.ts` (delete)
- `src/types/index.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/app/api/v1/activity-summary/route.ts` (no change needed — auto-inherits simplified type)
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update types and lib tests:
   - In `src/types/index.ts`: remove `estimatedCaloriesOut` from `ActivitySummary` interface (keep only `caloriesOut`)
   - In `src/lib/__tests__/fitbit.test.ts`: update the `getActivitySummary` tests — assertions should no longer include `estimatedCaloriesOut` in the returned object. Remove the test case that verifies `estimatedCaloriesOut` falls back to `summary.caloriesOut` when goals is missing (line ~1376)
   - Run: `npm test -- fitbit.test`
   - Verify: Tests fail because `getActivitySummary` still returns `estimatedCaloriesOut`

2. **GREEN** — Simplify the function:
   - In `src/lib/fitbit.ts` `getActivitySummary`: remove `estimatedCaloriesOut` from the return object, remove the `goals` parsing logic (lines 551-554), just return `{ caloriesOut: summary.caloriesOut }`
   - Run: `npm test -- fitbit.test`
   - Verify: All remaining tests pass

3. **Delete browser-facing route:**
   - Delete `src/app/api/activity-summary/route.ts`
   - Delete `src/app/api/activity-summary/__tests__/route.test.ts`
   - Delete the `src/app/api/activity-summary/` directory

4. **Update v1 route tests:**
   - In `src/app/api/v1/activity-summary/__tests__/route.test.ts`: remove `estimatedCaloriesOut` from mock return values and assertions
   - Run: `npm test -- v1/activity-summary`
   - Verify: V1 route tests pass with simplified type

5. **REFACTOR** — Run full test suite to catch any remaining references.

**Notes:**
- The v1 route (`/api/v1/activity-summary`) still has value — it returns `caloriesOut` (actual calories burned so far today) to external API consumers.
- Removing `estimatedCaloriesOut` from the v1 response is a breaking change for external clients, but this is a single-user app — acceptable.
- The `getActivitySummary` function return type is `Promise<import("@/types").ActivitySummary>` — it auto-inherits the simplified interface.

---

### Task 4: Replace chat hint div with CTA button (FOO-377)

**Issue:** FOO-377
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write test for CTA button:
   - Add test: after analysis completes, a button with text containing "Refine" (or similar) should be rendered
   - Assert the element is a `<button>` (proper semantics), not a `<div>`
   - Assert the old "Add details or correct something..." text no longer appears
   - Run: `npm test -- food-analyzer.test`
   - Verify: Test fails because the div still exists

2. **GREEN** — Replace the div:
   - In `src/components/food-analyzer.tsx` lines 502-510: replace the `<div>` chat hint with a `<Button>` component
   - Use `variant="outline"` so it doesn't compete with the primary "Log to Fitbit" button
   - Add a `MessageSquare` icon from lucide-react for visual clarity
   - Button text: "Refine with chat" or similar
   - Keep `onClick={() => setChatOpen(true)}` behavior
   - Ensure `min-h-[44px]` for touch target
   - Import `MessageSquare` from `lucide-react`
   - Run: `npm test -- food-analyzer.test`
   - Verify: Tests pass

3. **REFACTOR** — Ensure the button layout flows well with the existing "Log to Fitbit" button below it. Consider `w-full` for consistency.

**Notes:**
- The `MessageSquare` icon from lucide-react is already available in the project (lucide-react is a dependency).
- Pattern reference: the "Log to Fitbit" button at line 543 uses `className="w-full min-h-[44px]"` — follow the same pattern.
- The CTA button should be visually distinct but secondary to the primary action (logging).

---

### Task 5: Restructure FoodChat as full-screen view (FOO-376)

**Issue:** FOO-376
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update tests for new layout:
   - Update tests that assert `max-h-[80vh]` or inline layout — the chat should now fill its container
   - Add test: header renders a back button (via `onClose`) with an `ArrowLeft` icon instead of `X`
   - Add test: "Log to Fitbit" button and meal type selector are rendered in the bottom pinned area
   - Add test: input bar with text input and send button exists in bottom area
   - Run: `npm test -- food-chat`
   - Verify: Tests fail

2. **GREEN** — Redesign the component layout:
   - Remove `max-h-[80vh]` constraint — use `h-full` or `min-h-screen` or `flex flex-col` that fills its parent
   - Header: replace `X` close icon with `ArrowLeft` icon, keep "Chat about your food" title
   - Messages area: `flex-1 overflow-y-auto` to fill available space
   - Bottom pinned area (reorder):
     - First row: text input + send button (camera icon optional)
     - Second row: meal type selector
     - Third row: "Log to Fitbit" button (full width)
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

3. **REFACTOR** — Clean up:
   - Remove any vestigial inline-chat styling
   - Ensure the component is clean and uses Tailwind classes for full-viewport behavior
   - Import `ArrowLeft` from lucide-react (replace `X` import)

**Notes:**
- The parent container (FoodAnalyzer) will be responsible for giving FoodChat full viewport space — see Task 6.
- The `onClose` callback returns the user to the analysis view — behavior is the same, just the icon changes from X to back arrow.
- The current PhotoCapture in the input bar has a placeholder `onPhotosChange` callback — keep as-is, it's future functionality.
- The bottom controls should use `border-t` for visual separation and `p-4 space-y-3` for spacing (matching current pattern).

---

### Task 6: Wire full-screen chat into FoodAnalyzer (FOO-376)

**Issue:** FOO-376
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write test for full-screen behavior:
   - Add test: when chatOpen is true, the FoodAnalyzer renders ONLY the FoodChat component (PhotoCapture, DescriptionInput, AnalysisResult, and post-analysis controls are NOT in the DOM)
   - Add test: when chatOpen is false (after analysis), the normal analyzer UI is shown
   - Run: `npm test -- food-analyzer.test`
   - Verify: Tests fail because currently FoodChat is rendered alongside analysis content

2. **GREEN** — Restructure conditional rendering:
   - Currently: when `chatOpen && analysis`, FoodChat is rendered inside the `space-y-6` div alongside analysis result (line 491-553)
   - New behavior: when `chatOpen && analysis`, return ONLY `<FoodChat>` at the top level (early return, similar to the `logResponse` and `resubmitting` early returns)
   - Move the `chatOpen` check BEFORE the main return, after the `logResponse` check (around line 403-416)
   - Give FoodChat a container that fills the available space (the parent page provides the viewport)
   - Run: `npm test -- food-analyzer.test`
   - Verify: Tests pass

3. **REFACTOR** — Clean up:
   - The food matches section already has `!chatOpen` guard (line 476) — this can be simplified/removed since when chatOpen is true, we early-return before reaching it
   - Ensure the FoodChat container has appropriate height classes for full-screen feel

**Notes:**
- The early-return pattern is already used for `resubmitting` (line 391-400) and `logResponse` (line 403-416). Follow the same pattern.
- When returning from chat (onClose), the analysis state is preserved — the user sees their analysis result again with the CTA button and log controls.
- The `compressedImages` state is already maintained across the chat toggle.

---

### Task 7: Integration & Verification

**Issue:** FOO-375, FOO-376, FOO-377
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify zero warnings in all of the above
6. Manual verification checklist:
   - [ ] CalorieRing renders without any budget marker
   - [ ] Dashboard loads without fetching activity-summary
   - [ ] After analysis, a proper "Refine with chat" button appears (not a muted div)
   - [ ] Clicking the button opens full-screen chat (replaces the analyzer view)
   - [ ] Back button in chat returns to analysis view
   - [ ] Chat messages scroll properly in full-screen layout
   - [ ] "Log to Fitbit" button works from both the analysis view and the chat view
   - [ ] Meal type selector works in both views

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| CalorieRing rendered without goal | Graceful zero display | Existing unit test |
| Chat API returns error | Error displayed in chat message area | Existing unit test |
| FoodChat onClose called | Returns to analysis view with state preserved | New unit test (Task 6) |
| Log from chat fails | Error shown in chat bottom area | Existing unit test |

## Risks & Open Questions

- [ ] The v1 activity-summary API response changes (removes `estimatedCaloriesOut`) — this is a breaking change for external consumers. Acceptable for a single-user app.
- [ ] Full-screen chat on desktop may look stretched — but this is a mobile-first app, so desktop is secondary.

## Scope Boundaries

**In Scope:**
- Remove budget marker and all related activity data fetching
- Replace chat trigger div with proper CTA button
- Restructure chat as full-screen view replacing analyzer
- Update all affected tests

**Out of Scope:**
- Adding new camera functionality in chat (PhotoCapture in chat is a placeholder)
- Chat message persistence across sessions
- Any changes to the chat API (`/api/chat-food`)
- Any changes to the food analysis API
