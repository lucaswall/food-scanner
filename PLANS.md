# Implementation Plan

**Created:** 2026-02-05
**Source:** Inline request: Add loading indicator during HEIC photo processing
**Linear Issues:** [FOO-88](https://linear.app/lw-claude/issue/FOO-88/add-loading-indicator-during-heic-photo-processing)

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/photo-capture.tsx` - Main component handling photo selection and HEIC conversion
  - `src/components/__tests__/photo-capture.test.tsx` - Existing tests (791 lines, comprehensive coverage)
  - `src/lib/image.ts` - HEIC conversion via `convertHeicToJpeg()` using heic-to library
  - `src/components/analysis-result.tsx` - Has existing spinner pattern to follow

- **Existing patterns:**
  - Spinner: `w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin` (analysis-result.tsx:49)
  - Preview grid: `grid grid-cols-3 gap-2` with `aspect-square` items (photo-capture.tsx:238)
  - Error handling: `setError()` with role="alert" (photo-capture.tsx:230-234)

- **Test conventions:**
  - Mock `isHeicFile` and `convertHeicToJpeg` from `@/lib/image`
  - Use `waitFor()` for async operations
  - Use `screen.getByTestId()` for loading states

### Root Cause
In `handleFileChange` (photo-capture.tsx:66-135):
1. Validation runs synchronously (lines 73-86)
2. HEIC conversion runs asynchronously (lines 97-105)
3. Previews only appear after `Promise.all()` resolves (lines 118-126)

During step 2, which can take several seconds for large HEIC files, there's no visual feedback.

---

## Original Plan

### Task 1: Add loading state for photo processing
**Linear Issue:** [FOO-88](https://linear.app/lw-claude/issue/FOO-88/add-loading-indicator-during-heic-photo-processing)

#### Step 1: Write failing tests
- **File:** `src/components/__tests__/photo-capture.test.tsx`
- Add new describe block "processing state"

```typescript
describe("processing state", () => {
  it("shows loading placeholder immediately when selecting HEIC file", async () => {
    // Setup: make convertHeicToJpeg take time (don't resolve immediately)
    // Select HEIC file
    // Verify loading placeholder appears before conversion completes
  });

  it("shows spinner inside loading placeholder", async () => {
    // Verify the placeholder contains an animated spinner element
  });

  it("replaces loading placeholder with actual preview when conversion completes", async () => {
    // Verify spinner disappears and real preview appears
  });

  it("shows correct number of placeholders for multiple files", async () => {
    // Select 2 HEIC files, verify 2 placeholders appear
  });

  it("shows mix of placeholders and previews for HEIC + JPEG selection", async () => {
    // Select 1 HEIC + 1 JPEG, verify JPEG shows immediately, HEIC shows placeholder
  });

  it("loading placeholder has proper accessibility attributes", async () => {
    // Verify aria-busy="true" and aria-label on processing container
  });
});
```

#### Step 2: Run verifier (expect fail)

#### Step 3: Implement loading state
- **File:** `src/components/photo-capture.tsx`

**Add new state variables:**
```typescript
const [processingCount, setProcessingCount] = useState(0);
```

**Modify handleFileChange:**
1. After validation passes, immediately set `processingCount` to number of new files
2. Show placeholder grid slots while processing
3. Clear `processingCount` after Promise.all completes (success or error)

**Add loading placeholder component:**
```typescript
// Inside the preview grid, before actual previews:
{processingCount > 0 && Array.from({ length: processingCount }).map((_, index) => (
  <div
    key={`processing-${index}`}
    className="relative aspect-square rounded-md bg-muted flex items-center justify-center"
    aria-busy="true"
    aria-label="Processing photo"
  >
    <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
))}
```

**Key changes to handleFileChange flow:**
```typescript
// After validation passes:
setProcessingCount(newFiles.length);

try {
  const previewBlobPromises = combinedPhotos.map(async (file) => {
    // ... conversion logic
  });
  previewBlobs = await Promise.all(previewBlobPromises);
} catch {
  setError("Failed to process HEIC image...");
  setProcessingCount(0); // Clear on error
  return;
}

// After success:
setProcessingCount(0);
setPhotos(combinedPhotos);
setPreviews(newPreviews);
```

#### Step 4: Run verifier (expect pass)

#### Step 5: Additional refinements
- Ensure placeholders appear in the grid alongside existing previews
- Handle edge case: user selects more files while still processing

---

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add visual feedback when HEIC photos are being processed

**Request:** When attaching a HEIC photo from the gallery, show a loading placeholder with a spinner immediately, then replace it with the actual thumbnail once processing completes.

**Linear Issues:** FOO-88

**Approach:** Add a `processingCount` state variable that tracks how many files are currently being converted. Show placeholder grid slots with spinners while processing, then clear the count and show actual previews once conversion completes.

**Scope:**
- Tasks: 1
- Files affected: 2 (photo-capture.tsx, photo-capture.test.tsx)
- New tests: yes (6+ new test cases)

**Key Decisions:**
- Use same spinner pattern as analysis-result.tsx for consistency
- Track count of processing files rather than individual file states (simpler, sufficient for max 3 photos)
- Placeholders appear in grid alongside any existing previews

**Risks/Considerations:**
- Edge case: user selecting more files while still processing (should queue or replace)
- Ensure processingCount is always cleared on both success and error paths
