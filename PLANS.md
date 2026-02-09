# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-245-nav-rename-and-history-rounding
**Issues:** FOO-245, FOO-246
**Created:** 2026-02-08
**Last Updated:** 2026-02-08

## Summary

Two small UI fixes: (1) rename the bottom nav "Take Photo" tab to "Analyze" with a distinct `ScanEye` icon, and (2) round the daily summary totals in the history view so calories are integers and macros show one decimal place.

## Issues

### FOO-245: Rename bottom nav 'Take Photo' to 'Analyze' with ScanEye icon

**Priority:** Medium
**Labels:** Improvement
**Description:** The bottom nav "Take Photo" label doesn't reflect the screen's full capability (photos + text input), and the Camera icon duplicates the Home tab icon.

**Acceptance Criteria:**
- [ ] Nav item label changed from "Take Photo" to "Analyze"
- [ ] Nav item icon changed from `Camera` to `ScanEye` (from lucide-react)
- [ ] Home button remains unchanged (Home icon, `/app` route)
- [ ] No other nav items are modified

### FOO-246: History daily summary shows unrounded metric values

**Priority:** Medium
**Labels:** Bug
**Description:** The daily summary line in the history view displays calories and macros with excessive decimal places when entries sum to non-integer values.

**Acceptance Criteria:**
- [ ] Calories displayed as integers (no decimals) in the daily summary
- [ ] Protein, carbs, and fat displayed with 1 decimal place in the daily summary
- [ ] Individual entry details in the modal are NOT changed

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `ScanEye` icon available in installed lucide-react (verified: yes)

## Implementation Tasks

### Task 1: Update bottom-nav tests for "Analyze" label and ScanEye icon

**Issue:** FOO-245
**Files:**
- `src/components/__tests__/bottom-nav.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update existing tests to expect "Analyze" instead of "Take Photo":
   - In the "renders five nav items" test (line 11): change `"Take Photo"` to `"Analyze"` in both the test description and the `getByText` assertion
   - In the "Take Photo links to /app/analyze" test (line 38): rename to "Analyze links to /app/analyze", change `getByRole("link", { name: /take photo/i })` to `{ name: /analyze/i }`
   - In the "Take Photo is active when on /app/analyze" test (line 84): rename to "Analyze is active when on /app/analyze", change `getByRole("link", { name: /take photo/i })` to `{ name: /^analyze$/i }` (exact match to avoid matching other text)
   - Run: `npm test -- bottom-nav`
   - Verify: Tests fail because the component still says "Take Photo"

2. **GREEN** - (Handled in Task 2)

### Task 2: Change bottom-nav label and icon

**Issue:** FOO-245
**Files:**
- `src/components/bottom-nav.tsx` (modify)

**Steps:**

1. **GREEN** - Make tests from Task 1 pass:
   - In the import line (line 5), replace `Camera` with `ScanEye`: `import { Home, ListChecks, ScanEye, Clock, Settings } from "lucide-react";`
   - Change the nav item at lines 21-26:
     - `label: "Take Photo"` → `label: "Analyze"`
     - `icon: Camera` → `icon: ScanEye`
   - Run: `npm test -- bottom-nav`
   - Verify: All tests pass

2. **REFACTOR** - No refactoring needed; this is a single-line change.

**Notes:**
- The `Home` tab keeps `Home` icon (not `Camera`) — it was already using `Home` icon.
- `ScanEye` is confirmed available in the project's lucide-react package.

### Task 3: Add rounding test for daily summary in food-history

**Issue:** FOO-246
**Files:**
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Add a new test that verifies rounding:
   - Create test entries with fractional values that produce non-integer sums. For example:
     ```typescript
     const fractionalEntries: FoodLogHistoryEntry[] = [
       {
         id: 1, foodName: "Item A", calories: 123.4, proteinG: 10.15,
         carbsG: 20.27, fatG: 8.33, fiberG: 2, sodiumMg: 100,
         amount: 100, unitId: 147, mealTypeId: 3,
         date: "2026-02-06", time: "12:00:00", fitbitLogId: 500,
       },
       {
         id: 2, foodName: "Item B", calories: 200.8, proteinG: 15.89,
         carbsG: 30.56, fatG: 12.78, fiberG: 3, sodiumMg: 200,
         amount: 150, unitId: 147, mealTypeId: 5,
         date: "2026-02-06", time: "13:00:00", fitbitLogId: 501,
       },
     ];
     ```
   - Totals: calories=324.2, protein=26.04, carbs=50.83, fat=21.11
   - Assert the daily summary shows: `324 cal | P:26.0g C:50.8g F:21.1g`
   - Run: `npm test -- food-history`
   - Verify: Test fails because the component renders unrounded values

2. **GREEN** - (Handled in Task 4)

**Notes:**
- Use `getByText` with a regex or exact substring match on the summary line.
- The mock data in the existing test (lines 22-71) uses integer values, so this test needs fractional values to expose the rounding issue.

### Task 4: Round daily summary values in food-history

**Issue:** FOO-246
**Files:**
- `src/components/food-history.tsx` (modify)

**Steps:**

1. **GREEN** - Make the test from Task 3 pass:
   - In the daily summary `<span>` at line 237-239, apply rounding:
     - `{group.totalCalories}` → `{Math.round(group.totalCalories)}`
     - `{group.totalProteinG}` → `{group.totalProteinG.toFixed(1)}`
     - `{group.totalCarbsG}` → `{group.totalCarbsG.toFixed(1)}`
     - `{group.totalFatG}` → `{group.totalFatG.toFixed(1)}`
   - Run: `npm test -- food-history`
   - Verify: All tests pass (both the new rounding test and the existing "shows daily summary with total calories" test which checks for `440`)

2. **REFACTOR** - No refactoring needed; inline formatting is appropriate here.

**Notes:**
- `Math.round()` for calories produces an integer (no `.0`).
- `.toFixed(1)` for macros produces exactly one decimal place (e.g., `26.0`, `50.8`).
- The existing test at line 126 checks `expect(screen.getByText(/440/))` which will still match `440` after `Math.round(440)` returns `440`.
- Individual entry values in the entry rows (lines 261-264) and the NutritionFactsCard dialog are NOT changed, per acceptance criteria.

### Task 5: Full verification

**Issues:** FOO-245, FOO-246
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Visual verification:
   - [ ] Bottom nav shows "Analyze" with ScanEye icon (not Camera)
   - [ ] Home tab still shows Home icon
   - [ ] History daily summaries show rounded values

## Error Handling

No new error handling needed — these are display-only changes.

## Risks & Open Questions

None — both changes are straightforward UI modifications with no side effects.

## Scope Boundaries

**In Scope:**
- Renaming one nav item label and swapping its icon
- Rounding daily summary totals in history view

**Out of Scope:**
- Changing individual entry display formatting
- Changing the NutritionFactsCard dialog values
- Any changes to API responses or data storage
