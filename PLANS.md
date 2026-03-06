# Implementation Plan

**Created:** 2026-03-06
**Source:** Bug report: Photos are not persisted/displayed in analysis session restoration
**Linear Issues:** [FOO-822](https://linear.app/lw-claude/issue/FOO-822/bug-photocapture-doesnt-display-restored-session-photos), [FOO-823](https://linear.app/lw-claude/issue/FOO-823/bug-session-state-not-saved-when-only-photos-are-selected)
**Branch:** fix/FOO-822-photo-session-restore

## Context Gathered

### Codebase Analysis

- **Related files:**
  - `src/components/photo-capture.tsx` — Manages own internal `photos` (File[]) and `previews` (string[]) state. Accepts `onPhotosChange` callback but no prop for initial/restored photos.
  - `src/components/food-analyzer.tsx` — Passes `onPhotosChange` to PhotoCapture (line 664) but never passes restored blobs. Uses `convertedPhotoBlobs` for analysis (line 142) and "Start Fresh" visibility (line 643).
  - `src/hooks/use-analysis-session.ts` — `setPhotos` saves blobs to IndexedDB immediately (lines 218-221). Debounced save effect (lines 147-179) depends on `[description, analysis, analysisNarrative, mealTypeId, selectedTime, matches]` — photos NOT included.
  - `src/lib/analysis-session.ts` — `saveSessionPhotos()` stores blobs in IndexedDB, `saveSessionState()` stores serializable state in sessionStorage. Both keyed by session ID.
- **Existing patterns:**
  - PhotoCapture creates preview URLs via `URL.createObjectURL()` and revokes them on clear/unmount (lines 51-59).
  - Hook tests mock `@/lib/analysis-session` module and use `renderHook` + `act` (see `src/hooks/__tests__/use-analysis-session.test.ts`).
  - FoodAnalyzer tests mock `useAnalysisSession` hook with spy wrappers (see `src/components/__tests__/food-analyzer.test.tsx:49-60`).
- **Test conventions:**
  - Hook tests: `src/hooks/__tests__/use-analysis-session.test.ts` — `vi.mock`, `renderHook`, `waitFor`, `makeState()` helper.
  - Component tests: `src/components/__tests__/food-analyzer.test.tsx` — mocks child components, `render`, `screen`, `fireEvent`.

### Investigation

**Bug report:** Photos are not persisted in analysis sessions — two related bugs found during investigation.

**Classification:** Frontend Bug / High / Photo persistence in analysis sessions

**Root cause:** Two distinct bugs in the session persistence feature shipped in FOO-814 through FOO-821:

1. **PhotoCapture blind to restored photos:** `PhotoCapture` manages its own internal state and has no prop to receive restored blobs. After session restore, `convertedPhotoBlobs` has data but PhotoCapture shows "0/9 photos selected" with no previews.

2. **Photo-only sessions not saved:** The debounced save effect doesn't include photos in its dependency array. If a user selects photos without changing any other field, the session state is never written to sessionStorage, making photos in IndexedDB unreachable on restore.

**Evidence:**
- `src/components/photo-capture.tsx:29-33` — Props interface has no `restoredBlobs` or `initialPhotos` prop
- `src/components/photo-capture.tsx:40-42` — Internal state starts empty, no way to initialize from parent
- `src/components/food-analyzer.tsx:664` — PhotoCapture receives only `onPhotosChange` and `autoCapture`
- `src/hooks/use-analysis-session.ts:179` — Dependency array excludes photos/convertedPhotoBlobs
- `src/hooks/use-analysis-session.ts:213-225` — `setPhotos` saves to IndexedDB but doesn't trigger sessionStorage save
- `src/hooks/use-analysis-session.ts:122-123` — On restore, `photos: []` and `convertedPhotoBlobs: photoBlobs`

**Impact:** Users who navigate away mid-analysis see no photos when returning. Photos appear lost even though blobs may exist in IndexedDB. The "Start Fresh" link appears with no visible context of what's being restored.

## Tasks

### Task 1: Save session state after photo selection
**Linear Issue:** [FOO-823](https://linear.app/lw-claude/issue/FOO-823/bug-session-state-not-saved-when-only-photos-are-selected)
**Files:**
- `src/hooks/__tests__/use-analysis-session.test.ts` (modify)
- `src/hooks/use-analysis-session.ts` (modify)

**Steps:**
1. Write test: after calling `setPhotos` with files (no other state changes), assert `saveSessionState` is called. Use the existing mock setup and `makeState()` helper. The test should call `setPhotos` via `act()`, advance timers past DEBOUNCE_MS, and verify `mockSaveSessionState` was called with a valid session state containing `createdAt`.
2. Run verifier with pattern `use-analysis-session` (expect fail)
3. Fix: in `setPhotos` callback, after saving photos to IndexedDB, explicitly call `saveSessionState` with current state values. This ensures the session state entry exists even when no other fields have changed.
4. Run verifier with pattern `use-analysis-session` (expect pass)

**Notes:**
- The save should happen synchronously inside `setPhotos` (not via the debounced effect) to guarantee the state is written before the user potentially navigates away.
- Must use `createdAtRef.current` (set by `ensureSessionId`) for the `createdAt` field.
- The debounced save effect remains as-is for subsequent field changes — this is an additional save, not a replacement.

### Task 2: Display restored photos in PhotoCapture
**Linear Issue:** [FOO-822](https://linear.app/lw-claude/issue/FOO-822/bug-photocapture-doesnt-display-restored-session-photos)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. Write test in `food-analyzer.test.tsx`: when `useAnalysisSession` returns `wasRestored: true` with `convertedPhotoBlobs` containing blobs, assert that PhotoCapture receives the blobs as a `restoredBlobs` prop and preview images are rendered. Also test that photo count reflects the restored count.
2. Run verifier with pattern `food-analyzer` (expect fail)
3. Modify `PhotoCapture`:
   - Add optional `restoredBlobs?: Blob[]` prop to `PhotoCaptureProps`
   - Add a `useEffect` that fires when `restoredBlobs` is provided and internal `photos` is empty: create preview URLs from the blobs via `URL.createObjectURL()`, set `previews` state. Do NOT call `onPhotosChange` (parent already has these blobs).
   - Update photo count display to show `restoredBlobs.length` when internal `photos` is empty but restored blobs exist.
   - Ensure "Clear All" revokes restored preview URLs and calls `onPhotosChange([], [])` to signal parent.
4. Modify `FoodAnalyzer` (line 664): pass `restoredBlobs={wasRestored ? convertedPhotoBlobs : undefined}` to PhotoCapture. Cast to `Blob[]` if needed since `convertedPhotoBlobs` is `(File | Blob)[]`.
5. Run verifier with pattern `food-analyzer` (expect pass)

**Notes:**
- Preview URLs from restored blobs must be revoked on unmount and on clear — follow existing cleanup pattern at `photo-capture.tsx:51-59`.
- When user adds new photos after restore, the new photos should replace restored state. The existing `handleFileChange` flow handles this because it calls `onPhotosChange` which updates parent state.
- `URL.createObjectURL` works with both `Blob` and `File` — no conversion needed.
- When user clears restored photos, need to also clear the `restoredBlobs` by calling `onPhotosChange([], [])` which resets parent's `convertedPhotoBlobs`.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix two bugs where photos are not properly persisted and displayed in analysis session restoration.
**Linear Issues:** FOO-822, FOO-823
**Approach:** Task 1 fixes the save gap by explicitly writing session state to sessionStorage inside `setPhotos` so photo-only sessions are restorable. Task 2 fixes the display gap by adding a `restoredBlobs` prop to PhotoCapture so it can generate and render preview thumbnails from blobs passed by FoodAnalyzer on session restore.
**Scope:** 2 tasks, 4 files, 2+ tests
**Key Decisions:** Explicit save in `setPhotos` rather than adding photos to debounce dependency array (avoids redundant re-saves on every photo state change). Separate `restoredBlobs` prop rather than modifying PhotoCapture's internal state management (cleaner separation of concerns).
**Risks:** None significant — changes are additive and existing test coverage is good.

---

## Iteration 1

**Implemented:** 2026-03-06
**Method:** Single-agent (effort score 4, workers not justified)

### Tasks Completed This Iteration
- Task 1: Save session state after photo selection (FOO-823) - Added immediate `saveSessionState` call in `setPhotos` so photo-only sessions are restorable
- Task 2: Display restored photos in PhotoCapture (FOO-822) - Added `restoredBlobs` prop to PhotoCapture, state initializer for preview URLs, passed from FoodAnalyzer on restore

### Files Modified
- `src/hooks/use-analysis-session.ts` - Added immediate session state save in `setPhotos` callback
- `src/hooks/__tests__/use-analysis-session.test.ts` - Added test for photo-only session save, updated debounce test for immediate save
- `src/components/photo-capture.tsx` - Added `restoredBlobs` prop, restored preview state with initializer, clear handler with URL revocation, unmount cleanup for restored URLs
- `src/components/food-analyzer.tsx` - Pass `restoredBlobs` to PhotoCapture when session was restored
- `src/components/__tests__/food-analyzer.test.tsx` - Updated PhotoCapture mock for `restoredBlobs`, added 2 tests for restored blob passing

### Linear Updates
- FOO-823: Todo → In Progress → Review
- FOO-822: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 bug (memory leak in restored preview URL cleanup), fixed before proceeding
- verifier: All 2572 tests pass, zero warnings, build clean

### Continuation Status
All tasks completed.
