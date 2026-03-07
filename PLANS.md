# Implementation Plan

**Created:** 2026-03-07
**Source:** Bug report: UI controls disappear during HEIC photo processing — buttons and delete icons vanish while converting HEIC images
**Linear Issues:** [FOO-852](https://linear.app/lw-claude/issue/FOO-852/bug-ui-controls-disappear-during-heic-photo-processing)
**Branch:** fix/FOO-852-heic-processing-ui

## Context Gathered

### Codebase Analysis
- **Related files:** `src/components/photo-capture.tsx`, `src/components/__tests__/photo-capture.test.tsx`, `src/lib/image.ts`
- **Existing patterns:** Processing state uses `processingCount` integer; preview generation uses `Promise.allSettled`; tests mock `isHeicFile` and `convertHeicToJpeg` from `@/lib/image`
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

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix HEIC processing UX where buttons and delete icons disappear during conversion, making the UI appear broken.
**Linear Issues:** FOO-852
**Approach:** Remove the unnecessary `processingCount === 0` guards from button visibility (the early-return race condition guard already handles concurrent file selections). Optimize HEIC conversion to only process new files instead of re-converting all photos on each addition.
**Scope:** 3 tasks, 2 files, 3 tests
**Key Decisions:** Keep buttons visible but non-functional during processing (early return handles the race condition). This is better UX than hiding buttons entirely.
**Risks:** Removing a photo during processing could theoretically cause index mismatches, but the existing filter-by-index approach in `handleRemovePhoto` is safe since processing placeholders are separate from previews.
