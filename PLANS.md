# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-550-nutrition-card-tap-expand
**Issues:** FOO-550, FOO-551, FOO-552
**Created:** 2026-02-16
**Last Updated:** 2026-02-16

## Summary

Add tap-to-expand nutrition details on two inline components (MiniNutritionCard in chat and AnalysisResult grid on the analyze page) using the existing bottom-sheet Dialog + NutritionFactsCard pattern. Also compact the chat header from two rows to one when an analysis is present.

## Issues

### FOO-550: Chat mini nutrition card is not tappable — no way to see full nutrition details

**Priority:** Low
**Labels:** Improvement
**Description:** The `MiniNutritionCard` shown inline in chat messages displays only food name, serving, calories, and P/C/F macros. Users cannot tap it to see the full nutrition breakdown (saturated fat, trans fat, sugars, calories from fat, fiber, sodium) even though the `FoodAnalysis` object already contains all data. History and quick-select pages already use the tap → bottom sheet → NutritionFactsCard pattern.

**Acceptance Criteria:**
- [ ] Tapping a MiniNutritionCard in chat opens a bottom-sheet Dialog
- [ ] Bottom sheet displays full nutrition via NutritionFactsCard (including tier-1 nutrients when available)
- [ ] Diff highlighting on the mini card itself is preserved (the bottom sheet shows the clean view)
- [ ] Dialog closes on overlay tap or X button
- [ ] Minimum 44x44px touch target on the card

### FOO-551: Analysis result grid is not tappable — no way to see tier-1 nutrition details

**Priority:** Low
**Labels:** Improvement
**Description:** The `AnalysisResult` component on the analyze page shows a 2-column grid of 6 nutrients but omits tier-1 details (saturated fat, trans fat, sugars, calories from fat). The grid is static with no tap handler. Users have no way to see the full breakdown until after logging.

**Acceptance Criteria:**
- [ ] Tapping the nutrition grid in AnalysisResult opens a bottom-sheet Dialog
- [ ] Bottom sheet displays full nutrition via NutritionFactsCard (same pattern as FOO-550)
- [ ] Non-nutrition parts of AnalysisResult (food name, confidence badge, description, notes) remain unchanged
- [ ] Dialog closes on overlay tap or X button
- [ ] Visual affordance (subtle hint the grid is tappable)

### FOO-552: Chat header wastes vertical space — meal type dropdown on separate row

**Priority:** Low
**Labels:** Improvement
**Description:** The chat header uses two rows when an analysis is present: Row 1 has the back arrow and "Log to Fitbit" button with `justify-between`, Row 2 has the MealTypeSelector on its own full-width line. This wastes ~52px of vertical space. Target layout: `[←] [Dinner ▾] [Log to Fitbit]` — a single compact row.

**Acceptance Criteria:**
- [ ] When analysis is present, header renders in one row: back button, meal selector (flex-1), log button
- [ ] MealTypeSelector fills available space between back and log buttons
- [ ] All three controls remain accessible with 44px minimum touch targets
- [ ] No layout changes when no analysis is present (simple back+title header unchanged)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm install` up to date

## Implementation Tasks

### Task 1: Add tap-to-expand bottom sheet to MiniNutritionCard

**Issue:** FOO-550
**Files:**
- `src/components/mini-nutrition-card.tsx` (modify)
- `src/components/__tests__/mini-nutrition-card.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the tap-to-expand behavior:
   - Test: clicking the card opens a dialog (query for dialog role)
   - Test: dialog contains NutritionFactsCard content (check for "Nutrition Facts" heading)
   - Test: the `FoodAnalysis` → `NutritionFactsCard` prop mapping is correct — assert that tier-1 nutrients appear when present in the analysis (saturated fat, sugars, etc.)
   - Test: dialog is not present initially (no dialog role in the DOM)
   - Run: `npm test -- mini-nutrition-card`
   - Verify: new tests fail (no dialog, no click handler)

2. **GREEN** — Add Dialog + NutritionFactsCard to MiniNutritionCard:
   - Add `"use client"` directive (needed for useState)
   - Add `useState<boolean>` for dialog open state
   - Wrap the existing card `<div>` with a `<button>` element (type="button", role for accessibility, aria-label like "View full nutrition details for {food_name}", cursor-pointer)
   - Add a `Dialog` with `variant="bottom-sheet"` containing `DialogHeader` (sr-only DialogTitle), and `NutritionFactsCard` with the snake_case → camelCase prop mapping from `analysis`
   - Follow the exact pattern from `food-history.tsx:348-380` for the Dialog structure
   - Prop mapping: `analysis.food_name` → `foodName`, `analysis.calories` → `calories`, `analysis.protein_g` → `proteinG`, `analysis.carbs_g` → `carbsG`, `analysis.fat_g` → `fatG`, `analysis.fiber_g` → `fiberG`, `analysis.sodium_mg` → `sodiumMg`, `analysis.unit_id` → `unitId`, `analysis.amount` → `amount`, `analysis.saturated_fat_g` → `saturatedFatG`, `analysis.trans_fat_g` → `transFatG`, `analysis.sugars_g` → `sugarsG`, `analysis.calories_from_fat` → `caloriesFromFat`
   - Run: `npm test -- mini-nutrition-card`
   - Verify: all tests pass

3. **REFACTOR** — Ensure the button wrapper doesn't break diff highlighting styles or the existing card layout. Add mock for ResizeObserver in the test file (needed for Radix Dialog), following the pattern from `analysis-result.test.tsx:8-14`.

