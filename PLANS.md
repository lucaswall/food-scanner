# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-345-weekly-nutrition-chart
**Issues:** FOO-345, FOO-346, FOO-347
**Created:** 2026-02-12
**Last Updated:** 2026-02-12

## Summary

Replace the separate weekly calorie chart and macro averages components with a unified nutrition chart featuring a metric selector (Calories/Protein/Carbs/Fat), per-day bars with goal dashed lines, a goal consistency indicator ("5/7 days on target"), and a net weekly surplus/deficit summary. This requires extending the data layer to include macro goals from the lumen_goals table in the date-range nutrition response.

## Issues

### FOO-345: Weekly dashboard: per-day macro bars with metric selector

**Priority:** Medium
**Labels:** Feature
**Description:** The weekly macro averages component shows aggregated averages for protein/carbs/fat, which isn't actionable. Replace it (and the calorie chart) with a unified chart component that shows per-day bars for a selectable metric (calories/protein/carbs/fat), each with a goal dashed line. Requires adding `getLumenGoalsByDateRange()` to the lumen module and extending `DailyNutritionTotals` with macro goal fields.

**Acceptance Criteria:**
- [ ] Metric selector with 4 options: Calories, Protein, Carbs, Fat
- [ ] Per-day bars (Sunday-Saturday) for the selected metric
- [ ] Goal dashed line per day when a goal exists for the selected metric
- [ ] Green bar when actual <= goal, amber when actual > goal, primary when no goal
- [ ] Empty state message when no data
- [ ] Old `weekly-calorie-chart.tsx` and `weekly-macro-averages.tsx` deleted

### FOO-346: Weekly dashboard: goal consistency indicator

**Priority:** Low
**Labels:** Feature
**Description:** Add a small text indicator above the chart showing how many days the user hit their goal for the selected metric (e.g., "5/7 days on target"). Only count days with logged data. Updates when the metric selector changes.

**Acceptance Criteria:**
- [ ] Shows "N/M days on target" text above chart bars
- [ ] Only counts days with calories > 0 (logged data)
- [ ] Updates dynamically when metric changes
- [ ] Hidden when no goals exist for the selected metric

### FOO-347: Weekly dashboard: net surplus/deficit summary

**Priority:** Low
**Labels:** Feature
**Description:** Show a weekly net surplus/deficit below the chart: sum of (actual - goal) across all days with data. Display as "+120 kcal over" or "-50g under". Color-coded: green for on/under target, amber/red for over. Updates when the metric selector changes.

**Acceptance Criteria:**
- [ ] Shows net surplus/deficit below chart
- [ ] Calculation: sum of (actual - goal) only for days with both data and a goal
- [ ] Unit-aware labels: "kcal" for calories, "g" for macros
- [ ] Green text when net is at or under target, amber when over
- [ ] Updates dynamically when metric changes
- [ ] Hidden when no goals exist for the selected metric

## Prerequisites

- [ ] Database has lumen_goals table with per-day macro goals (already exists)
- [ ] Database has daily_calorie_goals table (already exists)

## Implementation Tasks

### Task 1: Add getLumenGoalsByDateRange to lumen module

**Issue:** FOO-345
**Files:**
- `src/lib/__tests__/lumen.test.ts` (modify)
- `src/lib/lumen.ts` (modify)

**TDD Steps:**

1. **RED** — Write a test for `getLumenGoalsByDateRange(userId, fromDate, toDate)` that returns an array of `{ date, proteinGoal, carbsGoal, fatGoal }` objects. Mock the DB to return rows for dates in the range. Follow the existing mock pattern in `src/lib/__tests__/lumen.test.ts` (mock `getDb`, chain `.select().from().where().orderBy()`).
   - Run: `npm test -- lumen`
   - Verify: Test fails — function doesn't exist yet.

2. **GREEN** — Implement `getLumenGoalsByDateRange` in `src/lib/lumen.ts`. Pattern to follow: `getCalorieGoalsByDateRange` in `src/lib/nutrition-goals.ts` (uses `between()` filter on date column, `orderBy(asc(date))`). Query `lumenGoals` table selecting `date`, `proteinGoal`, `carbsGoal`, `fatGoal` where `userId = X` and `date BETWEEN fromDate AND toDate`, ordered by date ascending.
   - Run: `npm test -- lumen`
   - Verify: Test passes.

3. **REFACTOR** — No significant refactoring expected.

**Notes:**
- The function signature: `getLumenGoalsByDateRange(userId: string, fromDate: string, toDate: string): Promise<Array<{ date: string; proteinGoal: number; carbsGoal: number; fatGoal: number }>>`
- Import `between` and `asc` from drizzle-orm (already imported in the file: `and`, `eq` — add the new ones).

---

### Task 2: Extend DailyNutritionTotals with macro goal fields

**Issue:** FOO-345
**Files:**
- `src/types/index.ts` (modify)

**Steps:**

