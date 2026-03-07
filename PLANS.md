# Implementation Plan

**Created:** 2026-03-07
**Source:** Bug report: UI controls disappear during HEIC photo processing; sticky CTA floats disconnected when keyboard opens
**Linear Issues:** [FOO-852](https://linear.app/lw-claude/issue/FOO-852/bug-ui-controls-disappear-during-heic-photo-processing), [FOO-853](https://linear.app/lw-claude/issue/FOO-853/bug-sticky-cta-bar-floats-disconnected-when-keyboard-opens)
**Branch:** fix/FOO-852-heic-processing-ui

## Context Gathered

### Codebase Analysis
- **Related files:** `src/components/photo-capture.tsx`, `src/components/__tests__/photo-capture.test.tsx`, `src/lib/image.ts`, `src/components/food-analyzer.tsx`, `src/components/__tests__/food-analyzer.test.tsx`, `src/hooks/use-keyboard-height.ts`, `src/components/bottom-nav.tsx`
- **Existing patterns:** Processing state uses `processingCount` integer; preview generation uses `Promise.allSettled`; tests mock `isHeicFile` and `convertHeicToJpeg` from `@/lib/image`; sticky CTA bar uses `useKeyboardHeight` hook to reposition when keyboard opens; bottom nav is `fixed bottom-0 z-50`
- **Test conventions:** Colocated `__tests__/` directory, uses Vitest + Testing Library, mocks `next/image`, `URL.createObjectURL`, and `@/lib/image` module

### Investigation

**Bug report:** When processing HEIC images, the UI "disappears" — Take Photo/Gallery buttons vanish and existing photo thumbnails lose their delete buttons. The UI looks broken/frozen for the entire duration of HEIC conversion (2-5+ seconds).

**Classification:** Frontend Bug / Medium / PhotoCapture component

**Root cause:** Three interconnected issues in `photo-capture.tsx`:

1. **Buttons hidden during processing:** `canAddMore` on line 267 requires `processingCount === 0`, which hides Take Photo/Gallery buttons (line 293) during HEIC conversion. The race condition is already guarded by the early return at lines 97-102, making the button hiding unnecessary.

2. **Delete buttons hidden during processing:** Line 383 wraps delete buttons in `{processingCount === 0 && (...)}`, hiding delete buttons on ALL existing photo thumbnails during processing. Users cannot manage existing photos while a new one converts.

3. **All photos re-converted on each addition:** Line 137 maps `combinedPhotos` (all photos, old + new) through HEIC conversion. Previously converted photos get re-converted, multiplying processing time and extending the broken UI state.

**Evidence:**
- `src/components/photo-capture.tsx:267` — `canAddMore` gated on `processingCount === 0`
- `src/components/photo-capture.tsx:293` — buttons only render when `canAddMore`
- `src/components/photo-capture.tsx:383` — delete buttons gated on `processingCount === 0`
- `src/components/photo-capture.tsx:97-102` — early return already prevents race conditions during processing
- `src/components/photo-capture.tsx:137-142` — re-converts all photos including previously converted ones

**Impact:** Every HEIC photo addition causes a multi-second period where the UI appears broken. Users cannot remove photos or understand what's happening. Adding multiple HEIC photos compounds the issue since all are re-converted each time.

**Bug report 2:** The "Analyze Food" CTA button floats disconnected when the mobile keyboard opens. It moves up with the keyboard but appears to float in mid-screen, not attached to anything.

**Classification:** Frontend Bug / Medium / FoodAnalyzer sticky CTA bar

**Root cause:** In `food-analyzer.tsx` lines 812-815, when `keyboardHeight > 0`:
- The outer div uses `bottom: ${keyboardHeight}px` (inline style) but drops the static `bottom-[calc(4rem+...)]` class
- The inner container uses `bg-background/80 backdrop-blur-sm border-t` — semi-transparent with only a top border
- The bottom nav (z-50, `fixed bottom-0`) is hidden behind the keyboard
- Result: the CTA bar floats in mid-screen with no visual connection above or below

**Evidence:**
- `src/components/food-analyzer.tsx:812` — conditional class drops bottom positioning when keyboard open
- `src/components/food-analyzer.tsx:813` — inline style sets `bottom: keyboardHeight` with no visual anchoring
- `src/components/food-analyzer.tsx:815` — `bg-background/80 backdrop-blur-sm border-t` — translucent, top-border only
- `src/components/bottom-nav.tsx:41` — bottom nav at `fixed bottom-0 z-50`, hidden behind keyboard
- `src/hooks/use-keyboard-height.ts:11` — `window.innerHeight - viewport.height - viewport.offsetTop` can leave gap on some devices

**Impact:** On mobile, whenever the user taps the description field and the keyboard opens, the CTA button looks broken/floating. This is the primary action button for the analyze screen.

## Tasks

### Task 1: Keep delete buttons visible during HEIC processing
**Linear Issue:** [FOO-852](https://linear.app/lw-claude/issue/FOO-852/bug-ui-controls-disappear-during-heic-photo-processing)
**Files:**
- `src/components/__tests__/photo-capture.test.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Write test: when HEIC conversion is in progress (`processingCount > 0`), existing photo thumbnails still show their "Remove photo N" buttons. Use the existing mock pattern where `mockConvertHeicToJpeg` returns a pending promise, then assert `screen.getByRole("button", { name: "Remove photo 1" })` is present.
2. Run verifier with test pattern (expect fail — current code hides delete buttons when `processingCount > 0`)
3. Remove the `processingCount === 0` guard around the delete button JSX at line 383. The delete button should always render when previews exist.
4. Run verifier with test pattern (expect pass)

**Notes:**
- The early return at lines 97-102 already prevents new file selections during processing, so hiding delete buttons is unnecessary
- Must also verify that removing a photo during processing doesn't cause state corruption — the existing `handleRemovePhoto` function filters by index, which should be safe since `processingCount` only affects the placeholder count

### Task 2: Keep Take Photo / Gallery buttons visible during processing
**Linear Issue:** [FOO-852](https://linear.app/lw-claude/issue/FOO-852/bug-ui-controls-disappear-during-heic-photo-processing)
**Files:**
- `src/components/__tests__/photo-capture.test.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Write test: when HEIC conversion is in progress, "Take Photo" and "Choose from Gallery" buttons remain visible. Assert they are present even while `processing-placeholder` is shown.
2. Run verifier with test pattern (expect fail — `canAddMore` is false when `processingCount > 0`)
3. Decouple `canAddMore` from `processingCount`. The `canAddMore` condition should only check `totalPhotoCount < maxPhotos`. The race condition protection at lines 97-102 (early return when `processingCount > 0`) already prevents new file additions during processing, so hiding the buttons is redundant.
4. Run verifier with test pattern (expect pass)

**Notes:**
- The buttons will be visible but effectively non-functional during processing (the early return at line 98 silently discards new selections). This is acceptable UX — the user sees the buttons and the processing spinner, understanding that processing is in progress.

### Task 3: Only convert new HEIC files, skip already-converted photos
**Linear Issue:** [FOO-852](https://linear.app/lw-claude/issue/FOO-852/bug-ui-controls-disappear-during-heic-photo-processing)
**Files:**
- `src/components/__tests__/photo-capture.test.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Write test: when adding a second photo (HEIC or not) to an existing set that included a HEIC, `convertHeicToJpeg` is called only for the NEW file(s), not for previously added photos. Track `mockConvertHeicToJpeg.mock.calls` count across two sequential file additions.
2. Run verifier with test pattern (expect fail — current code re-maps all `combinedPhotos`)
3. Refactor `handleFileChange` to only process new files through the HEIC conversion pipeline. Preserve the already-converted blobs from `convertedBlobsState` for existing photos. Combine the preserved blobs with newly converted blobs when setting state.
4. Run verifier with test pattern (expect pass)

**Notes:**
- The key insight is that `convertedBlobsState` already holds the converted blobs for existing photos. Only `newFiles` need to go through `isHeicFile`/`convertHeicToJpeg`. The final state should be `[...existingConvertedBlobs, ...newlyConvertedBlobs]`.
- `processingCount` should reflect only the new files being processed (it already does — `actualNewCount` on line 129)

### Task 4: Fix sticky CTA bar floating appearance when keyboard opens
**Linear Issue:** [FOO-853](https://linear.app/lw-claude/issue/FOO-853/bug-sticky-cta-bar-floats-disconnected-when-keyboard-opens)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**Steps:**
1. Write test: when `keyboardHeight > 0` (mock `useKeyboardHeight` to return a positive value), the sticky CTA bar's inner container has an opaque background (not `bg-background/80`) and a bottom border. Assert the inner div's className includes `bg-background` (not `/80`) and `border-b`.
2. Run verifier with test pattern (expect fail — current code always uses `bg-background/80` and only `border-t`)
3. In the sticky CTA bar JSX (lines 810-847), make the inner container's styles conditional on `keyboardHeight`:
   - When `keyboardHeight > 0`: use opaque `bg-background` (drop the `/80` and `backdrop-blur-sm`), add `border-b` alongside `border-t`, and add bottom padding to extend the bar visually toward the keyboard edge
   - When `keyboardHeight === 0`: keep current `bg-background/80 backdrop-blur-sm border-t` styling
4. Run verifier with test pattern (expect pass)

**Notes:**
- The opaque background prevents content from showing through, which eliminates the "floating" appearance
- Adding `border-b` gives the bar a visible bottom edge when it's not sitting on the bottom nav
- Bottom padding (e.g., `pb-2`) helps fill any sub-pixel gap between the bar and the keyboard

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix two analyze screen UX bugs: HEIC processing hides UI controls, and sticky CTA bar floats disconnected when keyboard opens.
**Linear Issues:** FOO-852, FOO-853
**Approach:** (1) Remove unnecessary `processingCount === 0` guards from button visibility — the early-return race condition guard already handles concurrent file selections. Optimize HEIC conversion to only process new files. (2) Make the sticky CTA bar's background opaque and add a bottom border when the keyboard is open, so it looks anchored instead of floating.
**Scope:** 4 tasks, 4 files, 4 tests
**Key Decisions:** Keep buttons visible but non-functional during processing (early return handles the race condition). Switch CTA bar from translucent to opaque when keyboard is open.
**Risks:** Removing a photo during processing could theoretically cause index mismatches, but the existing filter-by-index approach in `handleRemovePhoto` is safe since processing placeholders are separate from previews.
