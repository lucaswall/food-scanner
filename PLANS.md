# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-03-06
**Source:** Bug report: Analyze screen has redundant "Start Fresh" and "Clear All" — consolidate into one full-reset "Clear All"
**Linear Issues:** [FOO-824](https://linear.app/lw-claude/issue/FOO-824/ui-remove-start-fresh-make-clear-all-fully-reset-analyze-screen)
**Branch:** fix/FOO-824-clear-all-full-reset

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/food-analyzer.tsx` — Main analyze screen component with "Start Fresh" button and `handlePhotosChange`/`handleStartFresh`/`resetAnalysisState`
  - `src/components/photo-capture.tsx` — PhotoCapture component with "Clear All" button, `doClear`/`handleClearRestoredPhotos`
  - `src/hooks/use-analysis-session.ts` — Session hook with `clearSession` action that resets to DEFAULT_STATE and clears IndexedDB/sessionStorage
  - `src/components/__tests__/food-analyzer.test.tsx` — Tests for both Start Fresh and session clear behaviors
  - `e2e/tests/analyze-photos.spec.ts` — E2E test for Clear All (line 117)
- **Existing patterns:** `handlePhotosChange` already calls `resetAnalysisState()` when `files.length === 0`. `handleStartFresh` calls `resetAnalysisState()` + `actions.clearSession()`.
- **Test conventions:** Colocated `__tests__/` directory, mock `useAnalysisSession` hook, test via rendered component behavior

### MCP Context
- **MCPs used:** Linear (issue search, creation)
- **Findings:** FOO-817 (original Start Fresh implementation, Done), FOO-821 (Start Fresh visibility fix, Done). No existing issue for this consolidation.

### Investigation

**Bug report:** Analyze screen has two confusing clear mechanisms: "Clear All" only clears photos, "Start Fresh" does full reset but only appears for restored sessions. User wants one button that does everything.
**Classification:** Frontend Bug / Low / Analyze Screen UI
**Root cause:** "Clear All" in PhotoCapture triggers `onPhotosChange([], [])` which calls `resetAnalysisState()` in FoodAnalyzer — this clears analysis state but does NOT call `clearSession()` (persisted session in IndexedDB/sessionStorage) and does NOT clear the description field. "Start Fresh" (lines 642-651 in food-analyzer.tsx) does the full reset but is conditionally rendered only when `wasRestored === true`.
**Evidence:**
- `src/components/food-analyzer.tsx:86-95` — `handlePhotosChange` calls `resetAnalysisState()` but not `clearSession()` when files cleared
- `src/components/food-analyzer.tsx:97-120` — `resetAnalysisState()` clears analysis/errors/streaming but not description or persisted session
- `src/components/food-analyzer.tsx:122-125` — `handleStartFresh` does `resetAnalysisState()` + `actions.clearSession()`
- `src/components/food-analyzer.tsx:642-651` — Start Fresh button, only visible when `wasRestored && (photos.length > 0 || convertedPhotoBlobs.length > 0 || analysis)`
- `src/hooks/use-analysis-session.ts:245-254` — `clearSession` resets to DEFAULT_STATE (description="", photos=[], etc.) and clears IndexedDB/sessionStorage
**Impact:** Users see stale description text and persisted session data after using Clear All. Restored sessions have two confusing options.

## Tasks

### Task 1: Remove Start Fresh, make Clear All trigger full reset
**Linear Issue:** [FOO-824](https://linear.app/lw-claude/issue/FOO-824/ui-remove-start-fresh-make-clear-all-fully-reset-analyze-screen)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**Steps:**
1. Update tests in `food-analyzer.test.tsx`:
   - Remove test "shows Start fresh link when session was restored with photos/analysis" (line 3950)
   - Remove test "shows Start fresh link when session was restored with convertedPhotoBlobs only" (line 3974)
   - Remove test "does NOT show Start fresh link when state is not restored" (line 4033)
   - Remove test "clicking Start fresh clears session and resets state" (line 4042)
   - Add new test: "Clear All triggers clearSession and clears description" — mock `useAnalysisSession` with photos and description, simulate photo clear callback (files.length === 0), assert `clearSession` and `setDescription("")` are called
   - Keep test "clears session after successful food log" (line 3920) — unchanged
   - Keep test "passes restoredBlobs to PhotoCapture" (line 3998) — unchanged
   - Keep test "does NOT pass restoredBlobs when session was not restored" (line 4025) — unchanged
   - Rename the describe block from "session clear and Start Fresh" to "session clear"
2. Run verifier with pattern "session clear" (expect fail — Start Fresh tests fail to find removed element, new test fails)
3. In `food-analyzer.tsx`:
   - Remove `handleStartFresh` function (lines 122-125)
   - Remove the Start Fresh JSX block (lines 642-651)
   - In `handlePhotosChange`, when `files.length === 0`: add `actions.clearSession()` after `resetAnalysisState()` — this clears persisted session AND resets all state to defaults (including description)
   - Since `clearSession` resets state to DEFAULT_STATE (which includes `description: ""`), the explicit `resetAnalysisState()` call becomes redundant when clearing. However, keep `resetAnalysisState()` for its abort/timeout cleanup side effects, then call `clearSession()` after it.
4. Run verifier with pattern "session clear" (expect pass)

**Notes:**
- `clearSession` is async but fire-and-forget is the existing pattern (see `handleStartFresh` which doesn't await it)
- PhotoCapture's "Clear All" button and its confirmation dialog remain unchanged — only the FoodAnalyzer callback behavior changes
- The `handleClearRestoredPhotos` in PhotoCapture also calls `onPhotosChange([], [])` which flows through the same `handlePhotosChange`, so restored photo clear also gets the full reset — this is the desired behavior
- E2E test at `e2e/tests/analyze-photos.spec.ts:117` should still pass since it only checks photos are cleared

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-03-06
**Method:** Single-agent (1 task, effort score 2)

### Tasks Completed This Iteration
- Task 1: Remove Start Fresh, make Clear All trigger full reset — Removed `handleStartFresh` and Start Fresh JSX, added `actions.clearSession()` to `handlePhotosChange` when photos cleared, updated tests

### Files Modified
- `src/components/food-analyzer.tsx` - Removed handleStartFresh function and Start Fresh JSX block, added clearSession() call in handlePhotosChange
- `src/components/__tests__/food-analyzer.test.tsx` - Removed 4 Start Fresh tests, added "Clear All triggers clearSession" test, renamed describe block

### Linear Updates
- FOO-824: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed, no bugs found
- verifier: All 2569 tests pass, zero warnings, build clean

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 2
Reviewer: single-agent (2 files, below threshold)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-824: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Plan Summary

**Objective:** Remove redundant "Start Fresh" button and make "Clear All" perform a full state reset including persisted session and description
**Linear Issues:** FOO-824
**Approach:** Remove Start Fresh UI and handler from food-analyzer.tsx. Enhance `handlePhotosChange` to call `clearSession()` when photos are cleared, which resets all state (photos, description, analysis, persisted session) to defaults. Update tests to remove Start Fresh assertions and add Clear All full-reset verification.
**Scope:** 1 task, 2 files, ~5 tests modified
**Key Decisions:** Keep `resetAnalysisState()` before `clearSession()` for its abort/cleanup side effects even though clearSession resets state
**Risks:** None significant — straightforward UI simplification

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
