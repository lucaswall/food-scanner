# Implementation Plan

**Created:** 2026-04-10
**Source:** Backlog: FOO-946, FOO-947, FOO-948, FOO-949, FOO-950, FOO-951, FOO-952
**Linear Issues:** [FOO-946](https://linear.app/lw-claude/issue/FOO-946), [FOO-947](https://linear.app/lw-claude/issue/FOO-947), [FOO-948](https://linear.app/lw-claude/issue/FOO-948), [FOO-949](https://linear.app/lw-claude/issue/FOO-949), [FOO-950](https://linear.app/lw-claude/issue/FOO-950), [FOO-951](https://linear.app/lw-claude/issue/FOO-951), [FOO-952](https://linear.app/lw-claude/issue/FOO-952)
**Branch:** refactor/dedup-and-consistency-fixes

## Context Gathered

### Codebase Analysis

- **Related files:**
  - `src/components/food-analyzer.tsx` — handleLogToFitbit (:386), handleUseExisting (:466), handleSaveForLater (:537)
  - `src/components/food-chat.tsx` — handleLog (:512), handleSaveForLater (:753)
  - `src/components/saved-food-detail.tsx` — handleLogToFitbit (:67)
  - `src/components/quick-select.tsx` — handleLogToFitbit (:147)
  - `src/app/app/log-shared/[token]/log-shared-content.tsx` — handleLog (:95), inline SharedFood type (:15-34), manual camelCase→snake_case mapping (:106-127)
  - `src/app/api/log-food/route.ts` — isValidFoodLogRequest (:19-99), isValidTimeFormat (:102-109)
  - `src/app/api/edit-food/route.ts` — isValidFoodAnalysis (:28-75), isValidTimeFormat (:19-26)
  - `src/lib/claude.ts` — validateFoodAnalysis (:417-541) — coercion-based, fundamentally different purpose
  - `src/app/api/find-matches/route.ts` — POST, full FoodAnalysis matching via `findMatchingFoods()`
  - `src/app/api/search-foods/route.ts` — GET, text-only keyword search via `searchFoods()`
  - `src/app/api/shared-food/[token]/route.ts` — returns camelCase fields (Drizzle convention)
  - `src/app/app/chat/page.tsx` — missing FitbitSetupGuard
  - `src/app/app/edit/[id]/page.tsx` — missing FitbitSetupGuard
  - `src/app/app/analyze/page.tsx` — has FitbitSetupGuard (reference pattern)
  - `src/components/fitbit-setup-guard.tsx` — checks `fitbitConnected` + `hasFitbitCredentials`
  - `src/lib/date-utils.ts` — existing date utility module
  - `src/lib/safe-json.ts` — safeResponseJson utility
  - `src/lib/pending-submission.ts` — savePendingSubmission for token refresh flow
  - `src/lib/haptics.ts` — vibrateError
  - `src/types/index.ts` — FoodAnalysis (:55-82), FoodLogRequest (:96-107), FoodLogResponse (:109-117), ErrorCode (:128-147)

- **Existing patterns:**
  - Hooks in `src/hooks/` follow `use-*.ts` naming (8 existing hooks)
  - All client logging uses the pattern: fetch → safeResponseJson → check error codes → handle FITBIT_TOKEN_INVALID → handle FITBIT_CREDENTIALS_MISSING → vibrateError → set error state
  - `AbortSignal.timeout(15000)` is the standard timeout for client→API requests
  - Components use `setLogError`/`setError` + `setLogging`/`setIsLogging` state pairs

- **Test conventions:**
  - Colocated `__tests__/` subdirectories (e.g., `src/hooks/__tests__/use-keyboard-shortcuts.test.ts`)
  - Existing tests: `src/components/__tests__/fitbit-setup-guard.test.tsx`, `src/app/api/find-matches/__tests__/route.test.ts`, `src/app/api/search-foods/__tests__/route.test.ts`, `src/app/app/log-shared/[token]/__tests__/log-shared-content.test.tsx`
  - Vitest + Testing Library for component tests

### MCP Context

- **MCPs used:** Linear (issue management)
- **Findings:** All 7 issues are in Backlog state. FOO-946 is High priority. FOO-947, FOO-948, FOO-949 are Medium. FOO-950, FOO-951, FOO-952 are Low.

### Triage Results

**Planned:** FOO-946, FOO-947, FOO-948, FOO-949, FOO-950, FOO-951, FOO-952

All 7 issues validated against the codebase — all problems exist as described.

**Key relationships:**
- FOO-947 (LogSharedContent missing error handling) is fully resolved by FOO-946 (shared logToFitbit helper) — once LogSharedContent adopts the shared hook, it inherits all error handling patterns.
- FOO-952 (inline SharedFood type) is resolved by changing the shared-food API to return FoodAnalysis format (snake_case), eliminating the manual mapping. This is a prerequisite for FOO-946 so LogSharedContent can use the shared hook without field translation.

**Canceled:** None

## Scope Boundaries

### In Scope
- Extract shared `useLogToFitbit` hook from 6 duplicated implementations
- Extract shared food analysis validation from log-food and edit-food routes
- Extract shared `saveAnalysisForLater` helper from FoodAnalyzer and FoodChat
- Change shared-food API to return FoodAnalysis format (snake_case)
- Add FitbitSetupGuard to chat and edit pages
- Unify food matching to use `/api/find-matches` consistently
- Extract `isValidTimeFormat` to `src/lib/date-utils.ts`

### Out of Scope
- `validateFoodAnalysis` in `src/lib/claude.ts` — this is a coercion-based validator for AI output with fundamentally different semantics (coerces missing confidence to "medium", derives keywords from food_name). It cannot share logic with the boolean validators in routes. Keeping it separate is correct.
- Refactoring the shared-food API response shape beyond adding snake_case fields (the API still returns camelCase for backward compatibility of any cached responses)

## Tasks

### Task 1: Add FitbitSetupGuard to chat and edit pages
**Linear Issue:** [FOO-951](https://linear.app/lw-claude/issue/FOO-951)
**Effort:** S
**Files:**
- `src/app/app/chat/page.tsx` (modify)
- `src/app/app/edit/[id]/page.tsx` (modify)

**Steps:**
1. **RED:** Write tests verifying FitbitSetupGuard renders around ChatPageClient in chat/page.tsx and around EditFood in edit/[id]/page.tsx. Follow the pattern in `src/components/__tests__/fitbit-setup-guard.test.tsx` for how FitbitSetupGuard is tested. Assert that the component tree includes FitbitSetupGuard wrapping the page content.
2. **GREEN:** Import `FitbitSetupGuard` from `@/components/fitbit-setup-guard` in both pages. Wrap `ChatPageClient` in `<FitbitSetupGuard>` (follow the exact pattern in `src/app/app/analyze/page.tsx:25-27`). Wrap `EditFood` in `<FitbitSetupGuard>` similarly.
3. Verify: `npx vitest run "chat|edit|fitbit-setup-guard"`

**Notes:**
- Follow pattern in `src/app/app/analyze/page.tsx` — FitbitSetupGuard wraps the main content component
- The chat page currently only checks `if (!session)` — it should also use `validateSession()` like edit does, but that's a separate concern (not in scope)

---

### Task 2: Extract shared food validation
**Linear Issue:** [FOO-949](https://linear.app/lw-claude/issue/FOO-949)
**Effort:** M
**Files:**
- `src/lib/food-validation.ts` (create)
- `src/lib/__tests__/food-validation.test.ts` (create)
- `src/lib/date-utils.ts` (modify — add `isValidTimeFormat`)
- `src/lib/__tests__/date-utils.test.ts` (create if not exists, or modify)
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/edit-food/route.ts` (modify)

**Steps:**
1. **RED:** Write tests for a new `isValidFoodAnalysisFields(body)` function in `src/lib/__tests__/food-validation.test.ts`. Test cases:
   - Valid complete FoodAnalysis → returns true
   - Missing food_name → false
   - Empty food_name → false
   - food_name > 500 chars → false
   - Negative numeric fields (calories, protein_g, etc.) → false
   - amount = 0 → false
   - Invalid confidence value → false
   - notes/description > 2000 chars → false
   - Tier 1 nutrients: null → valid, positive number → valid, negative → false, non-number → false
   - Keywords: array of strings → valid, empty array → valid, strings > 100 chars → false, > 20 elements → false
   Also write tests for `isValidTimeFormat` moving to `src/lib/date-utils.ts`:
   - "12:30" → true, "12:30:00" → true, "25:00" → false, "12:60" → false, "abc" → false
2. **GREEN:** Create `src/lib/food-validation.ts` with `isValidFoodAnalysisFields(body: Record<string, unknown>): boolean` that validates the shared fields (food_name, amount, unit_id, all nutrition fields, notes, description, confidence, tier 1 nutrients, keywords as optional). Add `isValidTimeFormat` to `src/lib/date-utils.ts`.
3. **REFACTOR:** Update `src/app/api/log-food/route.ts`:
   - Import `isValidFoodAnalysisFields` from `@/lib/food-validation` and `isValidTimeFormat` from `@/lib/date-utils`
   - Replace the inline new-food-flow validation (lines 46-96) with a call to `isValidFoodAnalysisFields`
   - Keep the `reuseCustomFoodId` branch validation in-route (it's route-specific)
   - Remove the local `isValidTimeFormat` function
   Update `src/app/api/edit-food/route.ts`:
   - Import `isValidFoodAnalysisFields` from `@/lib/food-validation` and `isValidTimeFormat` from `@/lib/date-utils`
   - Replace the inline `isValidFoodAnalysis` with `isValidFoodAnalysisFields`
   - Remove the local `isValidTimeFormat` function
4. Verify: `npx vitest run "food-validation|date-utils|log-food|edit-food"`

**Notes:**
- Keywords validation: the shared function should treat keywords as **optional** (matching log-food behavior). edit-food currently requires non-empty keywords — add an additional `req.keywords.length > 0` check in the edit-food route after calling the shared validator.
- The shared validator is a **boolean validator** (returns true/false). `src/lib/claude.ts:validateFoodAnalysis` is a **coercion function** (returns clean object, throws on invalid). They serve different purposes — do NOT merge them.
- `isValidDateFormat` already exists in `date-utils.ts` — `isValidTimeFormat` is a natural addition alongside it.

---

### Task 3: Change shared-food API to return FoodAnalysis format
**Linear Issue:** [FOO-952](https://linear.app/lw-claude/issue/FOO-952)
**Effort:** S
**Files:**
- `src/app/api/shared-food/[token]/route.ts` (modify)
- `src/app/api/shared-food/[token]/__tests__/route.test.ts` (modify)
- `src/app/app/log-shared/[token]/log-shared-content.tsx` (modify)
- `src/app/app/log-shared/[token]/__tests__/log-shared-content.test.tsx` (modify)

**Steps:**
1. **RED:** Update `src/app/api/shared-food/[token]/__tests__/route.test.ts` to expect snake_case field names in the response: `food_name`, `amount`, `unit_id`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `fiber_g`, `sodium_mg`, `saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`, `confidence`, `notes`, `description`, `keywords`. Also expect the response to omit the `id` field (not part of FoodAnalysis).
2. **GREEN:** Modify `src/app/api/shared-food/[token]/route.ts` to return snake_case fields matching the `FoodAnalysis` interface. Change field names: `foodName` → `food_name`, `unitId` → `unit_id`, `proteinG` → `protein_g`, etc. Remove the `id` field from the response (consumers don't need the DB id).
3. **REFACTOR:** Update `src/app/app/log-shared/[token]/log-shared-content.tsx`:
   - Remove the inline `SharedFood` interface (lines 15-34)
   - Import `FoodAnalysis` from `@/types`
   - Change the `useSWR<SharedFood>` to `useSWR<FoodAnalysis>`
   - Remove the manual camelCase→snake_case mapping in handleLog (lines 106-127) — spread the data directly like other components do
   - Update the JSX to use snake_case field names from FoodAnalysis (e.g., `data.food_name` instead of `data.foodName`, `data.protein_g` instead of `data.proteinG`, etc.)
   - Update NutritionFactsCard props: `foodName={data.food_name}`, `proteinG={data.protein_g}`, etc.
4. Update `log-shared-content.test.tsx` to use snake_case field names in mock data.
5. Verify: `npx vitest run "shared-food|log-shared"`

**Notes:**
- NutritionFactsCard props use camelCase (`proteinG`, `carbsG`, etc.) — the JSX needs to map `data.protein_g` → `proteinG={data.protein_g}`. This is a prop assignment, not a field mapping.
- The `handleLog` function can now spread `...data` directly like FoodAnalyzer does, plus `mealTypeId`, `date`, `time`, `zoneOffset`.

---

### Task 4: Create useLogToFitbit hook
**Linear Issue:** [FOO-946](https://linear.app/lw-claude/issue/FOO-946)
**Effort:** M
**Files:**
- `src/hooks/use-log-to-fitbit.ts` (create)
- `src/hooks/__tests__/use-log-to-fitbit.test.ts` (create)

**Steps:**
1. **RED:** Write tests for a new `useLogToFitbit` hook in `src/hooks/__tests__/use-log-to-fitbit.test.ts`. The hook should accept a config object and return `{ logToFitbit, logging, logError, logResponse, clearLogError }`. Test cases:
   - Successful log: calls fetch with correct body, sets logResponse on success
   - FITBIT_TOKEN_INVALID: calls savePendingSubmission with the right args and redirects to `/api/auth/fitbit`
   - FITBIT_CREDENTIALS_MISSING: sets logError to "Fitbit is not set up. Please configure your credentials in Settings."
   - FITBIT_NOT_CONNECTED: same error message as FITBIT_CREDENTIALS_MISSING
   - Generic error: sets logError from response message
   - Timeout (AbortSignal.timeout): sets logError to "Request timed out. Please try again."
   - Network error: sets logError from error message
   - Calls vibrateError on all failure paths (except FITBIT_TOKEN_INVALID which redirects)
   - Uses safeResponseJson (not raw response.json())
   - Uses AbortSignal.timeout(15000)
   - Reuse flow: when analysis has `sourceCustomFoodId`, sends `reuseCustomFoodId` body format
   - No-op when logging is already true (prevents double submission)
2. **GREEN:** Create `src/hooks/use-log-to-fitbit.ts`:
   - The hook accepts a config: `{ analysis, mealTypeId, selectedTime?, onSuccess?, getSessionId? }`
   - Returns `{ logToFitbit, logging, logError, logResponse, clearLogError }`
   - `logToFitbit()` implements the full pattern: build request body (handling reuse vs new food), fetch with AbortSignal.timeout(15000), safeResponseJson, error code handling (FITBIT_TOKEN_INVALID → savePendingSubmission + redirect, FITBIT_CREDENTIALS_MISSING/NOT_CONNECTED → specific message, generic → response message), vibrateError on all non-redirect failures, timeout/network error handling
   - Import dependencies: `safeResponseJson` from `@/lib/safe-json`, `savePendingSubmission` from `@/lib/pending-submission`, `vibrateError` from `@/lib/haptics`, `getLocalDateTime` from `@/lib/meal-type`
   - The hook also supports an optional `logToFitbitWithMatch(match: FoodMatch)` for the reuse-existing-match flow (used by food-analyzer's handleUseExisting)
3. **REFACTOR:** Ensure the hook handles the date override pattern used by food-chat (`analysis.date ?? localDateTime.date`) — accept an optional `dateOverride` in the analysis or config.
4. Verify: `npx vitest run "use-log-to-fitbit"`

**Notes:**
- Follow the naming convention in `src/hooks/` (e.g., `use-delete-food-entry.ts`)
- The hook must handle two body formats: (1) reuse flow (`reuseCustomFoodId` + metadata), (2) new food flow (`...analysis` + mealTypeId/date/time/zoneOffset). See `src/components/food-analyzer.tsx:395-411` for the pattern.
- `getSessionId` callback is optional — only FoodAnalyzer passes `getActiveSessionId()` to savePendingSubmission. Other components pass undefined for sessionId.
- The food-chat component also has a separate `handleSave` (edit existing entry) and `handleSaveExisting` (save + reuseCustomFoodId). These are **edit** flows, not log flows — they call different APIs (`/api/edit-food`). They are NOT in scope for this hook.

---

### Task 5: Refactor all logging components to use useLogToFitbit
**Linear Issue:** [FOO-946](https://linear.app/lw-claude/issue/FOO-946), [FOO-947](https://linear.app/lw-claude/issue/FOO-947)
**Effort:** L
**Depends on:** Task 3 (shared-food API returns FoodAnalysis), Task 4 (hook exists)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/saved-food-detail.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/food-chat.tsx` (modify)
- `src/app/app/log-shared/[token]/log-shared-content.tsx` (modify)
- All corresponding test files (modify as needed)

**Steps:**
1. **RED:** For each component, write or update tests asserting that the component uses the hook's returned values (logError, logging state, logResponse) rather than managing its own state. Test that error handling behavior matches the canonical pattern (FITBIT_TOKEN_INVALID redirects, FITBIT_CREDENTIALS_MISSING shows specific message, timeouts handled).
2. **GREEN:** Refactor each component:

   **food-analyzer.tsx:**
   - Replace `handleLogToFitbit` (lines 386-464) with hook usage: `const { logToFitbit, logging, logError, logResponse, clearLogError } = useLogToFitbit({ analysis, mealTypeId, selectedTime, onSuccess: actions.clearPersistedSession, getSessionId: getActiveSessionId })`
   - Replace `handleUseExisting` (lines 466-534) with the hook's match-reuse capability
   - Remove local `logging`, `logError`, `logResponse` state (now from hook)
   - Remove imports: `safeResponseJson`, `savePendingSubmission`, `vibrateError` (now encapsulated in hook)

   **saved-food-detail.tsx:**
   - Replace `handleLogToFitbit` (lines 67-145) with hook usage
   - This component was missing `vibrateError` and `FITBIT_CREDENTIALS_MISSING` handling — the hook adds both

   **quick-select.tsx:**
   - Replace `handleLogToFitbit` (lines 147-206) with hook usage

   **food-chat.tsx:**
   - Replace `handleLog` (lines 512-596) with hook usage
   - This component was missing `vibrateError` — the hook adds it
   - Keep `handleSave` and `handleSaveExisting` unchanged (they're edit flows, not log flows)

   **log-shared-content.tsx:**
   - Replace `handleLog` (lines 95-147) with hook usage
   - This resolves FOO-947: the component inherits safeResponseJson, AbortSignal.timeout, vibrateError, FITBIT_TOKEN_INVALID handling, FITBIT_CREDENTIALS_MISSING handling — all previously missing
   - Note: this component needs savePendingSubmission support from the hook. For the shared food path, the pending submission should include the analysis data so it can be re-logged after re-auth.

3. **REFACTOR:** Remove now-unused imports from each component. Verify each component's success callback is preserved (food-analyzer clears persisted session, food-chat calls onLogged, etc.).
4. Verify: `npx vitest run "food-analyzer|saved-food-detail|quick-select|food-chat|log-shared"`

**Notes:**
- Each component has a slightly different success handler: food-analyzer calls `actions.clearPersistedSession()` + sets `logResponse`, saved-food-detail sets `logResponse` + `loggedFoodName`, food-chat calls `onLogged?.()`, quick-select navigates to success screen, log-shared-content sets `logResponse`. The hook's `onSuccess` callback must receive the `FoodLogResponse` so each component can handle post-success differently.
- food-chat's `handleLog` uses `analysis.date ?? localDateTime.date` (date override from AI). The hook must support this pattern.
- The hook should expose `setLogResponse` or accept `onSuccess(response)` callback — components need to control their own success UI state.

---

### Task 6: Extract shared save-for-later helper
**Linear Issue:** [FOO-950](https://linear.app/lw-claude/issue/FOO-950)
**Effort:** S
**Files:**
- `src/lib/save-for-later.ts` (create)
- `src/lib/__tests__/save-for-later.test.ts` (create)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/food-chat.tsx` (modify)

**Steps:**
1. **RED:** Write tests for a new `saveAnalysisForLater(analysis: FoodAnalysis)` function in `src/lib/__tests__/save-for-later.test.ts`. Test cases:
   - Strips `sourceCustomFoodId` and `editingEntryId` before sending
   - POSTs to `/api/saved-analyses` with correct body
   - Uses `AbortSignal.timeout(15000)`
   - Uses `safeResponseJson`
   - Returns `{ success: true, id: number }` on success
   - Throws descriptive error on API failure (using error message from response)
   - Throws "Request timed out" on timeout
   - Calls `invalidateSavedAnalysesCaches()` on success
2. **GREEN:** Create `src/lib/save-for-later.ts` with `saveAnalysisForLater(analysis: FoodAnalysis): Promise<{ id: number }>`. The function handles: strip transient fields, POST, safeResponseJson, error handling, cache invalidation. It throws on failure so the caller can catch and display errors.
3. **REFACTOR:** Update both components:

   **food-analyzer.tsx:**
   - Replace `handleSaveForLater` (lines 537-581) with a call to `saveAnalysisForLater(analysis)`
   - Keep component-specific post-success logic: `setSaveSuccess(true)`, `actions.clearSession()`, `router.push("/app")`

   **food-chat.tsx:**
   - Replace `handleSaveForLater` (lines 753-791) with a call to `saveAnalysisForLater(latestAnalysis)`
   - Keep component-specific post-success logic: `onClose?.()`

4. Verify: `npx vitest run "save-for-later|food-analyzer|food-chat"`

**Notes:**
- Both components currently handle `vibrateError` on failure. The helper should NOT call vibrateError (it's a lib function, not a UI concern). Components should call vibrateError in their catch blocks.
- `invalidateSavedAnalysesCaches` is imported from `@/lib/swr` — the helper should import and call it on success since both components do this.
- The function should NOT manage React state (saving, saveError, saveSuccess) — that stays in components.

---

### Task 7: Unify food matching in SavedFoodDetail
**Linear Issue:** [FOO-948](https://linear.app/lw-claude/issue/FOO-948)
**Effort:** S
**Files:**
- `src/components/saved-food-detail.tsx` (modify)
- `src/components/__tests__/saved-food-detail.test.tsx` (create or modify)

**Steps:**
1. **RED:** Write tests for SavedFoodDetail verifying it calls `/api/find-matches` (POST) instead of `/api/search-foods` (GET). Assert that the request body includes the full FoodAnalysis fields (keywords, food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg). Assert that matches are displayed correctly from the `{ data: { matches: FoodMatch[] } }` response shape.
2. **GREEN:** Modify `src/components/saved-food-detail.tsx`:
   - Replace the current `useSWR` GET call to `/api/search-foods?q=...` (lines 45-49) with a POST-based fetch to `/api/find-matches`
   - Since `useSWR` is designed for GET requests, use `useSWR` with a custom fetcher that POSTs the FoodAnalysis body to `/api/find-matches`. The SWR key should encode the savedAnalysis id to ensure proper caching/deduplication.
   - Extract matches from `result.data.matches` (the find-matches response shape) instead of the top-level `foods` array
   - The saved analysis has the full `FoodAnalysis` object in `savedAnalysis.foodAnalysis` — pass the required fields (keywords, food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg) in the POST body
3. **REFACTOR:** Remove the keyword derivation logic (`const keywords = savedAnalysis?.foodAnalysis.food_name?.trim() ?? null`) since find-matches uses the full analysis, not just the food name.
4. Verify: `npx vitest run "saved-food-detail|find-matches"`

**Notes:**
- Follow the POST-with-SWR pattern: use a fetcher function that sends a POST request. The SWR key should be a stable string like `find-matches-${savedId}` to avoid refetching on every render.
- The find-matches API requires auth (`getSession()` + `validateSession()`), which is already available since the user is logged in on the saved food detail page.
- This change means SavedFoodDetail shows the same matches as FoodAnalyzer for the same food — consistent UX across paths.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Eliminate code duplication across food logging, validation, and save-for-later paths, and fix consistency gaps in error handling, food matching, and Fitbit setup guards.
**Linear Issues:** FOO-946, FOO-947, FOO-948, FOO-949, FOO-950, FOO-951, FOO-952
**Approach:** Extract three shared abstractions (useLogToFitbit hook, food validation module, save-for-later helper), normalize the shared-food API to FoodAnalysis format, add missing FitbitSetupGuard wrappers, and unify food matching to use the richer find-matches API consistently. FOO-947 and FOO-952 are resolved as side effects of FOO-946 and the API normalization respectively.
**Scope:** 7 tasks, ~20 files, ~15 test files
**Key Decisions:**
- `validateFoodAnalysis` in claude.ts stays separate — it's a coercion function, not a boolean validator
- shared-food API changes to snake_case (FoodAnalysis format) to eliminate the manual mapping layer
- useLogToFitbit is a hook (not a plain function) because it manages React state (logging, logError, logResponse)
- save-for-later helper is a plain async function (not a hook) because components manage their own state differently
**Risks:**
- Task 5 is large (6 component refactors) — careful attention needed to preserve each component's unique success handling
- Changing shared-food API response format is a breaking change, but log-shared-content.tsx is the only consumer

---

## Iteration 1

**Implemented:** 2026-04-10
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add FitbitSetupGuard to chat and edit pages — wrapped ChatPageClient and EditFood in FitbitSetupGuard (worker-1)
- Task 2: Extract shared food validation — created isValidFoodAnalysisFields in src/lib/food-validation.ts, moved isValidTimeFormat to date-utils.ts (worker-2)
- Task 3: Change shared-food API to return FoodAnalysis format — snake_case fields, removed id, updated log-shared-content.tsx (worker-2)
- Task 4: Create useLogToFitbit hook — 21 tests covering all error paths, reuse flow, match flow (worker-3)
- Task 5: Refactor all logging components to use useLogToFitbit — food-analyzer, saved-food-detail, quick-select, food-chat, log-shared-content (worker-3)
- Task 6: Extract shared save-for-later helper — saveAnalysisForLater in src/lib/save-for-later.ts, refactored both components (worker-1)
- Task 7: Unify food matching in SavedFoodDetail — replaced /api/search-foods GET with /api/find-matches POST (worker-1)

### Files Modified
- `src/app/app/chat/page.tsx` — Added FitbitSetupGuard wrapper
- `src/app/app/chat/__tests__/page.test.tsx` — Created (3 tests)
- `src/app/app/edit/[id]/page.tsx` — Added FitbitSetupGuard wrapper
- `src/app/app/edit/[id]/__tests__/page.test.tsx` — Created (3 tests)
- `src/lib/food-validation.ts` — Created shared isValidFoodAnalysisFields
- `src/lib/__tests__/food-validation.test.ts` — Created (validation tests)
- `src/lib/date-utils.ts` — Added isValidTimeFormat
- `src/lib/__tests__/date-utils.test.ts` — Added isValidTimeFormat tests
- `src/lib/save-for-later.ts` — Created saveAnalysisForLater helper
- `src/lib/__tests__/save-for-later.test.ts` — Created (10 tests)
- `src/app/api/log-food/route.ts` — Replaced inline validation with shared module
- `src/app/api/edit-food/route.ts` — Replaced inline validation with shared module
- `src/app/api/shared-food/[token]/route.ts` — Changed to snake_case FoodAnalysis format, null-safe notes/description/keywords
- `src/app/api/shared-food/[token]/__tests__/route.test.ts` — Updated for snake_case
- `src/app/app/log-shared/[token]/log-shared-content.tsx` — Removed SharedFood type, uses FoodAnalysis + useLogToFitbit
- `src/app/app/log-shared/[token]/__tests__/log-shared-content.test.tsx` — Updated for snake_case
- `src/hooks/use-log-to-fitbit.ts` — Created hook (logToFitbit + logToFitbitWithMatch)
- `src/hooks/__tests__/use-log-to-fitbit.test.ts` — Created (21 tests)
- `src/components/food-analyzer.tsx` — Refactored to useLogToFitbit + saveAnalysisForLater
- `src/components/food-chat.tsx` — Refactored to useLogToFitbit + saveAnalysisForLater
- `src/components/saved-food-detail.tsx` — Refactored to useLogToFitbit + find-matches POST
- `src/components/quick-select.tsx` — Refactored to useLogToFitbit
- `src/components/__tests__/saved-food-detail.test.tsx` — Updated for find-matches

### Linear Updates
- FOO-946: Todo → In Progress → Review
- FOO-947: Todo → In Progress → Review
- FOO-948: Todo → In Progress → Review
- FOO-949: Todo → In Progress → Review
- FOO-950: Todo → In Progress → Review
- FOO-951: Todo → In Progress → Review
- FOO-952: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (1 HIGH, 2 MEDIUM, 1 LOW), all fixed before proceeding:
  - HIGH: shared-food route returned null notes/description (fails validation) — added ?? "" fallback
  - MEDIUM: onSuccess async callback not awaited — added await + Promise<void> type
  - MEDIUM: Dead test parameters giving false coverage confidence — removed unused params
  - LOW: Non-null assertion on result.data.id — replaced with null check + descriptive error
- verifier: 3193 tests pass across 184 files, build clean, zero warnings

### Work Partition
- Worker 1: Tasks 1, 6, 7 (pages + save-for-later + food matching)
- Worker 2: Tasks 2, 3 (API validation + shared-food API)
- Worker 3: Tasks 4, 5 (useLogToFitbit hook + component refactoring)

### Merge Summary
- Worker 2: fast-forward (no conflicts)
- Worker 1: merged cleanly (auto-merge)
- Worker 3: 1 conflict in log-shared-content.tsx (worker-2 changed to snake_case, worker-3 added hook — resolved by using hook with FoodAnalysis data directly, removing redundant conversion)

### Continuation Status
All tasks completed.
