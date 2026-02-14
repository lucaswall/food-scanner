# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-382-chat-ux-polish
**Issues:** FOO-382, FOO-385, FOO-386, FOO-388, FOO-389, FOO-390, FOO-391, FOO-392, FOO-394, FOO-397, FOO-398, FOO-381
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Polish the chat refinement UX in `food-chat.tsx` — fix bugs (wrong unit labels, silent compression failures, photo menu at limit, no API timeouts), fix convention violations (touch target, accessibility), improve interactions (dismissible errors, outside-click menus, compression loading, clearer warnings, input limits), and replace the inline nutrition text with a mini nutrition card.

## Issues

### FOO-382: Wrong unit labels in chat refinement

**Priority:** High
**Labels:** Bug
**Description:** Chat refinement uses a local `getUnitLabel` stub that only handles `g` (147) and `ml` (209), falling back to "units". The proper version in `src/types/index.ts:47-53` handles 8 unit types with pluralization. Users see "2 units" instead of "2 cups".

**Acceptance Criteria:**
- [ ] Local `getUnitLabel` stub deleted from `food-chat.tsx`
- [ ] `getUnitLabel` imported from `@/types` (same as `analysis-result.tsx`)
- [ ] Unit display shows correct labels (cups, slices, servings, etc.)

### FOO-385: No feedback when image compression fails in chat

**Priority:** Medium
**Labels:** Bug
**Description:** `Promise.allSettled` silently drops failed image compressions. If 5 images are selected and 2 fail, only 3 are added with zero notification.

**Acceptance Criteria:**
- [ ] When some images fail compression, user sees a warning message
- [ ] Warning specifies how many images failed (e.g., "2 of 5 photos couldn't be processed")
- [ ] Successfully compressed images are still added to pending

### FOO-386: Photo menu still interactive at message limit

**Priority:** Medium
**Labels:** Bug
**Description:** The text input has `disabled={loading || atLimit}` but the plus button only has `disabled={loading}`. Users can add photos at the limit but can't send them.

**Acceptance Criteria:**
- [ ] Plus button disabled when `atLimit` is true
- [ ] Photo menu cannot be opened at the limit

### FOO-388: No timeout protection on chat API calls

**Priority:** Medium
**Labels:** Bug
**Description:** Both `/api/chat-food` and `/api/log-food` fetch calls have no timeout. The UI can hang indefinitely on slow connections.

**Acceptance Criteria:**
- [ ] Both fetch calls use `AbortSignal.timeout()` with a reasonable timeout (30s for chat, 15s for log)
- [ ] Timeout errors display a user-friendly message
- [ ] AbortController provides cleanup on component unmount

### FOO-389: Scroll-to-bottom button below minimum touch target

**Priority:** Medium
**Labels:** Convention
**Description:** The scroll-to-bottom button uses `size-9` (36px), violating the 44px minimum touch target requirement.

**Acceptance Criteria:**
- [ ] Button uses `size-11` (44px) instead of `size-9`
- [ ] Icon size unchanged, only the tappable area increases

### FOO-390: Chat error message not dismissible

**Priority:** Medium
**Labels:** Improvement
**Description:** Error messages persist until the next send attempt. No close button or auto-dismiss.

**Acceptance Criteria:**
- [ ] Error message has a dismiss (X) button
- [ ] Clicking dismiss clears the error
- [ ] Error is still cleared on next send attempt (existing behavior preserved)

### FOO-391: Photo menu doesn't close on outside click or Escape

**Priority:** Medium
**Labels:** Improvement
**Description:** The photo menu can only be closed by clicking the plus button. No outside-click or Escape key support.

**Acceptance Criteria:**
- [ ] Pressing Escape closes the photo menu
- [ ] Clicking outside the photo menu area closes it
- [ ] Plus button toggle still works

### FOO-392: No loading indicator during photo compression

**Priority:** Medium
**Labels:** Improvement
**Description:** After selecting photos, there's no visual feedback during compression (1-2s on slow devices). The UI appears frozen.

**Acceptance Criteria:**
- [ ] A loading state is shown while images are compressing
- [ ] Send button disabled during compression
- [ ] Loading state clears when compression finishes

