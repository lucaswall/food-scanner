# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-89-smart-portion-units
**Issues:** FOO-89
**Created:** 2026-02-05
**Last Updated:** 2026-02-05

## Summary

Replace the hardcoded grams-only portion system (Small/Medium/Large presets with gram input) with a smart unit system where Claude picks the most appropriate Fitbit-compatible unit (grams, cup, oz, tbsp, slice, etc.), returns an amount + unit, and the user can edit both the amount and unit type before logging to Fitbit.

## Issues

### FOO-89: When editing the portion small/medium/large is not appropriate

**Priority:** High
**Labels:** Improvement
**Description:** The AI should estimate the total amount in context-appropriate units (grams for solid food, cups for beverages, etc.) and let the user edit both the quantity and unit type. The Small/Medium/Large presets are too coarse and not meaningful for many foods (e.g., "1 cup" of tea, "2 slices" of pizza).

**Acceptance Criteria:**
- [ ] Claude returns an amount and a Fitbit-compatible unit (not just grams)
- [ ] The read-only analysis view displays the amount with its unit (e.g., "Portion: 1 cup", "Portion: 150g")
- [ ] The edit mode shows an amount number input and a unit dropdown
- [ ] The Small/Medium/Large preset buttons are removed
- [ ] The unit dropdown contains common Fitbit units (g, oz, cup, tbsp, tsp, ml, slice, piece, serving)
- [ ] Fitbit `createFood` uses the selected unit for `defaultFoodMeasurementUnitId`
- [ ] Fitbit `logFood` uses the selected unit for `unitId`
- [ ] The log-food API accepts and validates the new `unitId` field
- [ ] All existing tests are updated; no test regressions

## Prerequisites

- [ ] Working authentication (Google + Fitbit OAuth) — already implemented
- [ ] Claude analysis endpoint working — already implemented
- [ ] Fitbit logging endpoint working — already implemented

## Implementation Tasks

### Task 1: Define Fitbit unit constants and update types

**Issue:** FOO-89
**Files:**
- `src/types/index.ts` (modify)
- `src/types/__tests__/index.test.ts` (create)

**TDD Steps:**

1. **RED** - Write test:
   - Create `src/types/__tests__/index.test.ts`
   - Test that `FITBIT_UNITS` map contains expected entries (g, oz, cup, tbsp, tsp, ml, slice, piece, serving)
   - Test that each entry has `id` (number), `name` (string), `plural` (string)
   - Test that `FoodAnalysis` type includes `amount` and `unit_id` fields (compile-time check)
   - Run: `npm test -- index.test`
   - Verify: Tests fail (FITBIT_UNITS doesn't exist, types don't have new fields)

2. **GREEN** - Implement:
   - Add `FITBIT_UNITS` constant map to `src/types/index.ts`:
     ```typescript
     export const FITBIT_UNITS = {
       g:       { id: 147, name: "g",       plural: "g" },
       oz:      { id: 226, name: "oz",      plural: "oz" },
       cup:     { id: 91,  name: "cup",     plural: "cups" },
       tbsp:    { id: 349, name: "tbsp",    plural: "tbsp" },
       tsp:     { id: 364, name: "tsp",     plural: "tsp" },
       ml:      { id: 211, name: "ml",      plural: "ml" },
       slice:   { id: 311, name: "slice",   plural: "slices" },
       piece:   { id: 256, name: "piece",   plural: "pieces" },
       serving: { id: 304, name: "serving", plural: "servings" },
     } as const;

     export type FitbitUnitKey = keyof typeof FITBIT_UNITS;
     ```
   - Update `FoodAnalysis` interface: replace `portion_size_g: number` with:
     ```typescript
     amount: number;       // e.g., 1, 150, 2.5
     unit_id: number;      // Fitbit unit ID (e.g., 147 for grams, 91 for cups)
     ```
   - Update `FoodLogRequest` to also include `unit_id` (inherited from `FoodAnalysis`)
   - Run: `npm test -- index.test`
   - Verify: Tests pass

