# Implementation Plan

**Created:** 2026-02-04
**Source:** Inline request: Separate camera capture from gallery file selection in PhotoCapture component
**Linear Issues:** [FOO-32](https://linear.app/lw-claude/issue/FOO-32)

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/photo-capture.tsx` — Current implementation with single file input
  - `src/components/__tests__/photo-capture.test.tsx` — Existing tests
  - `src/components/ui/button.tsx` — shadcn/ui button component for styling
  - `src/components/food-analyzer.tsx` — Parent component that uses PhotoCapture
- **Existing patterns:**
  - PhotoCapture uses `'use client'` directive for interactivity
  - Single file input with `accept="image/*"` and `capture="environment"`
  - Preview thumbnails using `URL.createObjectURL()`
  - Validation for file type (JPEG/PNG) and size (10MB max)
  - Clear button to reset state
- **Test conventions:**
  - Tests colocated in `__tests__/` subdirectory
  - Mock `URL.createObjectURL/revokeObjectURL` with `vi.stubGlobal()`
  - `createMockFile()` helper for File creation
  - Test validation error display, preview rendering, callbacks

### MCP Context
- **MCPs used:** Linear (for issue creation)
- **Findings:** Team "Food Scanner" ID: `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`

## Original Plan

### Task 1: Separate camera capture from gallery selection in PhotoCapture
**Linear Issue:** [FOO-32](https://linear.app/lw-claude/issue/FOO-32)

1. Update tests in `src/components/__tests__/photo-capture.test.tsx`:
   - Test renders "Take Photo" button that triggers camera input (`capture="environment"`)
   - Test renders "Choose from Gallery" button that triggers file input (no capture attribute)
   - Test both inputs are hidden (visually) and triggered via button clicks
   - Test "Take Photo" input has `capture="environment"` attribute
   - Test "Choose from Gallery" input does NOT have `capture` attribute
   - Test both inputs share validation and photo limit logic
   - Test photos from either source are combined correctly
   - Update existing tests to work with new dual-input structure
2. Run verifier (expect fail)
3. Update `src/components/photo-capture.tsx`:
   - Replace single file input with two hidden inputs:
     - Camera input: `accept="image/*"` `capture="environment"` (for taking photos)
     - Gallery input: `accept="image/jpeg,image/png"` without capture (for file selection)
   - Add two visible buttons:
     - "Take Photo" button (triggers camera input via ref)
     - "Choose from Gallery" button (triggers gallery input via ref)
   - Share `handleFileChange` logic between both inputs
   - Keep existing validation, preview, and clear functionality
   - Style buttons using shadcn/ui Button component with icons
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Provide separate buttons for camera capture and gallery file selection

**Request:** The UI shows "Choose file" but opens camera directly. User wants two separate actions: one to take a photo with camera, another to choose existing photos from gallery.

**Linear Issues:** FOO-32

**Approach:** Replace the single file input with two hidden inputs—one with `capture="environment"` for camera, one without capture for gallery access. Add two styled buttons that trigger each input via refs. Both inputs share the same validation and state management logic.

**Scope:**
- Tasks: 1
- Files affected: 2 (component + tests)
- New tests: yes (update existing tests + add new ones)

**Key Decisions:**
- Use two hidden file inputs with button triggers (standard mobile-compatible pattern)
- Camera input uses `capture="environment"` for back camera preference
- Gallery input omits capture attribute entirely to show native file picker
- Both inputs share validation logic to maintain consistency

**Risks/Considerations:**
- Browser behavior varies: some Android browsers may still show a picker even with capture attribute
- iOS Safari handles capture attribute differently than Android Chrome
- Testing hidden inputs requires triggering via refs/programmatic clicks

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Separate camera capture from gallery selection in PhotoCapture - Replaced single file input with two hidden inputs (camera with `capture="environment"`, gallery without). Added "Take Photo" and "Choose from Gallery" buttons with Lucide icons. Both inputs share validation logic. Updated 18 tests.

### Files Modified
- `src/components/photo-capture.tsx` - Replaced single input with dual hidden inputs, added two action buttons, added Camera and ImageIcon from lucide-react
- `src/components/__tests__/photo-capture.test.tsx` - Rewrote tests for new dual-input structure with comprehensive coverage

### Linear Updates
- FOO-32: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 medium bug (inconsistent accept attributes between camera/gallery inputs), fixed before proceeding
- verifier: All 166 tests pass, zero TypeScript errors, 1 lint warning (acceptable: `<img>` for blob URLs)

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 2
- `src/components/photo-capture.tsx`
- `src/components/__tests__/photo-capture.test.tsx`

Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Test Quality, CLAUDE.md Conventions

**Security:**
- ✅ File validation (type and size) properly implemented
- ✅ No XSS risk - blob URLs are safe
- ✅ Client-side component; server validates at API level

**Logic & Correctness:**
- ✅ Both inputs share identical `accept="image/jpeg,image/png"` attributes
- ✅ Camera input has `capture="environment"`, gallery input does not
- ✅ Validation logic correctly rejects invalid files before state update
- ✅ `maxPhotos` limit enforced via `.slice(0, maxPhotos)`

**Resource Management:**
- ✅ `URL.revokeObjectURL` called on old previews to prevent memory leaks
- ✅ Input values reset to allow re-selecting same file

**Type Safety:**
- ✅ Props interface defined, refs typed, no `any` casts

**Test Quality:**
- ✅ 18 comprehensive tests covering both inputs, validation, combining photos, clear functionality
- ✅ Mocks properly set up for URL methods

**CLAUDE.md Compliance:**
- ✅ Uses `'use client'`, `@/` imports, shadcn/ui components
- ✅ Naming conventions followed

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-32: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