### FOO-394: Message limit warning unclear in chat

**Priority:** Medium
**Labels:** Improvement
**Description:** The "X messages remaining" warning doesn't explain what happens at the limit or encourage logging.

**Acceptance Criteria:**
- [ ] Warning text provides context (e.g., "X refinements remaining")
- [ ] At-limit state shows a message explaining the limit is reached and encouraging logging
- [ ] Warning is clear and actionable

### FOO-397: No maxLength on chat text input

**Priority:** Low
**Labels:** Improvement
**Description:** The chat text input has no `maxLength`. Users could paste arbitrarily long text.

**Acceptance Criteria:**
- [ ] Input has a `maxLength` of 500 characters
- [ ] No character counter needed (low priority, simple guard)

### FOO-398: Missing accessibility label on meal type selector in chat

**Priority:** Low
**Labels:** Convention
**Description:** The `MealTypeSelector` in the chat header has no associated Label or aria-label. Screen readers can't identify its purpose.

**Acceptance Criteria:**
- [ ] MealTypeSelector has an `aria-label` prop or a visually-hidden Label
- [ ] Screen reader announces the purpose of the selector

### FOO-381: Replace inline nutrition text with mini nutrition card in chat refinement

**Priority:** Medium
**Labels:** Feature
**Description:** The AnalysisSummary sub-component displays nutrition as inline P:/C:/F: abbreviations. Replace with a compact card based on the FDA-style NutritionFactsCard layout.

**Acceptance Criteria:**
- [ ] New `MiniNutritionCard` component created
- [ ] Compact layout: food name, serving, calories prominent, macros in a row
- [ ] Change highlighting preserved (bold changed values vs previous analysis)
- [ ] Replaces AnalysisSummary in assistant chat bubbles
- [ ] Old AnalysisSummary code deleted

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Dependencies installed (`npm install`)

## Implementation Tasks

### Task 1: Fix unit labels — import canonical getUnitLabel

**Issue:** FOO-382
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update existing test `"shows analysis summary in assistant message when analysis is present"` to assert correct unit label output. Create a new test with a non-gram unit (e.g., `unit_id: 91` for cups) that asserts the display shows "2 cups" not "2 units". Use a mock analysis with `amount: 2, unit_id: 91`.
   - Run: `npm test -- food-chat`
   - Verify: New test fails because local stub returns "units" for cup unit

2. **GREEN** — Delete the local `getUnitLabel` function (lines 38-42). Add `getUnitLabel` to the import from `@/types`. Update `AnalysisSummary` to call `getUnitLabel(analysis.unit_id, analysis.amount)` instead of `{analysis.amount}{getUnitLabel(analysis.unit_id)}`.
   - Run: `npm test -- food-chat`
   - Verify: All tests pass, including new unit label test

**Notes:**
- Reference `src/components/analysis-result.tsx:4` for the import pattern
- The canonical `getUnitLabel` in `src/types/index.ts:47-53` takes `(unitId, amount)` and returns a full string like "2 cups" — adjust the template accordingly since the old code concatenated `{analysis.amount}{getUnitLabel(...)}` separately

### Task 2: Fix scroll button touch target

**Issue:** FOO-389
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that renders the chat, simulates scrolling to show the scroll-down button, and asserts the button has the `size-11` class (or a minimum 44px dimension check). The button appears when `showScrollDown` is true — trigger this by manipulating the scroll container's scroll state.
   - Run: `npm test -- food-chat`
   - Verify: Fails because button has `size-9`

2. **GREEN** — Change `size-9` to `size-11` on the scroll-to-bottom button at line 429. Keep the icon classes unchanged.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- Testing scroll state may be tricky in jsdom. An alternative is to test the rendered className directly by mocking the scroll state. Consider setting `showScrollDown` via internal component state manipulation or just verifying the button element's class when it's visible.
- The button also needs `absolute -top-14` instead of `-top-12` to account for the larger size — adjust the positioning offset.

### Task 3: Add accessibility label to MealTypeSelector in chat