3. **REFACTOR** - Add a helper:
   - Add `getUnitById(id: number)` helper that returns the unit entry or undefined
   - Add `getUnitLabel(id: number, amount: number)` helper that returns formatted label (e.g., "150g", "1 cup", "2 cups")

**Notes:**
- The Fitbit unit IDs come from the Fitbit API (`GET /1/foods/units.json`). The IDs listed above are the common ones. We hardcode them to avoid an extra API call.
- Unit ID 147 = gram, 226 = oz, 91 = cup, 349 = tbsp, 364 = tsp, 211 = ml, 311 = slice, 256 = piece, 304 = serving — these should be verified against the Fitbit API, but these are the well-known standard IDs.
- Removing `portion_size_g` is a **breaking change** — all consumers must be updated in subsequent tasks.

---

### Task 2: Update Claude tool schema and analysis function

**Issue:** FOO-89
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update existing tests:
   - In `src/lib/__tests__/claude.test.ts`, update the mock Claude response to return `amount` and `unit_id` instead of `portion_size_g`
   - Update test assertions to check for `amount` and `unit_id` in the result
   - Add a test: "returns amount and unit_id from Claude response"
   - Run: `npm test -- claude.test`
   - Verify: Tests fail (schema still uses `portion_size_g`)

2. **GREEN** - Implement:
   - In `src/lib/claude.ts`, update `REPORT_NUTRITION_TOOL` schema:
     - Remove `portion_size_g` property
     - Add `amount` property: `{ type: "number", description: "Estimated quantity in the chosen unit (e.g., 150 for grams, 1 for cup, 2 for slices)" }`
     - Add `unit_id` property: `{ type: "number", description: "Fitbit measurement unit ID. Use: 147=gram, 91=cup, 226=oz, 349=tbsp, 364=tsp, 211=ml, 311=slice, 256=piece, 304=serving. Choose the most natural unit for the food (e.g., cups for beverages, grams for solid food, slices for pizza/bread)." }`
     - Update `required` array to include `amount`, `unit_id` instead of `portion_size_g`
   - Update `SYSTEM_PROMPT` to mention choosing appropriate units
   - Run: `npm test -- claude.test`
   - Verify: Tests pass

3. **REFACTOR** - Clean up:
   - Ensure the tool description mentions the unit selection behavior

**Notes:**
- The Claude tool schema is how we instruct Claude to return structured data. By listing the valid unit IDs in the description, Claude can pick the most appropriate one.
- Reference: `src/lib/claude.ts:14-54` for current schema

---

### Task 3: Update Fitbit client to accept dynamic units

**Issue:** FOO-89
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update existing tests:
   - In `src/lib/__tests__/fitbit.test.ts`, update `createFood` tests:
     - Mock food analysis now has `amount` and `unit_id` instead of `portion_size_g`
     - Assert that `defaultFoodMeasurementUnitId` uses `food.unit_id.toString()` instead of hardcoded `"147"`
     - Assert that `defaultServingSize` uses `food.amount.toString()` instead of `food.portion_size_g.toString()`
   - Update `logFood` tests:
     - Change the function signature: `logFood` now receives `unitId` parameter
     - Assert that `unitId` param uses the passed value instead of hardcoded `"147"`
   - Run: `npm test -- fitbit.test`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - In `createFood()`: change hardcoded `"147"` to `food.unit_id.toString()` for `defaultFoodMeasurementUnitId`, and `food.portion_size_g.toString()` to `food.amount.toString()` for `defaultServingSize`
   - In `logFood()`: add `unitId: number` parameter, replace hardcoded `"147"` with `unitId.toString()`
   - Run: `npm test -- fitbit.test`
   - Verify: Tests pass

3. **REFACTOR** - Update callers:
   - `findOrCreateFood` passes through unchanged (it already receives `FoodAnalysis`)

**Notes:**
- `createFood` at `src/lib/fitbit.ts:66-115` currently hardcodes unit ID 147
- `logFood` at `src/lib/fitbit.ts:117-170` currently hardcodes unit ID 147
- The `logFood` function also needs the `unitId` passed in, since it's separate from the food creation