**Notes:**
- The MiniNutritionCard is currently a server-compatible component (no `"use client"`). Adding state requires the directive. Since it's only rendered inside `FoodChat` (already client), this is safe.
- Dialog imports: `Dialog, DialogContent, DialogHeader, DialogTitle` from `@/components/ui/dialog`
- NutritionFactsCard import: `@/components/nutrition-facts-card`

### Task 2: Add tap-to-expand bottom sheet to AnalysisResult nutrition grid

**Issue:** FOO-551
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/__tests__/analysis-result.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the grid tap behavior:
   - Test: clicking the nutrition grid area opens a dialog
   - Test: dialog contains NutritionFactsCard with full nutrition data including tier-1 nutrients when available
   - Test: dialog is not present initially
   - Test: with tier-1 nutrients (provide `saturated_fat_g`, `sugars_g`, etc. in mockAnalysis), those values appear in the dialog
   - Run: `npm test -- analysis-result`
   - Verify: new tests fail

2. **GREEN** — Add Dialog to AnalysisResult:
   - Add `useState<boolean>` for dialog open state (component already has `"use client"`)
   - Wrap the nutrition grid `<div className="grid grid-cols-2 gap-4">` in a `<button>` element with: type="button", aria-label "View full nutrition details", cursor-pointer, text-left (preserve grid alignment)
   - Add `Dialog` with `variant="bottom-sheet"` below the grid, containing `NutritionFactsCard` with the same prop mapping as Task 1
   - Same Dialog structure as `food-history.tsx:348-380`
   - Run: `npm test -- analysis-result`
   - Verify: all tests pass

3. **REFACTOR** — Add a subtle visual affordance to the grid to hint it's tappable. A small text hint below the grid like "Tap for full details" in `text-xs text-muted-foreground` would work. Keep it minimal — the grid content itself doesn't change.

**Notes:**
- AnalysisResult already has `"use client"` and the test already has ResizeObserver mock — no additional setup needed.
- Only the `grid` section is tappable, not the entire component (food name, confidence badge, description, notes remain static).
- The `analysis` prop is `FoodAnalysis | null`, so the Dialog should only render when `analysis` is truthy (which is already gated by the `if (!analysis) return null` check).

### Task 3: Compact chat header to single row

**Issue:** FOO-552
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write test for single-row header layout:
   - Test: when analysis is present, the back button, meal type selector, and log button are all within the same flex container (single parent `div` with `flex` class, no `space-y-2`)
   - Test: MealTypeSelector is rendered between back button and log button in the DOM order
   - Run: `npm test -- food-chat`
   - Verify: new test fails (currently two rows with `space-y-2`)

2. **GREEN** — Restructure the header layout at lines 413-449 of `food-chat.tsx`:
   - Replace the two-row structure (`space-y-2` with two child divs) with a single flex row
   - Target layout: `<div className="flex items-center gap-2">` containing: back button (shrink-0), MealTypeSelector (flex-1, with `showTimeHint={false}`), Log to Fitbit button (shrink-0)
   - Remove the separate `<div className="w-full">` wrapper around MealTypeSelector
   - The MealTypeSelector's `SelectTrigger` already has `w-full min-h-[44px]` which will respect flex-1 constraints
   - Run: `npm test -- food-chat`
   - Verify: all tests pass

3. **REFACTOR** — Verify the layout works at different widths. The MealTypeSelector's min-h-[44px] ensures touch target compliance. The shrink-0 on buttons prevents them from being compressed. No changes needed to `meal-type-selector.tsx`.

**Notes:**
- The MealTypeSelector mock in `food-chat.test.tsx` (lines 26-30) renders a simplified select. Tests should verify DOM structure, not visual layout.
- The "simple header" branch (no analysis, lines 450-462) remains unchanged.
- `showTimeHint={false}` is already set on the MealTypeSelector in chat — the time hint text below the select would break the single-row layout if shown, but it's already disabled.

### Task 4: Integration verification

**Issue:** FOO-550, FOO-551, FOO-552
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification (during plan-review-implementation):
   - [ ] Open analyze page, submit a photo, tap nutrition grid → bottom sheet with NutritionFactsCard
   - [ ] In chat, tap MiniNutritionCard → bottom sheet with NutritionFactsCard
   - [ ] Chat header shows single row with back, meal selector, and log button
   - [ ] All dialogs close properly on overlay tap and X button
   - [ ] Test on 375px width (mobile viewport)

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Tier-1 nutrients are null | NutritionFactsCard conditionally renders them (already handles null) | Unit test with null tier-1 values |
| Dialog open/close state | Standard Radix Dialog behavior — well-tested by library | Unit test for open/close |
| Screen reader announces dialog | DialogTitle (sr-only) provides accessible name | Covered by Dialog component |

## Risks & Open Questions

- [ ] None identified — all three changes are isolated frontend improvements using established patterns (Dialog + NutritionFactsCard). No API, DB, or session changes.

## Scope Boundaries

**In Scope:**
- Tap-to-expand on MiniNutritionCard (FOO-550)
- Tap-to-expand on AnalysisResult grid (FOO-551)
- Single-row chat header (FOO-552)

**Out of Scope:**
- Changing what the inline MiniNutritionCard or AnalysisResult grid display (only adding drill-down)
- Adding nutrition editing capabilities
- Changes to NutritionFactsCard itself
- Changes to MealTypeSelector component