**Issue:** FOO-398
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/meal-type-selector.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that the MealTypeSelector in the chat has an accessible label. Since the component is mocked in tests, update the mock to accept and render an `aria-label` prop. Assert `screen.getByLabelText("Meal type")` finds the selector.
   - Run: `npm test -- food-chat`
   - Verify: Fails because no aria-label is set

2. **GREEN** — Add `aria-label="Meal type"` to the `MealTypeSelector` component's `SelectTrigger`. Pass it through the `MealTypeSelectorProps` interface or apply it internally. In `food-chat.tsx`, the component already receives the selector — ensure the label reaches the trigger. The simplest approach: add an `ariaLabel` prop to `MealTypeSelector` and forward it to `SelectTrigger`'s `aria-label`.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- The `MealTypeSelector` already accepts an `id` prop (line 18). Add a similar `ariaLabel` prop. The analyzer page can continue without one since it has a visible `<Label>` element.

### Task 4: Disable photo menu at message limit

**Issue:** FOO-386
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that creates a FoodChat at the message limit (set up messages state to hit `MAX_MESSAGES`), then asserts the plus (add photo) button is disabled. The tricky part is reaching the limit — you'll need to send enough messages via mocked fetch responses to hit `apiMessageCount >= MAX_MESSAGES`.
   - Run: `npm test -- food-chat`
   - Verify: Fails because plus button is only disabled when loading

2. **GREEN** — Change the plus button's `disabled` prop from `disabled={loading}` to `disabled={loading || atLimit}` at line 501. Also close the photo menu when atLimit transitions to true (to handle edge case where menu is open when last message comes back).
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- Setting up the at-limit state in tests requires either: (a) rendering with enough initial messages in the state, or (b) mocking multiple send/response cycles. Option (a) is simpler — consider creating a helper that builds the initial `messages` prop or testing the disabled state directly.
- Since `messages` is internal state initialized from `initialMessage`, testing the limit requires sending messages through the API flow. Consider extracting `MAX_MESSAGES` to a named constant export for test access, or hardcode the number in the test since it's unlikely to change.

### Task 5: Add maxLength to chat input

**Issue:** FOO-397
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test asserting the input element has `maxLength` attribute set to 500.
   - Run: `npm test -- food-chat`
   - Verify: Fails because no maxLength is set

2. **GREEN** — Add `maxLength={500}` to the `<Input>` component at line 511.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

### Task 6: Make error message dismissible

**Issue:** FOO-390
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Extend the existing error test: after the error message appears, find a dismiss button (`aria-label="Dismiss error"`), click it, and assert the error message is removed.
   - Run: `npm test -- food-chat`
   - Verify: Fails because no dismiss button exists

2. **GREEN** — Add an X button to the error div at lines 413-417. The button calls `setError(null)`. Use the `X` icon already imported from lucide-react. Ensure the dismiss button has `aria-label="Dismiss error"` and meets the 44px touch target.
   - Run: `npm test -- food-chat`
   - Verify: Test passes

**Notes:**
- Keep the error inside the scrollable area (existing positioning). Add the X button inline, e.g., a flex row with the error text and a dismiss button on the right.

### Task 7: Improve limit warning text

**Issue:** FOO-394
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the improved warning copy:
   - Near-limit warning should contain "refinements remaining" (not just "messages remaining")
   - At-limit state should show a message like "Refinement limit reached"
   - Run: `npm test -- food-chat`
   - Verify: Fails because current text is "X messages remaining"

2. **GREEN** — Update the nearLimit warning text from `"{count} messages remaining"` to `"{count} refinements remaining — log when ready"`. Add an at-limit message below the input area: `"Refinement limit reached — log your food to save."` (only shown when `atLimit` is true).
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

**Notes:**
- The at-limit message is a new addition — currently nothing tells the user why the input is disabled when at limit. Place it in the same location as the nearLimit warning.

### Task 8: Add feedback for compression failures

**Issue:** FOO-385
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Mock `compressImage` to reject for some files. Select 3 files where 1 fails compression. Assert a warning message appears (e.g., "1 of 3 photos couldn't be processed"). Assert the 2 successful images are still added to pending.
   - Run: `npm test -- food-chat`
   - Verify: Fails because no warning is shown

