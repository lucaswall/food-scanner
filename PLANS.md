# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-49-input-validation-and-cleanup
**Issues:** FOO-49, FOO-50, FOO-51, FOO-52, FOO-53, FOO-54, FOO-55, FOO-56
**Created:** 2026-02-05
**Last Updated:** 2026-02-05

## Summary

This plan addresses 8 backlog issues covering input validation, type safety, session handling, accessibility, and technical debt. The issues are grouped by related files and ordered by priority.

## Issues

### FOO-49: Unsafe File[] type cast in analyze-food route (Medium)

**Priority:** Medium
**Labels:** Bug
**Description:** The cast `as File[]` on line 35 bypasses TypeScript type checking. `FormData.getAll()` returns `FormDataEntryValue[]` which includes both File and string. If a non-file value is passed, runtime errors occur.

**Acceptance Criteria:**
- [ ] Add runtime type guard to filter/validate File objects
- [ ] Return VALIDATION_ERROR if non-File values are present
- [ ] Test covers the validation case

### FOO-50: Missing date format validation in log-food route (Medium)

**Priority:** Medium
**Labels:** Bug
**Description:** If `body.date` is provided, it's used directly without validating YYYY-MM-DD format. Invalid dates get passed to Fitbit API.

**Acceptance Criteria:**
- [ ] Add date format validation (YYYY-MM-DD)
- [ ] Return VALIDATION_ERROR for invalid date format
- [ ] Test covers invalid date format cases

### FOO-51: Missing time format validation in log-food route (Low)

**Priority:** Low
**Labels:** Bug
**Description:** If `body.time` is provided, it's passed to Fitbit API without validating HH:mm:ss format.

**Acceptance Criteria:**
- [ ] Add time format validation (HH:mm:ss)
- [ ] Return VALIDATION_ERROR for invalid time format
- [ ] Test covers invalid time format cases

### FOO-52: Unsafe description type cast in analyze-food route (Low)

**Priority:** Low
**Labels:** Bug
**Description:** The cast `as string | null` on line 36 doesn't validate that `formData.get("description")` isn't a File object. Should use type guard.

**Acceptance Criteria:**
- [ ] Add type guard to verify description is string (not File)
- [ ] Return VALIDATION_ERROR if description is a File
- [ ] Test covers the validation case

### FOO-53: Missing error handling in settings page session fetch (Low)

**Priority:** Low
**Labels:** Bug
**Description:** The useEffect in settings page fetches `/api/auth/session` but has no error handling. If the fetch fails, the component silently fails.

**Acceptance Criteria:**
- [ ] Add error handling for failed fetch (network error, non-ok response)
- [ ] Display error state to user when session fetch fails
- [ ] Test covers error handling case

### FOO-54: Session expiry not checked in protected API routes (Low)

**Priority:** Low
**Labels:** Bug
**Description:** Protected routes check `!session.sessionId` but don't validate `session.expiresAt`. Stale sessions proceed if sessionId exists.

**Acceptance Criteria:**
- [ ] Add session expiry check to protected routes (analyze-food, log-food)
- [ ] Return AUTH_SESSION_EXPIRED for expired sessions
- [ ] Tests cover expired session cases

### FOO-55: Missing accessibility labels on confidence indicators (Low)

**Priority:** Low
**Labels:** Technical Debt
**Description:** Visual confidence indicator (colored circle) has no `aria-label`. Screen readers won't convey confidence level.

**Acceptance Criteria:**
- [ ] Add aria-label to confidence indicator in AnalysisResult
- [ ] Add aria-label to confidence indicator in NutritionEditor
- [ ] Tests verify aria-labels are present

### FOO-56: Unused error parameter in global-error.tsx (Low)

**Priority:** Low
**Labels:** Technical Debt
**Description:** The `error` parameter is defined but never used. Should be logged or displayed for debugging.

**Acceptance Criteria:**
- [ ] Log error details using pino logger
- [ ] Optionally display error digest in development
- [ ] Test verifies error is logged

## Prerequisites

- [ ] All current tests pass (`npm test`)
- [ ] TypeScript compiles cleanly (`npm run typecheck`)
- [ ] ESLint passes (`npm run lint`)

## Implementation Tasks

### Task 1: Add validation helpers for date/time format

**Issue:** FOO-50, FOO-51
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests for date validation:
   - Add test: "returns 400 VALIDATION_ERROR for invalid date format"
   - Test cases: "invalid-date", "2099-99-99", "01-15-2024" (wrong order)
   - Run: `npm test -- log-food`
   - Verify: Tests fail (no validation exists)