1. Add three new optional fields to the `DailyNutritionTotals` interface:
   - `proteinGoalG: number | null`
   - `carbsGoalG: number | null`
   - `fatGoalG: number | null`

2. This is a type-only change. Existing consumers that construct `DailyNutritionTotals` objects will get TypeScript errors — those are fixed in Tasks 3 and 7.

**Notes:**
- Follow the naming convention of existing field `calorieGoal` — the new fields use the `G` suffix matching `proteinG`, `carbsG`, `fatG`.

---

### Task 3: Update getDateRangeNutritionSummary to include macro goals

**Issue:** FOO-345
**Files:**
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/lib/food-log.ts` (modify)

**TDD Steps:**

1. **RED** — Add a test for `getDateRangeNutritionSummary` that verifies macro goals are included in the returned `DailyNutritionTotals[]`. Mock `getLumenGoalsByDateRange` (from `@/lib/lumen`) to return goals for specific dates. Assert that the returned objects have `proteinGoalG`, `carbsGoalG`, `fatGoalG` fields populated from the lumen goals, and `null` for dates without lumen goals.
   - Run: `npm test -- food-log`
   - Verify: Test fails — function doesn't yet merge macro goals.

2. **GREEN** — In `getDateRangeNutritionSummary` (`src/lib/food-log.ts`):
   - Import `getLumenGoalsByDateRange` from `@/lib/lumen`
   - After the existing `getCalorieGoalsByDateRange` call, also call `getLumenGoalsByDateRange(userId, fromDate, toDate)`
   - Create a `Map<string, { proteinGoal, carbsGoal, fatGoal }>` from the results
   - When building the result array, merge macro goals: `proteinGoalG: macroGoalsByDate.get(date)?.proteinGoal ?? null`, etc.
   - Run: `npm test -- food-log`
   - Verify: Test passes.

3. **REFACTOR** — No significant refactoring expected.

**Notes:**
- Pattern: matches how calorie goals are already merged (lines 840-851 of `src/lib/food-log.ts`).
- The two goal queries (`getCalorieGoalsByDateRange` and `getLumenGoalsByDateRange`) can run in parallel with `Promise.all` for a minor efficiency gain.

---

### Task 4: Create unified WeeklyNutritionChart component with metric selector

**Issue:** FOO-345
**Files:**
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (create)
- `src/components/weekly-nutrition-chart.tsx` (create)

**TDD Steps:**

1. **RED** — Write tests for `WeeklyNutritionChart`:
   - Renders metric selector with 4 options: Calories, Protein, Carbs, Fat
   - Defaults to "Calories" selected
   - Renders 7 day columns (S M T W T F S) like the existing calorie chart
   - Shows bars scaled to max value for the selected metric
   - Shows goal dashed markers when goal exists for the selected metric
   - Applies green/amber/primary color based on goal comparison
   - Shows empty state when no data
   - Switching metric via click updates which data is displayed (use `fireEvent.click` or `userEvent`)
   - Mock data should include `proteinGoalG`, `carbsGoalG`, `fatGoalG` fields
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests fail.

2. **GREEN** — Implement `WeeklyNutritionChart`:
   - Props: `{ days: DailyNutritionTotals[]; weekStart: string }`
   - Internal state: `useState<"calories" | "protein" | "carbs" | "fat">("calories")`
   - Metric selector: segmented control using the same CSS pattern as `dashboard-shell.tsx` (rounded-full buttons, bg-primary active state, min-h-[44px] for touch targets)
   - Bar chart: same 7-slot layout as `weekly-calorie-chart.tsx` — `Array.from({ length: 7 })`, `addDays(weekStart, i)`, `h-48` container, `h-40` bar area
   - For each metric, extract value and goal from the day data:
     - calories → `day.calories` / `day.calorieGoal`
     - protein → `day.proteinG` / `day.proteinGoalG`
     - carbs → `day.carbsG` / `day.carbsGoalG`
     - fat → `day.fatG` / `day.fatGoalG`
   - Bar height, goal marker position, color logic: identical to `weekly-calorie-chart.tsx`
   - data-testid pattern: `day-bar-{date}` for bars, `goal-marker-{date}` for goal markers, `metric-{name}` for selector buttons
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests pass.

3. **REFACTOR** — Extract the value/goal extraction into a helper object or function to avoid repetitive switch statements.

**Notes:**
- This is a `'use client'` component (needs `useState` for metric selector).
- The metric selector labels should show units: "Calories" (kcal), "Protein" (g), "Carbs" (g), "Fat" (g). Keep labels short for mobile — just the names, units implied.
- Follow the existing DAY_LABELS pattern: `["S", "M", "T", "W", "T", "F", "S"]`.

---

### Task 5: Add goal consistency indicator

**Issue:** FOO-346
**Files:**
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests to the WeeklyNutritionChart test file:
   - When goals exist and some days meet them: shows "3/5 days on target" (example with 3 of 5 logged days meeting the goal)
   - Only counts days with `calories > 0` in the denominator
   - When no goals exist for the selected metric: consistency indicator is not rendered
   - Switching metric updates the consistency count
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: New tests fail.

2. **GREEN** — Add the consistency indicator to `WeeklyNutritionChart`:
   - Calculate: count days where `calories > 0` (logged) AND goal is not null → `totalWithGoal`. Count days where value <= goal → `onTarget`.
   - Render above the bar chart area: `<p className="text-sm text-muted-foreground">{onTarget}/{totalWithGoal} days on target</p>`
   - Conditionally render only when `totalWithGoal > 0`
   - data-testid: `goal-consistency`
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests pass.

3. **REFACTOR** — No significant refactoring expected.

---

### Task 6: Add net surplus/deficit summary

**Issue:** FOO-347
**Files:**
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - When net is under target: shows negative value with "under" label in green (e.g., "-200 kcal under")
   - When net is over target: shows positive value with "over" label in amber (e.g., "+120 kcal over")
   - When exactly on target: shows "On target" in green
   - Uses "kcal" unit for calories, "g" unit for protein/carbs/fat
   - Only includes days with both data (calories > 0) and a goal in the calculation
   - Not rendered when no goals exist for the selected metric
   - Switching metric updates the summary
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: New tests fail.

2. **GREEN** — Add the net summary below the bar chart:
   - Calculate: sum of `(actual - goal)` for all days where `calories > 0` AND goal is not null → `netDiff`
   - Unit label: `calories` → "kcal", others → "g"
   - Display logic:
     - `netDiff > 0`: `+{netDiff} {unit} over` with `text-amber-500`
     - `netDiff < 0`: `{netDiff} {unit} under` with `text-green-600`
     - `netDiff === 0`: "On target" with `text-green-600`
   - Round to whole number: `Math.round(netDiff)`
   - Conditionally render only when there are days with goals
   - data-testid: `net-surplus-deficit`
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests pass.

3. **REFACTOR** — Consider extracting the shared "days with goals" filtering logic used by both the consistency indicator and the net summary into a small helper.

---

### Task 7: Wire into WeeklyDashboard, delete old components

**Issue:** FOO-345, FOO-346, FOO-347
**Files:**
- `src/components/__tests__/weekly-dashboard.test.tsx` (modify)
- `src/components/weekly-dashboard.tsx` (modify)
- `src/components/weekly-calorie-chart.tsx` (delete)
- `src/components/__tests__/weekly-calorie-chart.test.tsx` (delete)
- `src/components/weekly-macro-averages.tsx` (delete)
- `src/components/__tests__/weekly-macro-averages.test.tsx` (delete)

**Steps:**

1. In `weekly-dashboard.tsx`:
   - Remove imports of `WeeklyCalorieChart` and `WeeklyMacroAverages`
   - Import `WeeklyNutritionChart` from `@/components/weekly-nutrition-chart`
   - Replace the `<WeeklyCalorieChart>` and `<WeeklyMacroAverages>` JSX with a single `<WeeklyNutritionChart days={days} weekStart={weekStart} />`
2. Delete `src/components/weekly-calorie-chart.tsx` and its test file.
3. Delete `src/components/weekly-macro-averages.tsx` and its test file.
4. Update `weekly-dashboard.test.tsx` if it references the deleted components.
5. Update `DashboardSkeleton` in `weekly-dashboard.tsx`: replace the separate calorie chart and macro averages skeleton sections with a single skeleton block that matches the new unified component layout (selector skeleton + chart skeleton).

**Verification:**
- Run: `npm test`
- Verify: All tests pass, no references to deleted files remain.
- Run: `npm run typecheck`
- Verify: No TypeScript errors.

---

### Task 8: Integration & Verification

**Issue:** FOO-345, FOO-346, FOO-347
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify no references to deleted components (`WeeklyCalorieChart`, `WeeklyMacroAverages`) remain in the codebase via grep.

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| No lumen goals for any day | Macro goal fields are null, no goal markers shown | Unit test |
| Mixed days with/without goals | Only days with goals show markers; consistency/surplus only count those days | Unit test |
| All days have zero calories | Empty state message shown | Unit test |
| Selected metric has no goals | Consistency indicator and surplus/deficit summary hidden | Unit test |

## Risks & Open Questions

- [ ] **Lumen goals may not be set for all days.** The chart should gracefully handle sparse goal data — show bars without goal markers for days missing goals. The consistency indicator and surplus/deficit summary only consider days that have both data and a goal.

## Scope Boundaries

**In Scope:**
- Unified nutrition chart with metric selector replacing calorie chart + macro averages
- Per-day bars with goal dashed lines for all 4 metrics
- Goal consistency indicator text
- Net surplus/deficit summary text
- `getLumenGoalsByDateRange` data layer function
- Extended `DailyNutritionTotals` type with macro goals
- Deletion of replaced components

**Out of Scope:**
- Touch/swipe gestures for metric switching
- Animations/transitions between metrics
- Persistent metric selection across page navigations
- Any changes to the daily dashboard view
- Changes to the fasting chart