2. **GREEN** — In `handleFileSelected`, after filtering fulfilled results, count rejected results. If any rejections exist, show a temporary warning using the existing `error` state or a separate `compressionWarning` state. A separate state is cleaner — display it near the photo indicator area. Auto-dismiss after 5 seconds using a timeout.
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

**Notes:**
- Use a separate `compressionWarning` state (not `error`) to avoid conflicting with API error messages. Render the warning above the photo indicator if present.
- The warning should auto-dismiss. Use `setTimeout` with cleanup in a `useEffect` or directly in the handler.

### Task 9: Add loading indicator during photo compression

**Issue:** FOO-392
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Mock `compressImage` to return a delayed promise. Select files and assert a "Processing photos..." indicator appears. Also assert the send button is disabled during compression.
   - Run: `npm test -- food-chat`
   - Verify: Fails because no compression loading state exists

2. **GREEN** — Add a `compressing` boolean state. Set it `true` before `Promise.allSettled`, `false` after. While `compressing`, show a small indicator in the photo area (e.g., "Processing photos..." with a Loader2 spinner). Add `compressing` to the send button's disabled condition.
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

**Notes:**
- The `compressing` state should also disable the plus button to prevent selecting more photos while processing.
- Display location: same area as the photo indicator (`pendingImages.length > 0` section), but shown when `compressing` is true regardless of pending count.

### Task 10: Add outside click and Escape to close photo menu

**Issue:** FOO-391
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write two tests:
   - Open photo menu, press Escape, assert menu closes
   - Open photo menu, click outside the menu area, assert menu closes
   - Run: `npm test -- food-chat`
   - Verify: Both fail

2. **GREEN** — Add a `useEffect` that listens for keydown `Escape` when `showPhotoMenu` is true. For click-outside, add a ref to the photo menu area and a mousedown listener on the document that checks if the click target is outside the menu ref and the plus button. Call `setShowPhotoMenu(false)` in both handlers.
   - Run: `npm test -- food-chat`
   - Verify: Both tests pass

**Notes:**
- Use `mousedown` (not `click`) for outside detection to handle edge cases where click events are consumed.
- Clean up event listeners when the menu closes or the component unmounts.
- The plus button already toggles the menu — ensure the outside-click handler doesn't interfere with the toggle (exclude the plus button from outside-click detection).

### Task 11: Add AbortController timeout to fetch calls

**Issue:** FOO-388
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for timeout behavior:
   - Chat send: mock fetch to never resolve, assert that after timeout the error message shows a timeout-specific message
   - Log food: same pattern for the log endpoint
   - Note: Use `AbortSignal.timeout()` which is available in modern environments. For testing, mock the fetch to reject with an `AbortError`.
   - Run: `npm test -- food-chat`
   - Verify: Tests fail

2. **GREEN** — Add `signal: AbortSignal.timeout(30000)` to the `/api/chat-food` fetch call. Add `signal: AbortSignal.timeout(15000)` to the `/api/log-food` fetch call. In the catch blocks, detect `AbortError` (or `TimeoutError`) and set a user-friendly message like "Request timed out. Please try again."
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

3. **REFACTOR** — Extract the timeout values to named constants at the top of the file: `const CHAT_TIMEOUT_MS = 30_000` and `const LOG_TIMEOUT_MS = 15_000`.

**Notes:**
- `AbortSignal.timeout()` is a static method available in modern browsers and Node 17.3+. It throws a `TimeoutError` (name: "TimeoutError") which is a subclass of `DOMException`.
- For component unmount cleanup: the timeout signal handles the primary use case. Full unmount cleanup with a separate `AbortController` per request is a nice-to-have but not required for this issue.
- Test approach: mock `fetch` to reject with `new DOMException("signal timed out", "TimeoutError")`.

### Task 12: Replace AnalysisSummary with MiniNutritionCard

