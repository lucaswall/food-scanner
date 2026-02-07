# Implementation Plan

**Created:** 2026-02-07
**Source:** Inline request: Re-prompting for nutrition editing (ROADMAP.md section 1)
**Linear Issues:** [FOO-176](https://linear.app/lw-claude/issue/FOO-176/add-refineanalysis-function-to-claude-client), [FOO-177](https://linear.app/lw-claude/issue/FOO-177/create-apirefine-food-endpoint), [FOO-178](https://linear.app/lw-claude/issue/FOO-178/replace-nutritioneditor-with-re-prompt-ui-in-foodanalyzer), [FOO-179](https://linear.app/lw-claude/issue/FOO-179/delete-nutritioneditor-component-and-tests), [FOO-180](https://linear.app/lw-claude/issue/FOO-180/update-documentation-for-re-prompt-feature-and-delete-roadmapmd)

## Context Gathered

### Codebase Analysis
- **Claude API:** `src/lib/claude.ts` — `analyzeFood(images, description)` sends images + text to Claude Sonnet via `report_nutrition` tool_use. Returns validated `FoodAnalysis`.
- **Analyze endpoint:** `src/app/api/analyze-food/route.ts` — accepts `multipart/form-data` with `images[]` + optional `description`. Converts images to base64, calls `analyzeFood()`.
- **FoodAnalyzer component:** `src/components/food-analyzer.tsx` — state machine with photo capture → analysis → edit/view → log flow. Currently has `editMode`/`editedAnalysis` state for manual number editing via `NutritionEditor`.
- **NutritionEditor:** `src/components/nutrition-editor.tsx` — form with number inputs for all nutrition fields. Used only in `food-analyzer.tsx`.
- **AnalysisResult:** `src/components/analysis-result.tsx` — read-only display of analysis with confidence badge.
- **Types:** `FoodAnalysis` in `src/types/index.ts:47-60` — all fields needed for nutrition display.
- **Image handling:** Client compresses to 1024px/80% JPEG before upload. Images stored as `photos: File[]` state in FoodAnalyzer.

### Key Design Decisions
- **Replace NutritionEditor entirely** — remove manual number editing, replace with natural language re-prompting
- **Send images + analysis + correction** — Claude re-examines photos with user's correction for higher accuracy
- **Simple text input UI** — single input + send button on analysis screen, each submission replaces analysis
- **Reuse existing analyze endpoint pattern** — new `/api/refine-food` endpoint follows same structure

### Existing Patterns
- API routes use `getSession()` + `validateSession()` for auth
- Responses use `successResponse()`/`errorResponse()` helpers
- Tests colocated in `__tests__/` subdirectories
- Claude API calls use tool_use with forced tool choice

## Original Plan

### Task 1: Add `refineAnalysis` function to Claude client
**Linear Issue:** [FOO-176](https://linear.app/lw-claude/issue/FOO-176/add-refineanalysis-function-to-claude-client)

**Files:**
- `src/lib/claude.ts` (modify — add `refineAnalysis` function)
- `src/lib/__tests__/claude.test.ts` (modify — add tests)

**TDD Steps:**

1. **RED** — Write tests for `refineAnalysis`:
   - Create/extend `src/lib/__tests__/claude.test.ts`
   - Test: calls Claude API with images, previous analysis JSON, and correction text in the user message
   - Test: system prompt includes instruction to refine based on user correction
   - Test: returns validated `FoodAnalysis` (reuses `validateFoodAnalysis`)
   - Test: retries on timeout/rate-limit (same as `analyzeFood`)
   - Test: throws `CLAUDE_API_ERROR` on failure
   - Signature: `refineAnalysis(images: ImageInput[], previousAnalysis: FoodAnalysis, correction: string): Promise<FoodAnalysis>`
   - Mock: Anthropic client
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Implement `refineAnalysis` in `src/lib/claude.ts`:
   - Export `ImageInput` interface (currently not exported, needed by the API route)
   - New function `refineAnalysis(images, previousAnalysis, correction)`:
     - Same retry logic as `analyzeFood` (extract shared retry wrapper or duplicate — keep it simple)
     - Same model, max_tokens, tools, tool_choice as `analyzeFood`
     - System prompt: same `SYSTEM_PROMPT` base + refinement instruction
     - User message content: images (same as analyzeFood) + text block with structured prompt:
       ```
       I previously analyzed this food and got the following result:

       Food: {food_name}
       Amount: {amount} {unit}
       Calories: {calories}
       Protein: {protein_g}g, Carbs: {carbs_g}g, Fat: {fat_g}g, Fiber: {fiber_g}g, Sodium: {sodium_mg}mg
       Confidence: {confidence}
       Notes: {notes}

       The user has provided this correction: "{correction}"

       Please re-analyze the food considering this correction and provide updated nutritional information.
       ```
     - Same response handling: extract tool_use block, validate via `validateFoodAnalysis`
   - Run: `npm test -- claude`
   - Verify: Tests pass

**Notes:**
- The refinement prompt includes the structured previous analysis (not raw JSON) for clarity
- Images are re-sent so Claude can look at the photo again with the correction context
- Keywords may change if the correction significantly alters the food (e.g., "it also has cheese")
- The `confidence` in the refined result should reflect the correction (may go up if correction clarifies ambiguity)

---

### Task 2: Create `/api/refine-food` endpoint
**Linear Issue:** [FOO-177](https://linear.app/lw-claude/issue/FOO-177/create-apirefine-food-endpoint)

**Files:**
- `src/app/api/refine-food/route.ts` (create)
- `src/app/api/refine-food/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for `POST /api/refine-food`:
   - Create `src/app/api/refine-food/__tests__/route.test.ts`
   - Test: returns refined analysis for valid request (images + previousAnalysis JSON + correction text)
   - Test: returns 401 for unauthenticated user
   - Test: returns 400 when no images provided
   - Test: returns 400 when no correction text provided
   - Test: returns 400 when no previousAnalysis provided
   - Test: returns 400 when previousAnalysis is invalid JSON
   - Test: returns 500 when Claude API fails (CLAUDE_API_ERROR)
   - Request format: `multipart/form-data` with `images[]` (File), `previousAnalysis` (JSON string), `correction` (string)
   - Mock: `getSession`, `validateSession`, `refineAnalysis`
   - Run: `npm test -- refine-food`
   - Verify: Tests fail

2. **GREEN** — Create `src/app/api/refine-food/route.ts`:
   - `POST` handler
   - Validate session via `getSession()` + `validateSession({ requireFitbit: true })`
   - Parse FormData: `images[]`, `previousAnalysis` (string → JSON parse → validate shape), `correction` (string)
   - Reuse image validation from analyze-food (same MAX_IMAGES, MAX_IMAGE_SIZE, ALLOWED_TYPES checks) — extract shared validation helper or duplicate inline
   - Validate `correction` is non-empty string
   - Validate `previousAnalysis` parses as object with expected FoodAnalysis fields (basic shape check)
   - Convert images to base64 (same as analyze-food)
   - Call `refineAnalysis(imageInputs, previousAnalysis, correction)`
   - Return `successResponse(refinedAnalysis)`
   - Error handling: catch CLAUDE_API_ERROR → return 500
   - Run: `npm test -- refine-food`
   - Verify: Tests pass

**Notes:**
- The endpoint accepts `multipart/form-data` (same as analyze-food) because it needs to send images
- `previousAnalysis` is sent as a JSON string field in the form data
- Image validation logic is identical to analyze-food — consider extracting to a shared helper in `src/lib/image-validation.ts` if duplication is excessive, but inline is fine for 2 routes
- The middleware matcher already covers `/api/refine-food` (not excluded by `health|auth`)

---

### Task 3: Replace NutritionEditor with re-prompt UI in FoodAnalyzer
**Linear Issue:** [FOO-178](https://linear.app/lw-claude/issue/FOO-178/replace-nutritioneditor-with-re-prompt-ui-in-foodanalyzer)

**Files:**
- `src/components/food-analyzer.tsx` (modify — replace edit mode with re-prompt flow)
- `src/components/__tests__/food-analyzer.test.tsx` (modify — update tests)
- `src/components/__tests__/food-analyzer-reprompt.test.tsx` (create — new re-prompt tests)

**TDD Steps:**

1. **RED** — Write tests for re-prompt flow:
   - Create `src/components/__tests__/food-analyzer-reprompt.test.tsx`
   - Test: after analysis, a text input with placeholder "Correct something..." is visible
   - Test: text input has a send button that is disabled when input is empty
   - Test: submitting a correction calls `POST /api/refine-food` with images, previousAnalysis, and correction text
   - Test: during re-prompt, a loading state is shown (spinner/message like "Refining analysis...")
   - Test: after successful re-prompt, the analysis display updates with refined result
   - Test: the correction input is cleared after successful re-prompt
   - Test: user can re-prompt multiple times (refined result becomes the new previousAnalysis)
   - Test: re-prompt errors show an error message near the input
   - Test: images (compressed blobs from original analysis) are re-sent with the re-prompt
   - Test: the re-prompt input is disabled during logging
   - Mock: `fetch` for `/api/refine-food`
   - Run: `npm test -- food-analyzer-reprompt`
   - Verify: Tests fail

2. **GREEN** — Modify `src/components/food-analyzer.tsx`:
   - **Remove:** `editMode`, `editedAnalysis`, `handleEditToggle`, `showRegenerateConfirm`, `handleRegenerateClick`, `handleConfirmRegenerate` state and handlers
   - **Remove:** Import of `NutritionEditor`
   - **Remove:** Import of `AlertDialog` components (no longer needed for regenerate confirmation)
   - **Remove:** "Edit Manually" / "Done Editing" button
   - **Remove:** "Regenerate" button and its confirmation dialog
   - **Simplify:** `currentAnalysis` is now just `analysis` (no more `editedAnalysis || analysis`)
   - **Add state:**
     - `correction: string` — text input value
     - `refining: boolean` — re-prompt API call in progress
     - `refineError: string | null` — re-prompt error message
     - `compressedImages: Blob[] | null` — store compressed images after initial analysis for re-use in re-prompts
   - **Store compressed images:** In `handleAnalyze`, after compression, save `compressedImages` to state so they can be re-sent with re-prompts without re-compressing
   - **Add `handleRefine` handler:**
     - Build FormData with `compressedImages` (as `images[]`), `JSON.stringify(analysis)` (as `previousAnalysis`), `correction` (as `correction`)
     - `POST /api/refine-food`
     - On success: `setAnalysis(refinedResult)`, `setCorrection("")`, clear `refineError`
     - On error: `setRefineError(errorMessage)`
     - Toggle `refining` state
   - **UI changes (post-analysis controls section):**
     - Replace "Edit Manually" / "Regenerate" buttons with:
       ```tsx
       <div className="flex gap-2">
         <Input
           placeholder="Correct something..."
           value={correction}
           onChange={(e) => setCorrection(e.target.value)}
           disabled={logging || refining}
           onKeyDown={(e) => e.key === "Enter" && correction.trim() && handleRefine()}
           className="flex-1 min-h-[44px]"
         />
         <Button
           onClick={handleRefine}
           disabled={!correction.trim() || logging || refining}
           variant="outline"
           className="min-h-[44px]"
         >
           {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
         </Button>
       </div>
       ```
     - Show refine error below the input if present
     - Keep "Regenerate" button (simpler now — just calls `handleAnalyze` since there are no edits to lose)
     - Actually, per user choice to "replace entirely" — remove regenerate too. The user can re-prompt to fix anything, or re-take the photo.
     - Wait — regenerate is useful when the user wants a fresh analysis without a correction (e.g., AI hallucinated). Keep a small "Re-analyze" link/button. Since there's no edit state to lose, no confirmation dialog needed.
   - **Keep:** `handleReset`, `handleLogToFitbit`, meal type selector, log button, matches section
   - Run: `npm test -- food-analyzer-reprompt`
   - Verify: Tests pass

3. **GREEN** — Update existing food-analyzer tests:
   - In `src/components/__tests__/food-analyzer.test.tsx`:
     - Remove tests for "Edit Manually" / "Done Editing" toggle
     - Remove tests for NutritionEditor rendering
     - Remove tests for "Regenerate" confirmation dialog
     - Update any tests that reference `editMode` or `editedAnalysis`
     - Add/update test: correction input is visible after analysis
   - Run: `npm test -- food-analyzer`
   - Verify: All tests pass

4. **REFACTOR** — Clean up:
   - Ensure correction input has proper `aria-label`
   - Ensure the send button icon has `aria-label="Send correction"`
   - Keyboard shortcut: Enter key submits correction (already in step 2)
   - 44px touch targets on all interactive elements

**Notes:**
- The `compressedImages` are stored as `Blob[]` from the initial `handleAnalyze` — this avoids re-compressing on each re-prompt
- `photos` state (original `File[]`) is still needed for the photo capture UI, but `compressedImages` is what gets sent to APIs
- The `handleAnalyze` function currently creates compressed blobs and immediately sends them. Refactor to: compress → store in state → send. Re-prompts then reuse the stored blobs.
- Food matches (`/api/find-matches`) should be re-fetched after a re-prompt since keywords may change — call the match search again after successful refinement
- The `Regenerate` button is replaced by a simpler "Re-analyze" text button that just calls `handleAnalyze()` (no confirmation needed since there are no manual edits to lose)
- Import `Send` and `Loader2` icons from `lucide-react` (already a dependency)
- Import `Input` from `@/components/ui/input` (shadcn component, should already exist)

---

### Task 4: Delete NutritionEditor component and tests
**Linear Issue:** [FOO-179](https://linear.app/lw-claude/issue/FOO-179/delete-nutritioneditor-component-and-tests)

**Files:**
- `src/components/nutrition-editor.tsx` (delete)
- `src/components/__tests__/nutrition-editor.test.tsx` (delete)

**Steps:**

1. Delete `src/components/nutrition-editor.tsx`
2. Delete `src/components/__tests__/nutrition-editor.test.tsx`
3. Verify no remaining imports reference the deleted files:
   - Run: `npm run typecheck`
   - Run: `npm test`
4. Verify all tests pass and zero warnings

**Notes:**
- After Task 3 removes the import from `food-analyzer.tsx`, these files are unused
- Per CLAUDE.md: "Delete unused code immediately — No deprecation warnings"

---

### Task 5: Update documentation
**Linear Issue:** [FOO-180](https://linear.app/lw-claude/issue/FOO-180/update-documentation-for-re-prompt-feature-and-delete-roadmapmd)

**Files:**
- `CLAUDE.md` (modify — update structure, remove NutritionEditor references, add refine-food endpoint)

**Steps:**

1. Update STRUCTURE section:
   - Remove `src/components/nutrition-editor.tsx` from components list
   - Add `src/app/api/refine-food/route.ts` — Re-prompt food analysis

2. Update API ENDPOINTS table:
   - Add `POST /api/refine-food | Yes | Re-prompt food analysis with correction`

3. Delete `ROADMAP.md` (as requested by user)

4. Run: `npm run typecheck && npm run lint`
5. Verify zero warnings

---

### Task 6: Integration & Verification

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Replace manual nutrition editing with natural language re-prompting via Claude

**Request:** Plan ROADMAP.md section 1 (Re-prompting for Nutrition Editing). Drop sections 2 and 3. Delete ROADMAP.md before committing.

**Linear Issues:** FOO-176, FOO-177, FOO-178, FOO-179, FOO-180

**Approach:** Add a new `refineAnalysis` function to the Claude client that sends images + previous analysis + correction text back to Claude for a refined analysis. Create a `/api/refine-food` endpoint. Replace the NutritionEditor component in FoodAnalyzer with a simple text input for natural language corrections. Delete the now-unused NutritionEditor component.

**Scope:**
- Tasks: 6
- Files affected: ~12 (5 modified, 3 created, 4 deleted)
- New tests: yes

**Key Decisions:**
- Replace NutritionEditor entirely (no manual number editing)
- Send images back to Claude with each re-prompt for higher accuracy
- Simple text input UI (not chat-like) — each re-prompt replaces the displayed analysis
- Store compressed images in component state to avoid re-compression on each re-prompt
- Keep a simplified "Re-analyze" button for fresh analysis without corrections

**Risks/Considerations:**
- Re-prompts are more expensive than manual edits (full Claude API call with images each time)
- Need to re-fetch food matches after re-prompt since keywords may change
- The correction text input needs clear UX so users understand they can type natural language

---

## Iteration 1

**Implemented:** 2026-02-07
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Add refineAnalysis function to Claude client (FOO-176) - Exported ImageInput, added refineAnalysis with same retry/validation as analyzeFood (worker-1)
- Task 2: Create /api/refine-food endpoint (FOO-177) - POST handler with session auth, image validation, previousAnalysis JSON parsing, correction validation (worker-1)
- Task 3: Replace NutritionEditor with re-prompt UI in FoodAnalyzer (FOO-178) - Removed editMode/editedAnalysis/NutritionEditor/AlertDialog, added correction input + send button + handleRefine + compressedImages state (worker-2)
- Task 4: Delete NutritionEditor component and tests (FOO-179) - Deleted nutrition-editor.tsx and nutrition-editor.test.tsx (worker-2)
- Task 5: Update documentation (FOO-180) - Added refine-food endpoint to CLAUDE.md structure and API table, ROADMAP.md already deleted (worker-3)
- Task 6: Integration & Verification - Lead verified full test suite, typecheck, lint, build

### Files Modified
- `src/lib/claude.ts` - Exported `ImageInput` interface, added `refineAnalysis()` function
- `src/lib/__tests__/claude.test.ts` - Added 9 tests for refineAnalysis
- `src/app/api/refine-food/route.ts` - Created POST handler with full validation
- `src/app/api/refine-food/__tests__/route.test.ts` - Created 13 tests
- `src/components/food-analyzer.tsx` - Replaced edit mode with re-prompt flow (correction input, handleRefine, compressedImages)
- `src/components/__tests__/food-analyzer.test.tsx` - Removed 13 edit/regenerate tests, 33 remaining pass
- `src/components/__tests__/food-analyzer-reprompt.test.tsx` - Created 13 new re-prompt tests
- `src/components/nutrition-editor.tsx` - Deleted
- `src/components/__tests__/nutrition-editor.test.tsx` - Deleted
- `src/hooks/use-keyboard-shortcuts.ts` - Removed dead editMode/Escape handling
- `src/hooks/__tests__/use-keyboard-shortcuts.test.ts` - Removed 2 Escape edit mode tests
- `CLAUDE.md` - Added refine-food to structure and API endpoints table

### Linear Updates
- FOO-176: Todo → In Progress → Review
- FOO-177: Todo → In Progress → Review
- FOO-178: Todo → In Progress → Review
- FOO-179: Todo → In Progress → Review
- FOO-180: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (3 medium, 1 low), all fixed before proceeding
  - Fixed: user correction text logged in production (security)
  - Fixed: stale keyboard shortcut dead code (convention)
  - Fixed: refineError not cleared on new analysis (logic)
  - Fixed: correction text logged in route handler (security)
- verifier: All 745 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1-2 (Claude client + API endpoint files)
- Worker 2: Tasks 3-4 (FoodAnalyzer component + NutritionEditor deletion)
- Worker 3: Task 5 (documentation files)

### Continuation Status
All tasks completed.
