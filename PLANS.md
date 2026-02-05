# Fix Plan: HEIC SSR Error and Preview Issues

**Issue:** [FOO-47](https://linear.app/lw-claude/issue/FOO-47), [FOO-48](https://linear.app/lw-claude/issue/FOO-48)
**Date:** 2026-02-04
**Status:** Planning
**Branch:** fix/FOO-47-heic-ssr-and-preview

## Investigation

### Bug Report
User reported:
- HEIC image preview is broken (not rendering)
- Site stuck on "Analyzing" and then gave an error

### Classification
- **Type:** Frontend Bug + Deployment Failure
- **Severity:** Critical (app broken in production)
- **Affected Area:** `/app` page, image handling

### Root Cause Analysis

**Two separate bugs identified:**

#### Bug 1: SSR Error - "window is not defined" (Critical)

The `heic2any` library accesses browser-only APIs (`window`, Web Workers) during module initialization. When Next.js server-renders the `/app` page, it tries to evaluate the module and crashes.

**Evidence:**
- **Railway logs:** `ReferenceError: window is not defined` at `.next/server/chunks/ssr/_f53f0bb7._.js:1:1428716`
- **File:** `src/lib/image.ts:1` - Top-level import: `import heic2any from "heic2any";`
- **File:** `src/components/food-analyzer.tsx:10` - Imports `compressImage` from `@/lib/image`
- **File:** `src/app/app/page.tsx:3` - Server Component imports `FoodAnalyzer`

The `"use client"` directive helps with runtime execution but does NOT prevent module evaluation during SSR in Next.js 16's Turbopack bundler.

#### Bug 2: HEIC Previews Not Rendering

The `PhotoCapture` component shows previews using `URL.createObjectURL(file)` directly on the original files. Browsers (except Safari on macOS) cannot decode HEIC format natively in `<img>` tags.

**Evidence:**
- **File:** `src/components/photo-capture.tsx:80-81` - Creates object URLs from raw files
- **File:** `src/components/photo-capture.tsx:186-190` - Renders `<img src={preview}>` with raw HEIC blob URL
- HEIC-to-JPEG conversion only happens in `compressImage()` during analysis, not during preview generation

### Impact
- Bug 1: App completely broken - `/app` page crashes on load with SSR error
- Bug 2: HEIC image previews appear broken/blank (user can't see what they selected)

## Fix Plan (TDD Approach)

### Task 1: Fix heic2any SSR Error with Dynamic Import
**Linear Issue:** FOO-47

#### Step 1: Write Failing Test
- **File:** `src/lib/__tests__/image.test.ts`
- **Test:** Verify heic2any is only imported when `convertHeicToJpeg` is called (not at module load)

```typescript
describe("convertHeicToJpeg", () => {
  it("dynamically imports heic2any only when called", async () => {
    // Reset module state
    vi.resetModules();

    // Import module - should NOT throw even if heic2any accesses window
    const imageModule = await import("@/lib/image");

    // Module should load without error (heic2any not yet imported)
    expect(imageModule.convertHeicToJpeg).toBeDefined();
  });
});
```

#### Step 2: Implement Fix
- **File:** `src/lib/image.ts`
- **Change:** Replace top-level import with dynamic import inside `convertHeicToJpeg`

```typescript
// REMOVE: import heic2any from "heic2any";

export async function convertHeicToJpeg(file: File): Promise<Blob> {
  // Dynamic import - only loads when function is called (client-side only)
  const heic2any = (await import("heic2any")).default;

  const result = await heic2any({
    blob: file,
    toType: "image/jpeg",
  });

  // ... rest unchanged
}
```

#### Step 3: Verify
- [ ] Existing heic2any tests still pass (mock still works)
- [ ] No SSR error when loading `/app` page
- [ ] TypeScript compiles without errors
- [ ] Build passes (`npm run build`)

---

### Task 2: Fix HEIC Preview with Pre-conversion
**Linear Issue:** FOO-48

#### Step 1: Write Failing Test
- **File:** `src/components/__tests__/photo-capture.test.tsx`
- **Test:** Verify HEIC files are converted before creating preview URLs

```typescript
describe("HEIC preview handling", () => {
  it("converts HEIC files to JPEG for preview", async () => {
    // Mock convertHeicToJpeg
    const mockConvertHeicToJpeg = vi.fn().mockResolvedValue(
      new Blob(["converted"], { type: "image/jpeg" })
    );
    vi.mock("@/lib/image", () => ({
      isHeicFile: vi.fn().mockReturnValue(true),
      convertHeicToJpeg: mockConvertHeicToJpeg,
    }));

    render(<PhotoCapture onPhotosChange={mockOnChange} />);

    const heicFile = new File(["test"], "photo.heic", { type: "image/heic" });
    const input = screen.getByTestId("gallery-input");

    await userEvent.upload(input, heicFile);

    // Should have called conversion
    expect(mockConvertHeicToJpeg).toHaveBeenCalledWith(heicFile);

    // Preview should render (converted JPEG blob)
    expect(screen.getByAltText("Preview 1")).toBeInTheDocument();
  });

  it("does not convert non-HEIC files for preview", async () => {
    vi.mock("@/lib/image", () => ({
      isHeicFile: vi.fn().mockReturnValue(false),
      convertHeicToJpeg: vi.fn(),
    }));

    render(<PhotoCapture onPhotosChange={mockOnChange} />);

    const jpegFile = new File(["test"], "photo.jpg", { type: "image/jpeg" });
    const input = screen.getByTestId("gallery-input");

    await userEvent.upload(input, jpegFile);

    // Should NOT have called conversion
    expect(convertHeicToJpeg).not.toHaveBeenCalled();
  });
});
```

#### Step 2: Implement Fix
- **File:** `src/components/photo-capture.tsx`
- **Change:** Make `handleFileChange` async, convert HEIC files before creating preview URLs

```typescript
import { isHeicFile, convertHeicToJpeg } from "@/lib/image";

// Store converted blobs for preview (separate from original files for upload)
const [previewBlobs, setPreviewBlobs] = useState<Blob[]>([]);

const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
  // ... validation unchanged ...

  // Convert HEIC files for preview
  const previewBlobsPromises = combinedPhotos.map(async (file) => {
    if (isHeicFile(file)) {
      return convertHeicToJpeg(file);
    }
    return file;
  });

  const convertedBlobs = await Promise.all(previewBlobsPromises);

  // Create preview URLs from converted blobs
  const newPreviews = convertedBlobs.map((blob) =>
    URL.createObjectURL(blob)
  );

  // ... rest unchanged ...
};
```

#### Step 3: Verify
- [ ] HEIC files show preview correctly (converted to JPEG)
- [ ] Non-HEIC files still preview correctly (no conversion)
- [ ] Original HEIC files are preserved for upload (conversion happens again in FoodAnalyzer)
- [ ] Memory cleanup still works (URL.revokeObjectURL)
- [ ] Loading state shown during conversion (optional enhancement)

#### Step 4: Additional Tests
- [ ] Edge case: Multiple HEIC files converted in parallel
- [ ] Edge case: Mix of HEIC and non-HEIC files
- [ ] Error handling: Conversion failure shows error message

---

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings
3. Manual test on deployed app with HEIC image

## Notes

- Task 1 is **critical** - must be fixed first as it completely breaks the app
- Task 2 is **high** - impacts UX but doesn't prevent functionality
- Both fixes are independent and can be done in sequence
- The HEIC conversion in PhotoCapture is for preview only; FoodAnalyzer still does its own conversion during analysis (this is intentional - keeps concerns separated)
- Consider adding a loading spinner during HEIC preview conversion for better UX (optional, can be separate issue)

---

## Iteration 1

**Implemented:** 2026-02-04

### Tasks Completed This Iteration
- Task 1: Fix heic2any SSR Error with Dynamic Import - Replaced top-level import with dynamic import inside `convertHeicToJpeg()`
- Task 2: Fix HEIC Preview with Pre-conversion - Made `handleFileChange` async, added HEIC-to-JPEG conversion before creating preview URLs, added error handling for conversion failures

### Files Modified
- `src/lib/image.ts` - Changed from static `import heic2any` to dynamic `await import("heic2any")` inside function
- `src/lib/__tests__/image.test.ts` - Added test for convertHeicToJpeg function export, renamed test to clarify scope
- `src/components/photo-capture.tsx` - Made handleFileChange async, added HEIC conversion for previews with error handling
- `src/components/__tests__/photo-capture.test.tsx` - Added tests for HEIC preview conversion, error handling, and updated existing tests to handle async changes

### Linear Updates
- FOO-47: Todo → In Progress → Review
- FOO-48: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (missing error handling for HEIC conversion), fixed before proceeding
- verifier: All 261 tests pass, zero warnings (pre-existing act() warnings in SettingsPage tests are unrelated)

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 4
Checks applied: Security (OWASP-based), Logic, Async, Resources, Type Safety, Conventions

**Security:**
- ✅ No user input going to shell execution
- ✅ File validation enforced (type, size)
- ✅ No secrets exposed

**Logic & Correctness:**
- ✅ Dynamic import correctly prevents SSR error
- ✅ HEIC detection checks both MIME type and extension (handles Android edge case)
- ✅ Array result from heic2any handled with empty array check
- ✅ Empty file list edge case handled

**Async & Concurrency:**
- ✅ All promises have error handlers (try/catch wrapping HEIC conversion)
- ✅ Promise.all used correctly for parallel conversion
- ✅ Error propagated and shown to user

**Resource Management:**
- ✅ URL.revokeObjectURL called on old previews before creating new ones
- ✅ Memory cleanup in handleClear and image loading

**Type Safety:**
- ✅ No unsafe `any` casts
- ✅ TypeScript strict mode compliance

**Test Quality:**
- ✅ Meaningful assertions with edge case coverage
- ✅ Error paths tested (conversion failure, size validation)
- ✅ HEIC preview tests verify both conversion happens and original files preserved

**Project Conventions (CLAUDE.md):**
- ✅ @/ path aliases, kebab-case files, camelCase functions
- ✅ Error handling with user-friendly messages

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-47: Review → Merge
- FOO-48: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