**Issue:** FOO-381
**Files:**
- `src/components/mini-nutrition-card.tsx` (create)
- `src/components/__tests__/mini-nutrition-card.test.tsx` (create)
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Create test file `src/components/__tests__/mini-nutrition-card.test.tsx`. Test that the component renders:
   - Food name
   - Serving size with correct unit label (uses `getUnitLabel` from `@/types`)
   - Calories prominently
   - Macro row: protein, carbs, fat values
   - Change highlighting: when `previousAnalysis` is provided, changed fields render with a visual indicator (bold/highlight class)
   - Run: `npm test -- mini-nutrition-card`
   - Verify: Fails (file doesn't exist)

2. **GREEN** — Create `src/components/mini-nutrition-card.tsx`. Build a compact FDA-inspired card:
   - Food name and serving line at top
   - Calories displayed prominently
   - Macros (P/C/F) in a horizontal row
   - Accept `analysis: FoodAnalysis` and `previousAnalysis?: FoodAnalysis` props
   - Use `getUnitLabel` from `@/types` for serving display
   - Apply `font-semibold` class to values that differ from `previousAnalysis`
   - Style: `border rounded-lg p-2 text-sm` — compact but readable
   - Run: `npm test -- mini-nutrition-card`
   - Verify: Tests pass

3. **RED** — Update `food-chat.test.tsx`: change the analysis summary assertion from checking for "P: 0g" inline text to checking for the MiniNutritionCard rendered output (e.g., "Protein" label with "0g" value). Update the mock to include the new component's expected output.
   - Run: `npm test -- food-chat`
   - Verify: Fails because food-chat still uses AnalysisSummary

4. **GREEN** — In `food-chat.tsx`:
   - Import `MiniNutritionCard` from `@/components/mini-nutrition-card`
   - Replace the `<AnalysisSummary>` usage in the message rendering with `<MiniNutritionCard>`
   - Delete the `AnalysisSummary` function component entirely
   - Run: `npm test -- food-chat`
   - Verify: All tests pass

**Notes:**
- Reference `src/components/nutrition-facts-card.tsx` for the FDA-style layout pattern but make it significantly more compact — this goes inside a chat bubble.
- The card should work within the `max-w-[80%]` chat bubble constraint.
- Keep the same `previousAnalysis` diffing logic to highlight changed values.

### Task 13: Integration & Verification

**Issues:** All
**Files:** All modified files

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Open chat with a food analysis
   - [ ] Verify correct unit labels for non-gram units
   - [ ] Verify mini nutrition card displays in chat bubbles
   - [ ] Verify scroll-to-bottom button is tappable
   - [ ] Verify photo menu closes on Escape and outside click
   - [ ] Verify error dismiss button works
   - [ ] Verify compression loading indicator appears
   - [ ] Verify limit warning text is clear
   - [ ] Verify input has maxLength
   - [ ] Verify photo menu disabled at limit

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Non-gram unit display | Shows correct label (cups, slices, etc.) | Unit test (Task 1) |
| Image compression failure | Shows warning with failure count | Unit test (Task 8) |
| API timeout | Shows "Request timed out" message | Unit test (Task 11) |
| At message limit | Plus button disabled, warning shown | Unit test (Tasks 4, 7) |

## Risks & Open Questions

- [ ] `AbortSignal.timeout()` browser support: available in all modern browsers (Chrome 103+, Safari 16+, Firefox 100+). Should be fine for a mobile food app targeting recent devices.
- [ ] MiniNutritionCard layout within 80% chat bubble: needs visual testing on iPhone SE (320px viewport * 0.8 = 256px available). Keep the card simple to fit.
- [ ] Photo menu outside-click detection: need to ensure it doesn't interfere with the file input dialogs triggered by Camera/Gallery buttons (the menu already closes via `setShowPhotoMenu(false)` in those handlers).

## Scope Boundaries

**In Scope:**
- All 12 valid Backlog issues listed above
- Changes to `food-chat.tsx` and its tests
- New `MiniNutritionCard` component
- Minor change to `MealTypeSelector` for accessibility

**Out of Scope:**
- FOO-393 (Canceled: superseded by FOO-381 — AnalysisSummary being replaced entirely)
- Service worker / offline support
- API-side validation changes
- Changes to other pages or components beyond what's needed for these fixes
