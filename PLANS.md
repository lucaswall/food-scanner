# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-554-dialog-zindex-and-log-another-cleanup
**Issues:** FOO-554, FOO-553
**Created:** 2026-02-16
**Last Updated:** 2026-02-16

## Summary

Fix two UX issues: (1) nutrition detail dialogs are invisible when opened from within FoodChat due to a z-index stacking conflict, and (2) remove the unreliable "Log Another" button from the post-log confirmation screen, leaving only the "Done" button.

## Issues

### FOO-554: Nutrition dialog hidden behind FoodChat overlay due to z-index conflict

**Priority:** High
**Labels:** Bug
**Description:** Tapping the mini nutrition card inside FoodChat opens a dialog that renders behind the chat overlay (z-50 < z-[60]), making the tap-to-expand feature completely non-functional in the chat flow. Only affects dialogs opened from within FoodChat — the analyzer page works fine.

**Acceptance Criteria:**
- [ ] Bottom-sheet dialog variant renders above FoodChat overlay (z-[60])
- [ ] Default dialog variant remains at z-50 (no regression)
- [ ] Other dialog usages (food-history, analysis-result) unaffected
- [ ] Dialog overlay also renders above FoodChat for bottom-sheet variant

### FOO-553: Remove 'Log Another' button from post-log confirmation

**Priority:** High
**Labels:** Improvement
**Description:** The "Log Another" button on the post-log confirmation screen is unnecessary. Remove it entirely — only the "Done" button should remain, navigating back to `/app`.

**Acceptance Criteria:**
- [ ] "Log Another" button removed from `FoodLogConfirmation`
- [ ] "Done" button becomes primary variant (`variant="default"`) and is centered
- [ ] Done button navigates to `/app`
- [ ] Remove 3 "Log Another" test cases from `food-log-confirmation.test.tsx`
- [ ] Update E2E test in `analyze.spec.ts` (remove "Log Another" assertion)
- [ ] Clean up stale mocks in `food-analyzer-reconnect.test.tsx` and `quick-select.test.tsx`

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass

## Implementation Tasks

### Task 1: Add test for bottom-sheet dialog z-index override

**Issue:** FOO-554
**Files:**
- `src/components/ui/__tests__/dialog.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add two test cases to the existing `DialogContent variant prop` describe block:
   - Test that `dialogContentVariants({ variant: "bottom-sheet" })` output contains `z-[70]` and does NOT contain `z-50` (twMerge removes the overridden class)
   - Test that `dialogContentVariants({ variant: "default" })` output still contains `z-50`
   - Run: `npm test -- dialog`
   - Verify: The bottom-sheet z-[70] test fails (currently outputs z-50)

2. **GREEN** — Implemented in Task 2.

**Notes:**
- `cn()` uses `twMerge` which resolves conflicting z-index classes — later value wins
- The overlay z-index cannot be tested via CVA variants (it's a separate component), so that will be verified in Task 2's integration step

### Task 2: Fix dialog z-index for bottom-sheet variant

**Issue:** FOO-554
**Files:**
- `src/components/ui/dialog.tsx` (modify)

**TDD Steps:**

1. **GREEN** — Two changes needed in `dialog.tsx`:

   a. **Content z-index:** In `dialogContentVariants`, add `z-[70]` to the `bottom-sheet` variant string. Since `twMerge` resolves conflicts, it will override the `z-50` in the base class.

   b. **Overlay z-index:** In the `DialogContent` component, pass a conditional `className` to `DialogOverlay` — when `variant === "bottom-sheet"`, pass `"z-[70]"`. `DialogOverlay` already accepts className via its `cn()` call, so `twMerge` will override its base `z-50`.

   - Run: `npm test -- dialog`
   - Verify: All dialog tests pass including the new z-[70] assertion from Task 1

2. **REFACTOR** — No refactoring needed, this is a minimal change.

**Notes:**
- `DialogOverlay` already destructures `className` and merges it via `cn()` — no interface changes needed
- `DialogContent` already has access to `variant` prop — just add conditional logic before the JSX return
- z-[70] > z-[60] (FoodChat) > z-50 (default dialog, bottom-nav)
- Other components using `variant="bottom-sheet"` (`food-history.tsx:349`, `analysis-result.tsx:101`) will also get z-[70] — this is harmless since those are never rendered inside a z-[60] container

### Task 3: Update FoodLogConfirmation tests for Log Another removal

**Issue:** FOO-553
**Files:**
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Modify existing tests:
   - **Remove** the 3 "Log Another" test cases (lines 251-294): "renders Log Another button alongside Done button", "navigates to /app/analyze when Log Another button is clicked", "Log Another button has primary variant and Done has outline variant"
   - **Update** the "navigates to /app when Done button is clicked" test (line 97): the test itself is fine (clicks Done, expects `/app`), but the button variant will change
   - **Add** a new test: "Done button has default variant" — assert `data-variant="default"` on the Done button
   - **Add** a new test: "Done button is the only action button" — assert only 1 button with role="button" exists in the actions area (or assert "Log Another" is absent)
   - Run: `npm test -- food-log-confirmation`
   - Verify: New tests fail (Done currently has `variant="outline"` and Log Another still exists)

2. **GREEN** — Implemented in Task 4.

### Task 4: Remove Log Another button and restyle Done button

**Issue:** FOO-553
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)

**TDD Steps:**

1. **GREEN** — In `food-log-confirmation.tsx`:
   - Remove the entire `<div className="flex gap-3">` wrapper (lines 86-103) and replace with a single centered Done button
   - The Done button should: use `variant="default"` (primary), add `data-variant="default"`, keep `min-h-[44px] min-w-[120px]`, navigate to `/app` on click
   - Wrap in a `<div className="flex justify-center">` for centering
   - Run: `npm test -- food-log-confirmation`
   - Verify: All tests pass

2. **REFACTOR** — No refactoring needed.

**Notes:**
- No props to remove from the component interface — `FoodLogConfirmation` doesn't have `onLogAnother` or `onReset` props (it uses `router.push` internally)
- The parent components (`food-analyzer.tsx:498`, `quick-select.tsx:192`, `chat-page-client.tsx:18`) don't pass any action callbacks — no parent changes needed

### Task 5: Clean up stale test mocks referencing removed behavior

**Issue:** FOO-553
**Files:**
- `src/components/__tests__/food-analyzer-reconnect.test.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **GREEN** — Clean up stale mock definitions:

   a. **`food-analyzer-reconnect.test.tsx`** (lines 139-155): The mock destructures `onReset` and renders a "Log Another" button — these props don't exist on the real component. Simplify the mock to match the pattern in `food-analyzer.test.tsx:163-178` (only destructure `response`, `foodName`; render a simple div).

   b. **`quick-select.test.tsx`** (lines 44-64): The mock destructures `onDone` and `onLogAnother` — both are phantom props. Simplify the mock to only destructure `response` and `foodName`, render a simple confirmation div. Also remove test "does not pass onDone to FoodLogConfirmation so Done navigates to /app" (line 495) since the concept of passing onDone is irrelevant now (Done behavior is internal to the component).

   - Run: `npm test -- food-analyzer-reconnect quick-select`
   - Verify: All tests pass