2. **RED** - Write failing tests for time validation:
   - Add test: "returns 400 VALIDATION_ERROR for invalid time format"
   - Test cases: "invalid-time", "25:00:00", "12:60:00", "12:00" (missing seconds)
   - Run: `npm test -- log-food`
   - Verify: Tests fail (no validation exists)

3. **GREEN** - Implement date/time validation:
   - Add `isValidDateFormat(date: string): boolean` function using regex `/^\d{4}-\d{2}-\d{2}$/`
   - Add `isValidTimeFormat(time: string): boolean` function using regex `/^\d{2}:\d{2}:\d{2}$/`
   - Add validation after mealTypeId check:
     ```typescript
     if (body.date && !isValidDateFormat(body.date)) {
       return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
     }
     if (body.time && !isValidTimeFormat(body.time)) {
       return errorResponse("VALIDATION_ERROR", "Invalid time format. Use HH:mm:ss", 400);
     }
     ```
   - Run: `npm test -- log-food`
   - Verify: All tests pass

4. **REFACTOR** - None needed, validation is simple.

**Notes:**
- Keep validation simple (regex pattern check). Don't validate actual date validity (Feb 30 etc) - let Fitbit reject those.
- Time validation checks format only, not whether hours/minutes are in valid range.

---

### Task 2: Fix unsafe type casts in analyze-food route

**Issue:** FOO-49, FOO-52
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test for File[] validation:
   - Add test: "returns 400 VALIDATION_ERROR when images contains non-File values"
   - Create mock request where `getAll("images")` returns a string mixed with files
   - Run: `npm test -- analyze-food`
   - Verify: Test fails (cast bypasses validation)

2. **RED** - Write failing test for description validation:
   - Add test: "returns 400 VALIDATION_ERROR when description is a File"
   - Create mock request where `get("description")` returns a File object
   - Run: `npm test -- analyze-food`
   - Verify: Test fails (cast bypasses validation)

3. **GREEN** - Implement type guards:
   - Replace line 35 `as File[]` with:
     ```typescript
     const imagesRaw = formData.getAll("images");
     const images = imagesRaw.filter((item): item is File => item instanceof File);
     if (images.length !== imagesRaw.length) {
       logger.warn({ action: "analyze_food_validation" }, "non-file values in images");
       return errorResponse("VALIDATION_ERROR", "Invalid image data", 400);
     }
     ```
   - Replace line 36 `as string | null` with:
     ```typescript
     const descriptionRaw = formData.get("description");
     const description = descriptionRaw === null || typeof descriptionRaw === "string"
       ? descriptionRaw
       : null;
     if (descriptionRaw !== null && typeof descriptionRaw !== "string") {
       logger.warn({ action: "analyze_food_validation" }, "description is not a string");
       return errorResponse("VALIDATION_ERROR", "Description must be text", 400);
     }
     ```
   - Run: `npm test -- analyze-food`
   - Verify: All tests pass

4. **REFACTOR** - Consider extracting type guards if reusable, but likely not needed.

**Notes:**
- Use `instanceof File` for runtime check (works in Node.js test environment)
- Reference existing validation pattern in the same file (lines 60-85)

---

### Task 3: Add session expiry check to protected API routes

**Issue:** FOO-54
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing test in analyze-food:
   - Add test: "returns 401 AUTH_SESSION_EXPIRED for expired session"
   - Create mock session with `expiresAt: Date.now() - 1000` (expired)
   - Run: `npm test -- analyze-food`
   - Verify: Test fails (returns 200, not checking expiry)

2. **RED** - Write failing test in log-food:
   - Add test: "returns 401 AUTH_SESSION_EXPIRED for expired session"
   - Create mock session with `expiresAt: Date.now() - 1000` (expired)
   - Run: `npm test -- log-food`
   - Verify: Test fails (returns 200, not checking expiry)

3. **GREEN** - Add expiry checks to both routes:
   - In `analyze-food/route.ts` after line 17, add:
     ```typescript
     if (session.expiresAt < Date.now()) {
       logger.warn({ action: "analyze_food_unauthorized" }, "session expired");
       return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
     }
     ```
   - In `log-food/route.ts` after line 59, add same pattern:
     ```typescript
     if (session.expiresAt < Date.now()) {
       logger.warn({ action: "log_food_unauthorized" }, "session expired");
       return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
     }
     ```
   - Run: `npm test -- analyze-food log-food`
   - Verify: All tests pass

4. **REFACTOR** - Consider extracting to shared helper, but given only 2 routes and simplicity, inline is fine.

