# Implementation Plan

**Created:** 2026-03-07
**Source:** Bug report: Analyze screen UX — layout shift from "Start over", CTA hidden by keyboard, photo buttons disappear, confusing + tile dropdown
**Linear Issues:** [FOO-843](https://linear.app/lw-claude/issue/FOO-843/ui-fix-analyze-screen-ux-layout-shift-keyboard-hidden-cta-photo-button)
**Branch:** fix/FOO-843-analyze-screen-ux

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/food-analyzer.tsx` — Main analyzer component with "Start over" button and sticky CTA
  - `src/components/photo-capture.tsx` — Photo capture with conditional buttons and + tile dropdown
  - `src/app/app/analyze/page.tsx` — Page layout with `<h1>Analyze Food</h1>` header
  - `src/components/__tests__/food-analyzer.test.tsx` — Extensive tests including "Start over button" describe block
  - `src/components/__tests__/photo-capture.test.tsx` — Tests for add-photo-tile dropdown behavior
- **Existing patterns:**
  - Sticky CTA bar uses `fixed bottom-[calc(4rem+env(safe-area-inset-bottom))]` positioning
  - Photo buttons use shadcn `Button` with `variant="outline"`
  - DropdownMenu from `@/components/ui/dropdown-menu` wraps the + tile
  - `hasContent` boolean gates "Start over" visibility
- **Test conventions:** Colocated `__tests__/` dirs, `vi.fn()` mocks, `waitFor` for async, `fireEvent`/`userEvent`

### Investigation

**Bug report:** Four UX issues on the analyze screen: (1) "Start over" link appears when typing, shifting UI down; (2) Analyze button hidden behind mobile keyboard; (3) Photo buttons disappear after first photo; (4) Dropdown menu on + tile is confusing.

**Classification:** Frontend Bug / High / Analyze Screen

**Root cause:**
1. Conditional rendering `{hasContent && ...}` at `food-analyzer.tsx:676` inserts "Start over" into the flow when user starts typing, pushing all content down.
2. Sticky CTA at `food-analyzer.tsx:803-806` uses `fixed bottom-[calc(4rem+...)]` which doesn't account for the virtual keyboard on mobile — the button stays behind the keyboard.
3. `{!hasPhotos && ...}` guard at `photo-capture.tsx:343` hides "Take Photo"/"Choose from Gallery" buttons entirely when any photo exists.
4. `DropdownMenu` wrapping the + tile at `photo-capture.tsx:504-526` (and `429-451` for restored) introduces an unexpected interaction pattern.

**Evidence:**
- `src/components/food-analyzer.tsx:676-686` — "Start over" conditionally rendered inline
- `src/components/food-analyzer.tsx:803-806` — Sticky CTA fixed positioning
- `src/components/photo-capture.tsx:343` — `{!hasPhotos && ...}` hides buttons
- `src/components/photo-capture.tsx:504-526` — DropdownMenu on + tile
- `src/app/app/analyze/page.tsx:25` — `<h1>` header where "Start over" should move to

**Impact:** On mobile, the primary workflow (take photo -> type description -> analyze) is broken because: the UI jumps when typing, the analyze button is unreachable with keyboard open, and adding more photos requires discovering a hidden interaction pattern.

## Tasks

### Task 1: Move "Start over" into the page header row
**Linear Issue:** [FOO-843](https://linear.app/lw-claude/issue/FOO-843/ui-fix-analyze-screen-ux-layout-shift-keyboard-hidden-cta-photo-button)
**Files:**
- `src/app/app/analyze/page.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. Update tests in the "Start over button" describe block: the "Start over" button should render inside a flex row that also contains the `<h1>Analyze Food</h1>` heading. When `hasContent` is false the button is not in the DOM (conditional render is fine). When `hasContent` is true the button appears — but no layout shift occurs because the row height is always set by the h1, not the button. Tests that check "is NOT shown when no content exists" stay as-is (button not in DOM). Tests that check it IS shown should verify the button is inside the same container as the heading.
2. Run verifier with pattern "Start over" (expect fail)
3. In `food-analyzer.tsx`, move the `<h1>Analyze Food</h1>` from `page.tsx` into `FoodAnalyzer` as the first element inside the main `div`. Wrap it in a `flex items-center justify-between` row. Place the "Start over" button (conditionally rendered with `{hasContent && ...}`) on the right side of this row. Since the h1 always determines the row height, conditionally adding/removing the button causes no vertical shift. Remove the standalone `{hasContent && <div className="flex">...}` block that currently sits between the error display and PhotoCapture. Remove the `<h1>` from `page.tsx`.
4. Run verifier with pattern "Start over" (expect pass)

**Notes:**
- The h1 anchors the row height — the button appearing/disappearing doesn't shift anything because it's in the same flex row, not a separate block above the content.
- The AlertDialog for confirmation stays inside `food-analyzer.tsx` unchanged.

### Task 2: Reposition sticky CTA above virtual keyboard
**Linear Issue:** [FOO-843](https://linear.app/lw-claude/issue/FOO-843/ui-fix-analyze-screen-ux-layout-shift-keyboard-hidden-cta-photo-button)
**Files:**
- `src/hooks/use-keyboard-height.ts` (create)
- `src/hooks/__tests__/use-keyboard-height.test.ts` (create)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. Write tests for a `useKeyboardHeight` hook that returns the current keyboard height in pixels. It should listen to `window.visualViewport` `resize` events and compute `window.innerHeight - visualViewport.height - visualViewport.offsetTop`. Returns 0 when keyboard is closed. Must clean up the event listener on unmount.
2. Run verifier with pattern "use-keyboard-height" (expect fail)
3. Implement `useKeyboardHeight` in `src/hooks/use-keyboard-height.ts`. Use `useState` + `useEffect` with `visualViewport.addEventListener('resize', ...)`. Fall back to 0 if `visualViewport` is not available.
4. Run verifier with pattern "use-keyboard-height" (expect pass)
5. Write test in food-analyzer tests: when keyboard is open (mock `visualViewport`), the sticky CTA bar should have a bottom style that accounts for keyboard height.
6. Run verifier with pattern "sticky|CTA|keyboard" (expect fail)
7. In `food-analyzer.tsx`, use `useKeyboardHeight()` and apply the keyboard height to the sticky CTA bar's bottom style. When keyboard is open (`keyboardHeight > 0`), set `bottom` to `keyboardHeight` pixels via inline style instead of the Tailwind class. When keyboard is closed (`keyboardHeight === 0`), keep the existing `calc(4rem + env(safe-area-inset-bottom))` positioning. Also ensure the CTA doesn't cover the description textarea — increase `pb-24` on the scrollable container proportionally when the CTA moves up.
8. Run verifier with pattern "sticky|CTA|keyboard" (expect pass)

**Notes:**
- `visualViewport` API is supported on iOS Safari 13+, Chrome 61+, Firefox 91+ — well within our support matrix.
- When keyboard is open, the bottom nav bar is typically hidden by the keyboard too, so we don't need to add `4rem` for it — just position at `keyboardHeight` pixels from viewport bottom.
- When keyboard is closed (`keyboardHeight === 0`), fall back to the existing `calc(4rem + env(safe-area-inset-bottom))` positioning.

### Task 3: Keep photo buttons always visible, remove + tile dropdown
**Linear Issue:** [FOO-843](https://linear.app/lw-claude/issue/FOO-843/ui-fix-analyze-screen-ux-layout-shift-keyboard-hidden-cta-photo-button)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/__tests__/photo-capture.test.tsx` (modify)

**Steps:**
1. Update tests: "Take Photo" and "Choose from Gallery" buttons should be visible both when no photos exist AND when photos exist but `canAddMore` is true. Remove/update tests that assert `add-photo-tile` exists or that clicking it opens a dropdown. Add test: buttons are hidden when photo count equals max.
2. Run verifier with pattern "photo-capture" (expect fail)
3. In `photo-capture.tsx`:
   - Change the `{!hasPhotos && ...}` guard on the buttons (line 343) to `{canAddMore && ...}` so buttons show whenever more photos can be added.
   - Remove the `DropdownMenu` + `DropdownMenuTrigger` + `DropdownMenuContent` + `DropdownMenuItem` wrapper around the + tile in both the `previews` section (lines 504-526) and the `restoredPreviews` section (lines 429-451). Remove the + tile entirely.
   - Remove the `DropdownMenu` imports since they're no longer used.
   - Remove the `Plus` icon import if no longer used.
4. Run verifier with pattern "photo-capture" (expect pass)

**Notes:**
- The buttons should appear below the photo grid when photos exist, using the same styling as the empty state (side-by-side `flex-1` outline buttons).
- The `canAddMore` variable already exists at line 317 and correctly checks `totalPhotoCount < maxPhotos && processingCount === 0`.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix four UX issues on the analyze screen that break the mobile workflow — layout shift, hidden CTA, disappearing photo buttons, and confusing dropdown.
**Linear Issues:** FOO-843
**Approach:** (1) Move "Start over" into the same flex row as the h1 heading — the h1 anchors the row height so the button appearing/disappearing causes no layout shift. (2) Create a `useKeyboardHeight` hook using the `visualViewport` API and use it to reposition the sticky CTA above the virtual keyboard. (3) Show "Take Photo"/"Choose from Gallery" buttons whenever more photos can be added, and remove the + tile with its dropdown menu entirely.
**Scope:** 3 tasks, 6 files, ~8 tests
**Key Decisions:** Keep conditional rendering for "Start over" but place it inside the h1 row so the row height is stable. Use `visualViewport` API (widely supported) for keyboard detection. Move h1 into FoodAnalyzer to co-locate the header row.
**Risks:** `visualViewport` behavior varies slightly across browsers — the hook should gracefully fall back to 0 if the API is unavailable. Tests will need to mock `window.visualViewport`.