2. **REFACTOR** — Ensure mock patterns are consistent across all test files that mock `FoodLogConfirmation`:
   - `food-analyzer.test.tsx:163` — already clean (no phantom props) ✓
   - `food-analyzer-reconnect.test.tsx` — cleaned in step 1a
   - `quick-select.test.tsx` — cleaned in step 1b

### Task 6: Update E2E test for Log Another removal

**Issue:** FOO-553
**Files:**
- `e2e/tests/analyze.spec.ts` (modify)

**TDD Steps:**

1. **GREEN** — In `analyze.spec.ts`:
   - Remove lines 127-128 that assert "Log Another" button visibility
   - Keep the "Done" button assertion (line 130-131)
   - No new assertions needed — the "Done" button check is sufficient

   - Run: `npm run e2e` (lead-only, not during TDD)
   - Verify: E2E tests pass

**Notes:**
- E2E tests are lead-only and run during final verification, not during the TDD loop

### Task 7: Integration & Verification

**Issue:** FOO-554, FOO-553
**Files:** Various files from previous tasks

**Steps:**

1. Run full unit test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Run E2E tests: `npm run e2e`
6. Manual verification:
   - [ ] Open FoodChat, get an analysis, tap the mini nutrition card → dialog should appear ABOVE the chat
   - [ ] Log food via analyzer → confirmation shows only "Done" button, centered, primary variant
   - [ ] Click "Done" → navigates to `/app`
   - [ ] Log food via quick-select → same confirmation behavior
   - [ ] Log food via chat → same confirmation behavior

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Dialog z-50 behind z-[60] overlay | Bottom-sheet variant uses z-[70] to paint above | Unit test (CVA variant output) |
| Default dialog z-index regression | Default variant keeps z-50 | Unit test (CVA variant output) |
| Done button missing after removal | Single centered Done button remains | Unit test + E2E |

## Risks & Open Questions

- [ ] Risk: Other consumers of `bottom-sheet` variant (`food-history.tsx`, `analysis-result.tsx`) get elevated z-index. Mitigation: These are never rendered inside z-[60] containers, so z-[70] is harmless — the overlay still works correctly.
- [ ] Risk: `twMerge` doesn't resolve `z-50` vs `z-[70]` correctly. Mitigation: `twMerge` handles arbitrary z-index values and removes the lower one. Confirmed by the `cn()` implementation using `tailwind-merge`.

## Scope Boundaries

**In Scope:**
- Fix bottom-sheet dialog z-index to render above FoodChat
- Remove "Log Another" button from FoodLogConfirmation
- Restyle "Done" button as primary and centered
- Update all affected unit tests and E2E tests
- Clean up stale test mocks

**Out of Scope:**
- Refactoring the FoodChat z-index itself (z-[60] is correct for a full-screen overlay)
- Adding a generic z-index prop to Dialog (not needed — variant-based is sufficient)
- Changing bottom-nav z-index (z-50, unrelated)