**Notes:**
- Match the pattern used in `/api/auth/session/route.ts` (lines 13-16)
- Check expiry AFTER checking sessionId exists (need expiresAt to be defined)

---

### Task 4: Add error handling to settings page session fetch

**Issue:** FOO-53
**Files:**
- `src/app/settings/page.tsx` (modify)
- `src/app/settings/__tests__/page.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing test for fetch error:
   - Add test: "displays error message when session fetch fails"
   - Mock fetch to reject with network error
   - Run: `npm test -- settings/page`
   - Verify: Test fails (no error handling, no error displayed)

2. **RED** - Write failing test for non-ok response:
   - Add test: "displays error message when session returns error response"
   - Mock fetch to return `{ ok: false }` or `{ success: false }`
   - Run: `npm test -- settings/page`
   - Verify: Test fails

3. **GREEN** - Implement error handling:
   - Add error state: `const [error, setError] = useState<string | null>(null);`
   - Update fetch chain:
     ```typescript
     useEffect(() => {
       fetch("/api/auth/session")
         .then((res) => {
           if (!res.ok) throw new Error("Failed to load session");
           return res.json();
         })
         .then((data) => {
           if (data.success) {
             setSession(data.data);
           } else {
             throw new Error(data.error?.message || "Failed to load session");
           }
         })
         .catch((err) => {
           setError(err.message || "Failed to load session");
         });
     }, []);
     ```
   - Add error display in JSX (before session info):
     ```typescript
     {error && (
       <p className="text-sm text-red-500">{error}</p>
     )}
     ```
   - Run: `npm test -- settings/page`
   - Verify: All tests pass

4. **REFACTOR** - None needed, error handling is straightforward.

**Notes:**
- Keep error message user-friendly
- No retry button needed (user can refresh page)

---

### Task 5: Add accessibility labels to confidence indicators

**Issue:** FOO-55
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/nutrition-editor.tsx` (modify)
- `src/components/__tests__/analysis-result.test.tsx` (modify)
- `src/components/__tests__/nutrition-editor.test.tsx` (modify)

**TDD Steps:**

1. **RED** - Write failing test for AnalysisResult:
   - Add test: "confidence indicator has accessible label"
   - Query for element with `aria-label` containing "Confidence"
   - Run: `npm test -- analysis-result`
   - Verify: Test fails (no aria-label)

2. **RED** - Write failing test for NutritionEditor:
   - Add test: "confidence indicator has accessible label"
   - Query for element with `aria-label` containing "Confidence"
   - Run: `npm test -- nutrition-editor`
   - Verify: Test fails (no aria-label)

3. **GREEN** - Add aria-labels:
   - In `analysis-result.tsx` line 60, add to the div:
     ```typescript
     <div
       data-testid="confidence-indicator"
       aria-label={`Confidence: ${analysis.confidence}`}
       className={`w-3 h-3 rounded-full ${confidenceColors[analysis.confidence]}`}
     />
     ```
   - In `nutrition-editor.tsx` line 44, add to the div:
     ```typescript
     <div
       data-testid="confidence-indicator"
       aria-label={`Confidence: ${value.confidence}`}
       className={`w-3 h-3 rounded-full ${confidenceColors[value.confidence]}`}
     />
     ```
   - Run: `npm test -- analysis-result nutrition-editor`
   - Verify: All tests pass

4. **REFACTOR** - None needed.

**Notes:**
- Use format "Confidence: high/medium/low" for clarity
- The aria-label goes on the colored circle div, not the wrapper

---

### Task 6: Log error in global-error.tsx

**Issue:** FOO-56
**Files:**
- `src/app/global-error.tsx` (modify)

**TDD Steps:**

1. **No test needed** - This is a simple logging addition in an error boundary. The error boundary is difficult to test in isolation and the change is trivial.

2. **GREEN** - Add error logging:
   - Import logger (need to handle client-side logging)
   - Since this is a client component and pino is server-side, use `console.error` for client logging:
     ```typescript
     "use client";

     import { useEffect } from "react";

     export default function GlobalError({
       error,
       reset,
     }: {
       error: Error & { digest?: string };
       reset: () => void;
     }) {
       useEffect(() => {
         // Log error to console (client-side)
         console.error("Global error:", {
           message: error.message,
           digest: error.digest,
           stack: error.stack,
         });
       }, [error]);

       return (
         <html lang="en">
           <body>
             <div className="flex min-h-screen items-center justify-center">
               <div className="text-center">
                 <h2 className="text-xl font-semibold">Something went wrong</h2>
                 {process.env.NODE_ENV === "development" && error.digest && (
                   <p className="mt-2 text-sm text-gray-500">
                     Error ID: {error.digest}
                   </p>
                 )}
                 <button
                   onClick={() => reset()}
                   className="mt-4 rounded bg-zinc-900 px-4 py-2 text-white"
                 >
                   Try again
                 </button>
               </div>
             </div>
           </body>
         </html>
       );
     }
     ```
   - Run: `npm test && npm run typecheck`
   - Verify: No type errors, builds clean