---

### Task 4: Update log-food API route

**Issue:** FOO-89
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update existing tests:
   - Update all mock request bodies to use `amount` + `unit_id` instead of `portion_size_g`
   - Update validation tests: `amount` must be > 0, `unit_id` must be a number
   - Add test: "rejects request with missing unit_id"
   - Add test: "passes unit_id to logFood function"
   - Update the `isValidFoodLogRequest` assertions
   - Run: `npm test -- log-food`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - Update `isValidFoodLogRequest()`:
     - Remove `portion_size_g` check
     - Add `amount` check: `typeof req.amount === "number" && req.amount > 0`
     - Add `unit_id` check: `typeof req.unit_id === "number"`
   - Update the `logFood()` call at line 156-163:
     - Pass `body.amount` instead of `body.portion_size_g`
     - Pass `body.unit_id` as the unitId parameter
   - Run: `npm test -- log-food`
   - Verify: Tests pass

**Notes:**
- Reference: `src/app/api/log-food/route.ts:17-43` for current validation
- Reference: `src/app/api/log-food/route.ts:156-163` for current logFood call

---

### Task 5: Update analyze-food API route

**Issue:** FOO-89
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Update mock Claude responses to return `amount` + `unit_id` instead of `portion_size_g`
   - Update assertions on the response data shape
   - Run: `npm test -- analyze-food`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - The route likely just passes through the `FoodAnalysis` from Claude — verify and update any explicit field references if they exist
   - Run: `npm test -- analyze-food`
   - Verify: Tests pass

**Notes:**
- This task may be trivial if the route just returns whatever Claude returns. But the tests will need updating since they mock the Claude response.

---

### Task 6: Update AnalysisResult component (read-only view)

**Issue:** FOO-89
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/__tests__/analysis-result.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Update mock `FoodAnalysis` objects to use `amount` + `unit_id` instead of `portion_size_g`
   - Update assertion: instead of checking for "Portion: 150g", check for formatted unit label (e.g., "Portion: 150g", "Portion: 1 cup")
   - Add test: "displays cup unit correctly" (amount: 1, unit_id: 91 → "Portion: 1 cup")
   - Add test: "displays plural unit correctly" (amount: 2, unit_id: 91 → "Portion: 2 cups")
   - Run: `npm test -- analysis-result.test`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - Import `getUnitLabel` from `@/types`
   - Change line 120 from:
     ```tsx
     <p className="text-sm text-gray-600">Portion: {analysis.portion_size_g}g</p>
     ```
     to:
     ```tsx
     <p className="text-sm text-gray-600">Portion: {getUnitLabel(analysis.unit_id, analysis.amount)}</p>
     ```
   - Run: `npm test -- analysis-result.test`
   - Verify: Tests pass

**Notes:**
- Reference: `src/components/analysis-result.tsx:120` for current portion display
- `getUnitLabel` handles singular/plural formatting (created in Task 1)

---

### Task 7: Update NutritionEditor component (edit mode)