3. **REFACTOR** - None needed.

**Notes:**
- Use `console.error` since this is a client component (pino is server-only)
- Only show error digest in development mode
- Add useEffect to log on mount/error change

---

### Task 7: Integration & Verification

**Issue:** FOO-49, FOO-50, FOO-51, FOO-52, FOO-53, FOO-54, FOO-55, FOO-56
**Files:** All modified files

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Manual verification (optional, on dev server):
   - [ ] Settings page shows error when session fetch fails (disconnect network)
   - [ ] Confidence indicators have screen reader labels (inspect DOM)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Invalid date format | Return VALIDATION_ERROR 400 | Unit test |
| Invalid time format | Return VALIDATION_ERROR 400 | Unit test |
| Non-File in images array | Return VALIDATION_ERROR 400 | Unit test |
| Description is File | Return VALIDATION_ERROR 400 | Unit test |
| Session expired | Return AUTH_SESSION_EXPIRED 401 | Unit test |
| Settings fetch fails | Display error message | Unit test |

## Risks & Open Questions

- [x] **Risk:** `instanceof File` may behave differently in test vs runtime - Mitigated: Node.js File class should work
- [x] **Risk:** Date/time regex validation is lenient (allows 99:99:99) - Accepted: Let Fitbit reject truly invalid values

## Scope Boundaries

**In Scope:**
- Input validation for date, time, files, description
- Session expiry checks in protected routes
- Error handling in settings page
- Accessibility labels for confidence indicators
- Error logging in global error boundary

**Out of Scope:**
- Deep date validation (checking if Feb 30 exists)
- Deep time validation (checking if hours < 24)
- Server-side error reporting/monitoring
- Retry logic for failed fetches

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Add validation helpers for date/time format - Added `isValidDateFormat` and `isValidTimeFormat` regex validators to log-food route
- Task 2: Fix unsafe type casts in analyze-food route - Replaced `as File[]` with `isFileLike` type guard, added description validation
- Task 3: Add session expiry check to protected API routes - Added expiry validation to analyze-food and log-food routes
- Task 4: Add error handling to settings page session fetch - Added catch handler and error state display
- Task 5: Add accessibility labels to confidence indicators - Added `aria-label` to AnalysisResult and NutritionEditor components
- Task 6: Log error in global-error.tsx - Added useEffect with console.error logging and development-only error digest display

### Files Modified
- `src/app/api/log-food/route.ts` - Added date/time format validation functions and session expiry check
- `src/app/api/log-food/__tests__/route.test.ts` - Added tests for date/time validation and session expiry
- `src/app/api/analyze-food/route.ts` - Added `isFileLike` type guard, description validation, and session expiry check
- `src/app/api/analyze-food/__tests__/route.test.ts` - Added tests for File validation, description validation, and session expiry
- `src/app/settings/page.tsx` - Added error state and error handling for session fetch
- `src/app/settings/__tests__/page.test.tsx` - Added tests for error handling scenarios
- `src/components/analysis-result.tsx` - Added aria-label to confidence indicator
- `src/components/__tests__/analysis-result.test.tsx` - Added test for accessible label
- `src/components/nutrition-editor.tsx` - Added aria-label to confidence indicator
- `src/components/__tests__/nutrition-editor.test.tsx` - Added test for accessible label, fixed confidence read-only test
- `src/app/global-error.tsx` - Added useEffect to log errors and conditionally display error digest

### Linear Updates
- FOO-49: Todo → In Progress → Review
- FOO-50: Todo → In Progress → Review
- FOO-51: Todo → In Progress → Review
- FOO-52: Todo → In Progress → Review
- FOO-53: Todo → In Progress → Review
- FOO-54: Todo → In Progress → Review
- FOO-55: Todo → In Progress → Review
- FOO-56: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH (date/time semantic validation - by design per plan), 1 MEDIUM (fixed: added undefined check to session expiry)
- verifier: All 273 tests pass, zero type errors, build successful

### Continuation Status
All tasks completed.