**Issue:** FOO-89
**Files:**
- `src/components/nutrition-editor.tsx` (modify)
- `src/components/__tests__/nutrition-editor.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Update all mock `FoodAnalysis` objects to use `amount` + `unit_id`
   - Remove tests for Small/Medium/Large preset buttons
   - Add test: "renders amount input field"
   - Add test: "renders unit dropdown with common Fitbit units"
   - Add test: "changing unit dropdown calls onChange with new unit_id"
   - Add test: "changing amount input calls onChange with new amount"
   - Add test: "unit dropdown shows current unit as selected"
   - Add test: "amount input rejects negative values"
   - Run: `npm test -- nutrition-editor.test`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - Import `FITBIT_UNITS` and `FitbitUnitKey` from `@/types`
   - Remove `PORTION_PRESETS` constant entirely
   - Replace the portion section (lines 112-143) with:
     - An amount number input (min=0, step=0.1)
     - A `<select>` dropdown (or shadcn Select if available) with the entries from `FITBIT_UNITS`
     - Both side-by-side in a flex row
   - Update `handleNumberChange` to handle the `amount` field
   - Add handler for unit change: update `unit_id` in the analysis object
   - Remove the label "Portion (g)" → use "Portion" instead
   - Run: `npm test -- nutrition-editor.test`
   - Verify: Tests pass

3. **REFACTOR** - Polish:
   - Ensure the dropdown has min-height 44px for touch friendliness
   - Ensure the amount input has min-height 44px
   - Use native `<select>` element styled with Tailwind (simpler than shadcn Select, better mobile UX with native picker)

**Notes:**
- Reference: `src/components/nutrition-editor.tsx:15-19` for current presets
- Reference: `src/components/nutrition-editor.tsx:112-143` for current portion UI
- The unit dropdown should show the unit name and let the user pick from the `FITBIT_UNITS` list

---

### Task 8: Update FoodAnalyzer component

**Issue:** FOO-89
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Update tests:
   - Update all mock `FoodAnalysis` objects to use `amount` + `unit_id` instead of `portion_size_g`
   - Update assertions on the log-food fetch call body to include `amount` + `unit_id` instead of `portion_size_g`
   - Run: `npm test -- food-analyzer.test`
   - Verify: Tests fail

2. **GREEN** - Implement:
   - In `handleLogToFitbit`, the `body: JSON.stringify(...)` call (line 157-160) already spreads `currentAnalysis` which will now include `amount` + `unit_id` instead of `portion_size_g`. Verify this works correctly.
   - Run: `npm test -- food-analyzer.test`
   - Verify: Tests pass

**Notes:**
- This should be mostly a test update since `FoodAnalyzer` spreads the analysis object rather than picking individual fields.
- Reference: `src/components/food-analyzer.tsx:154-161`

---

### Task 9: Integration & Verification

**Issue:** FOO-89
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify no references to `portion_size_g` remain in source code:
   ```bash
   grep -r "portion_size_g" src/
   ```
6. Manual verification steps:
   - [ ] Analyze a photo of solid food → should show grams
   - [ ] Analyze a photo of a beverage → should show cups or ml
   - [ ] Edit mode shows amount input + unit dropdown
   - [ ] Changing unit updates the display
   - [ ] Log to Fitbit succeeds with non-gram units
   - [ ] Log to Fitbit succeeds with gram units

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-89 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude returns invalid unit_id | Default to 147 (grams) | Unit test in claude.test.ts |
| User enters 0 or negative amount | Reject, keep previous value | Unit test in nutrition-editor.test.ts |
| Missing unit_id in log request | Return VALIDATION_ERROR | Unit test in log-food route.test.ts |
| Unknown unit_id in display | Show raw number + "units" | Unit test for getUnitLabel |

## Risks & Open Questions

- [ ] Fitbit unit IDs are hardcoded — verify IDs 91 (cup), 226 (oz), 349 (tbsp), 364 (tsp), 211 (ml), 311 (slice), 256 (piece), 304 (serving) are correct by testing with the actual Fitbit API. If any ID is wrong, the Fitbit API will reject the food creation.
- [ ] Claude may not always pick the "right" unit — this is OK since the user can change it in edit mode.
- [ ] Nutrition values from Claude are always per the returned amount+unit. If the user changes the amount, the nutrition values won't auto-scale (same as current behavior with grams). This matches the existing behavior where changing "150g" to "300g" doesn't double the calories.

## Scope Boundaries

**In Scope:**
- Replace `portion_size_g` with `amount` + `unit_id` across the entire stack
- Update Claude tool schema to return appropriate units
- Update Fitbit client to use dynamic units
- Update all UI components and API routes
- Remove Small/Medium/Large presets
- Update all tests

**Out of Scope:**
- Auto-scaling nutrition values when amount changes
- Fetching the full Fitbit unit list from the API at runtime
- Food deduplication/search (separate issue)
- Adding custom/new Fitbit units beyond the hardcoded set
