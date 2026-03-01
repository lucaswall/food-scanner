# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-750-chat-edit-and-backlog-batch
**Issues:** FOO-750, FOO-751, FOO-748, FOO-749, FOO-752, FOO-753, FOO-754, FOO-755, FOO-756, FOO-757
**Created:** 2026-03-01
**Last Updated:** 2026-03-01

## Summary

Three independent workstreams from the backlog:

1. **Chat Edit Feature** (FOO-750 + FOO-751): Enable regular chat to edit existing food log entries instead of creating duplicates. Adds `editing_entry_id` to the `report_nutrition` tool schema and teaches Claude when to use it via prompt updates.
2. **Dashboard Enhancement** (FOO-748 + FOO-749): Extract reusable food entry interaction code (delete, detail sheet, favorite, share) from FoodHistory, then use it in the Dashboard's MealBreakdown for consistent edit/delete/detail functionality.
3. **E2E Test Coverage** (FOO-752–757): Fill screenshot and test gaps across edit page, log-shared page, photo capture, dialogs/modals, empty states, and settings interactive states.

## Issues

### FOO-750: Regular chat cannot edit existing food log entries — creates duplicates instead

**Priority:** High
**Labels:** Feature
**Description:** When a user asks regular chat to edit a food entry found via `search_food_log`, Claude calls `report_nutrition` which creates a new entry. The tool has no `editing_entry_id` field to signal "update entry X." The client always routes to `/api/log-food` (create), never `/api/edit-food` (update).

**Acceptance Criteria:**
- [ ] `report_nutrition` tool schema includes optional `editing_entry_id` field (number or null)
- [ ] `FoodAnalysis` type includes optional `editingEntryId` field
- [ ] `validateFoodAnalysis` validates the new field (positive integer or null)
- [ ] FoodChat detects `editingEntryId` in analysis and switches button to "Save Changes"
- [ ] When `editingEntryId` is set, FoodChat routes to `/api/edit-food` with that entry ID
- [ ] When `editingEntryId` is null/absent, behavior is unchanged (create via `/api/log-food`)

### FOO-751: Update chat system prompt to instruct Claude when to edit vs create entries

**Priority:** High
**Labels:** Feature
**Description:** The `CHAT_SYSTEM_PROMPT` has no instructions about editing. Claude needs guidance on when to set `editing_entry_id` vs leave it null. Edit-intent signals: "edit that", "change the X to Y", "update my lunch" referencing a search result. Create-intent: new food descriptions, "I had X", "log the same thing."

**Acceptance Criteria:**
- [ ] `CHAT_SYSTEM_PROMPT` includes a section explaining edit vs create intent detection
- [ ] Prompt instructs Claude to use `[id:N]` from `search_food_log` results as `editing_entry_id`
- [ ] Edge cases documented: "log the same thing" = create, "change what I had" = edit
- [ ] `REPORT_NUTRITION_TOOL` description updated to mention the edit use case

### FOO-748: Extract shared food entry interaction code from FoodHistory

**Priority:** Medium
**Labels:** Improvement
**Description:** Delete logic (~45 lines), entry detail bottom-sheet, favorite toggle, and share handler are hardcoded in `FoodHistory`. These need to be extracted into reusable hooks and components so the Dashboard can use them too.

**Acceptance Criteria:**
- [ ] `useDeleteFoodEntry` hook extracted with full delete flow (confirmation, API, error handling, cache invalidation)
- [ ] `FoodEntryDetailSheet` component extracted with NutritionFactsCard, favorite toggle, share button
- [ ] `FoodHistory` refactored to use the extracted pieces with identical behavior
- [ ] All existing FoodHistory tests continue to pass

### FOO-749: Dashboard MealBreakdown: use FoodEntryCard with edit/delete and detail sheet

**Priority:** Medium
**Labels:** Improvement
**Description:** Dashboard's MealBreakdown renders entries as plain `<Link>` elements. Should use `FoodEntryCard` with `actions="edit-delete"` and open the shared entry detail bottom-sheet on click. Requires extending `MealEntry` type with missing fields.

**Acceptance Criteria:**
- [ ] `MealEntry` type extended with `amount`, `unitId`, `isFavorite`, `fitbitLogId` fields
- [ ] Nutrition-summary query/builder populates the new MealEntry fields
- [ ] MealBreakdown uses FoodEntryCard instead of plain Link elements
- [ ] Entry click opens FoodEntryDetailSheet
- [ ] Edit button navigates to `/app/edit/{id}`
- [ ] Delete button uses useDeleteFoodEntry hook
- [ ] Collapsible meal type folder structure preserved
- [ ] `mealTypeId` NOT shown in FoodEntryCard meta (entries already grouped by meal type)

### FOO-752: Edit Food page has zero E2E test coverage

**Priority:** Medium
**Labels:** Improvement
**Description:** `/app/edit/[id]` page has no E2E tests. Should cover: loading with pre-populated entry data, chat interaction in edit mode, save confirmation.

**Acceptance Criteria:**
- [ ] `e2e/tests/edit-food.spec.ts` created
- [ ] Tests seed a food log entry and navigate to edit page
- [ ] Screenshots: edit page loaded, confirmation after save
- [ ] Light+dark mode screenshots via `captureScreenshots()`

### FOO-753: Log Shared Food page has zero E2E test coverage

**Priority:** Low
**Labels:** Improvement
**Description:** `/app/log-shared/[token]` page has no E2E tests. Public-facing page showing shared food entries with NutritionFactsCard and "Log to Fitbit" button.

**Acceptance Criteria:**
- [ ] `e2e/tests/log-shared.spec.ts` created
- [ ] Tests mock shared food token API
- [ ] Screenshots: shared food loaded with nutrition card, error state (invalid token)
- [ ] Light+dark mode screenshots

### FOO-754: Analyze page E2E tests missing photo capture flow screenshots

**Priority:** Medium
**Labels:** Improvement
**Description:** `analyze.spec.ts` only tests text-based analysis. Photo capture flow (thumbnails, preview dialog, clear confirmation) has zero screenshot coverage.

**Acceptance Criteria:**
- [ ] Photo capture test added (new spec or extension of existing)
- [ ] Uses Playwright file chooser API to simulate photo selection
- [ ] Screenshots: photo thumbnails visible, analyzing spinner, food matches section

### FOO-755: Missing dialog and modal E2E screenshots across multiple screens

**Priority:** Low
**Labels:** Improvement
**Description:** History entry detail bottom sheet, history delete confirmation, quick select confirmation, and quick select search results have no screenshot coverage.

**Acceptance Criteria:**
- [ ] History entry detail sheet screenshot added to `history.spec.ts`
- [ ] History delete confirmation screenshot added
- [ ] Quick select search results and confirmation screenshots added to `quick-select.spec.ts`
- [ ] Light+dark mode screenshots

### FOO-756: Missing empty state and guard E2E screenshots

**Priority:** Low
**Labels:** Improvement
**Description:** Dashboard empty state, history true empty state, FitbitSetupGuard, and loading skeletons have no screenshot coverage.

**Acceptance Criteria:**
- [ ] Dashboard empty state screenshot (no seeded data)
- [ ] History true empty state screenshot
- [ ] FitbitSetupGuard screenshot (mock Fitbit as disconnected)
- [ ] Added to `empty-states.spec.ts` or relevant spec files

### FOO-757: Missing settings page state screenshots

**Priority:** Low
**Labels:** Improvement
**Description:** Settings page interactive states not captured: API key creation flow, delete confirmation, Fitbit credentials edit mode.

**Acceptance Criteria:**
- [ ] API key create dialog screenshot added to `settings.spec.ts`
- [ ] API key delete confirmation screenshot added
- [ ] Fitbit Client ID edit mode screenshot added
- [ ] Light+dark mode screenshots

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests pass (`npm test`)
- [ ] Build succeeds (`npm run build`)

## Implementation Tasks

---

### Phase 1: Chat Edit Feature (FOO-750 + FOO-751)

---

### Task 1: Add `editingEntryId` to FoodAnalysis type and report_nutrition tool schema

**Issue:** FOO-750
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Write a test in `src/lib/__tests__/claude.test.ts` that calls `validateFoodAnalysis` with a valid `editing_entry_id` set to a positive integer. The test should assert that the returned `FoodAnalysis` object has `editingEntryId` set to that integer. This test will fail because the field doesn't exist yet.
   - Run: `npm test -- claude.test`
   - Verify: Test fails — `editingEntryId` is undefined in the result.

2. **RED** — Write additional test cases for `validateFoodAnalysis`:
   - `editing_entry_id: null` → `editingEntryId` should not be set (or undefined)
   - `editing_entry_id: 0` → should not be set (0 is not a valid entry ID)
   - `editing_entry_id: -5` → should throw ClaudeApiError
   - `editing_entry_id: "abc"` → should throw ClaudeApiError
   - Run: `npm test -- claude.test`

3. **GREEN** — Add `editingEntryId?: number` to the `FoodAnalysis` interface in `src/types/index.ts`. Add `editing_entry_id` property to `REPORT_NUTRITION_TOOL.input_schema.properties` in `src/lib/claude.ts` with type `["number", "null"]` and appropriate description. Add it to the `required` array. Add validation logic in `validateFoodAnalysis` following the same pattern as `source_custom_food_id` validation (positive integer or null/0/undefined → omitted).
   - Run: `npm test -- claude.test`
   - Verify: All tests pass.

**Notes:**
- Follow the exact pattern of `source_custom_food_id` for both the tool schema property and the `validateFoodAnalysis` logic (lines 411–418 and 477–479 in `src/lib/claude.ts`).
- The tool description should explain: "Set to the entry ID from search_food_log results when the user asks to edit an existing entry. Set to null when creating new food."
- `FoodAnalysis` field uses camelCase (`editingEntryId`), tool schema uses snake_case (`editing_entry_id`) — consistent with existing `sourceCustomFoodId`/`source_custom_food_id` convention.

---

### Task 2: Update FoodChat to handle editingEntryId from regular chat

**Issue:** FOO-750
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify if exists, create if not)

**TDD Steps:**

1. **RED** — Write a test that renders FoodChat in `mode="analyze"` (default), simulates receiving an analysis with `editingEntryId` set to a positive integer, and asserts:
   - The button text changes to "Save Changes" (not "Log to Fitbit")
   - Run: `npm test -- food-chat`
   - Verify: Test fails — button still shows "Log to Fitbit".

2. **GREEN** — In `FoodChat`, compute a derived state: `isEditingExisting = !isEditMode && latestAnalysis?.editingEntryId != null`. When this is true:
   - Button text: "Save Changes" (same as edit mode)
   - Button handler: call a modified version of `handleSave` that uses `latestAnalysis.editingEntryId` as the entry ID
   - The save body should POST to `/api/edit-food` with `entryId: latestAnalysis.editingEntryId` plus the analysis fields, matching the existing `handleSave` pattern (lines 596–602).
   - Run: `npm test -- food-chat`
   - Verify: Tests pass.

3. **RED** — Write a test that when `editingEntryId` is NOT set (null or absent), the button still shows "Log to Fitbit" and routes to `/api/log-food`.
   - Verify: Should pass immediately (existing behavior unchanged).

**Notes:**
- The key insight is that `isEditMode` (from `mode="edit"` prop) and `isEditingExisting` (from `editingEntryId` in analysis) are different triggers but both route to `/api/edit-food`.
- In `isEditingExisting` mode, the date should come from the existing entry. The chat API should fetch the entry's date. Alternatively, use the current date — check how the existing edit flow handles dates (line 600: `date: editEntry.date`). Since we don't have the full entry object, we need to decide: either fetch it or use current date. The simplest approach: POST to `/api/edit-food` which already fetches the entry internally, so just pass the current date.
- Actually, `/api/edit-food` requires `entryId` in the body and uses it to look up the entry. It validates the date against the entry. For the initial implementation, the client should send the current date — the API will handle it. If this causes issues, a follow-up can fetch the entry's date.
- Reference: existing `handleSave` implementation at lines 579–652 in `food-chat.tsx`.

---

### Task 3: Update CHAT_SYSTEM_PROMPT with edit vs create instructions

**Issue:** FOO-751
**Files:**
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Write a test in `src/lib/__tests__/claude.test.ts` that asserts `CHAT_SYSTEM_PROMPT` contains the substring `editing_entry_id`. This verifies the prompt mentions the new field.
   - Run: `npm test -- claude.test`
   - Verify: Test fails — prompt doesn't mention `editing_entry_id`.

2. **GREEN** — Add a new section to `CHAT_SYSTEM_PROMPT` after the `source_custom_food_id` rule (line 74). The section should cover:
   - **When to set `editing_entry_id`:** When the user references an entry from `search_food_log` results and asks to modify it (e.g., "edit that", "change the chicken to 200g", "update my lunch", "fix the calories"), set `editing_entry_id` to that entry's `[id:N]` value.
   - **When to leave it null:** When describing new food, uploading new photos, or saying "log the same thing" / "I had that again" (create-intent), set to null.
   - **Key distinction:** "log the same thing" = new entry (null), "change what I had for lunch" = edit existing (set ID).
   - **Interaction with `source_custom_food_id`:** When editing, set `editing_entry_id` to the entry ID AND set `source_custom_food_id` to null (since nutrition values are being modified). If the user wants to re-log exactly the same food without changes, that's a create with `source_custom_food_id` set.
   - Run: `npm test -- claude.test`
   - Verify: Test passes.

3. **REFACTOR** — Also update the `report_nutrition` tool description (line 92–93) to mention that the tool can be used for both creating new entries and editing existing ones.

**Notes:**
- Keep the prompt addition concise — Claude works better with clear rules than verbose explanations.
- Reference the existing prompt style at lines 40–81 in `src/lib/claude.ts`.
- The edit-mode variant (`REPORT_NUTRITION_EDIT_UI_CARD_NOTE`) is only used by the dedicated edit chat API. In regular chat, the UI card note switches dynamically based on `editingEntryId`.

---

### Task 4: Handle date resolution for chat-initiated edits

**Issue:** FOO-750
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/app/api/edit-food/route.ts` (verify — may not need changes)

**TDD Steps:**

1. **RED** — Write a test that when FoodChat is in analyze mode with `editingEntryId` set, the save request to `/api/edit-food` includes the `entryId` and a valid `date` field.
   - Run: `npm test -- food-chat`

2. **GREEN** — In the `isEditingExisting` save path, fetch the entry's date from `/api/food-history/{id}` (GET) before POSTing to `/api/edit-food`. This ensures the edit operates on the correct date. Alternatively, if `/api/edit-food` already looks up the entry's date server-side, just pass the client's current date.
   - Verify: Check the edit-food route handler to see if it uses the passed `date` or looks it up. The existing handler at `src/app/api/edit-food/route.ts` receives `date` in the body — verify if it cross-references with the entry's actual date.
   - Run: `npm test -- food-chat`

3. **REFACTOR** — If needed, ensure the edit-food API gracefully handles date mismatches (client sends today's date but entry is from yesterday).

**Notes:**
- This task is investigative — the exact solution depends on how `/api/edit-food` handles the date. The simplest correct approach should be chosen.
- Reference: `handleSave` at lines 596–601 uses `editEntry.date` — but in chat-initiated edits we don't have the full editEntry object.

---

### Task 5: Integration verification for chat edit feature

**Issue:** FOO-750, FOO-751
**Files:**
- Various files from Tasks 1–4

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification checklist:
   - [ ] Regular chat: describe new food → button says "Log to Fitbit" → creates new entry
   - [ ] Regular chat: search food log → ask to edit result → button says "Save Changes" → updates existing entry
   - [ ] Regular chat: search food log → "log the same thing" → button says "Log to Fitbit" → creates new entry
   - [ ] Edit page (existing flow): still works identically

---

### Phase 2: Dashboard Enhancement (FOO-748 + FOO-749)

---

### Task 6: Extract useDeleteFoodEntry hook

**Issue:** FOO-748
**Files:**
- `src/hooks/use-delete-food-entry.ts` (create)
- `src/hooks/__tests__/use-delete-food-entry.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for the hook behavior:
   - `handleDeleteRequest(id)` sets `deleteTargetId` to the given ID
   - `handleDeleteConfirm()` calls `DELETE /api/food-history/{id}`, sets `deletingId` during the request, and calls the `onSuccess` callback on success
   - On API error, sets `deleteError` and `deleteErrorCode`, calls `vibrateError()`
   - Handles `FITBIT_CREDENTIALS_MISSING` and `FITBIT_NOT_CONNECTED` error codes with specific messages
   - Handles timeout errors
   - `handleDeleteCancel()` clears `deleteTargetId`
   - Run: `npm test -- use-delete-food-entry`

2. **GREEN** — Create the hook extracting logic from `FoodHistory` lines 143–189. The hook should accept `onSuccess: () => void` callback (for cache invalidation). Return: `{ deleteTargetId, deletingId, deleteError, deleteErrorCode, handleDeleteRequest, handleDeleteConfirm, handleDeleteCancel }`.
   - Run: `npm test -- use-delete-food-entry`

3. **REFACTOR** — Ensure the hook uses the same error handling patterns (AbortSignal.timeout, Sentry.captureException, safeResponseJson) as the original code.

**Notes:**
- Reference: `FoodHistory` lines 143–189 for the delete handler, lines 438–451 for the AlertDialog rendering.
- The AlertDialog rendering itself stays in the consuming component — the hook only manages state and API calls.
- `vibrateError()` import from `@/lib/haptics`.
- `invalidateFoodCaches()` from `@/lib/swr` — the caller passes this as `onSuccess`.

---

### Task 7: Extract FoodEntryDetailSheet component

**Issue:** FOO-748
**Files:**
- `src/components/food-entry-detail-sheet.tsx` (create)
- `src/components/__tests__/food-entry-detail-sheet.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write tests for the component:
   - Renders NutritionFactsCard with correct props when `entry` is provided
   - Shows favorite toggle button with correct aria-pressed state
   - Shows share button
   - Shows "View Full Details" link pointing to `/app/food-detail/{id}`
   - Does not render anything when `entry` is null
   - Run: `npm test -- food-entry-detail-sheet`

2. **GREEN** — Create the component extracting the Dialog from `FoodHistory` lines 372–435. Props: `entry: FoodLogHistoryEntry | null`, `open: boolean`, `onOpenChange: (open: boolean) => void`, `onToggleFavorite: (entry) => void`, `localFavorites: Map<number, boolean>`, `onShare: (entry) => void`, `isSharing: boolean`, `shareCopied: boolean`, `shareError: string | null`.
   - Run: `npm test -- food-entry-detail-sheet`

3. **REFACTOR** — Consider whether the favorite/share state management should also be extracted into a hook. For now, keep it as props — the consuming component manages the state.

**Notes:**
- The entry type should accept both `FoodLogHistoryEntry` and a compatible subset of `MealEntry` (after Task 9 extends it). Use a common interface or union type.
- Reference: `FoodHistory` lines 372–435 for the exact Dialog structure.
- The component uses `Dialog` with `variant="bottom-sheet"` from shadcn/ui.

---

### Task 8: Refactor FoodHistory to use extracted pieces

**Issue:** FOO-748
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify if exists)

**TDD Steps:**

1. **GREEN** — Replace the inline delete logic, entry detail dialog, favorite toggle, and share handler in `FoodHistory` with the extracted `useDeleteFoodEntry` hook and `FoodEntryDetailSheet` component. The favorite toggle and share handler remain in FoodHistory (they manage local state) but are passed as props to the sheet.
   - Run: `npm test -- food-history`
   - Verify: All existing tests pass with identical behavior.

2. **REFACTOR** — Remove the now-duplicated code from FoodHistory. The component should be noticeably shorter.

**Notes:**
- This is a pure refactoring task — no behavior changes. All existing tests must continue to pass.
- The `handleDeleteConfirm` callback should call `mutate()` and `invalidateFoodCaches()` (the onSuccess behavior).
- Keep the `deleteTargetId !== null` AlertDialog rendering in FoodHistory — it's simple UI that doesn't need extraction (or extract it as a `DeleteConfirmDialog` subcomponent if it aids reuse).

---

### Task 9: Extend MealEntry type and nutrition-summary query

**Issue:** FOO-749
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify if exists)

**TDD Steps:**

1. **RED** — Write/modify tests for the nutrition summary builder (`getNutritionSummary` or equivalent) to assert that `MealEntry` objects include `amount`, `unitId`, `isFavorite`, and `fitbitLogId` fields.
   - Run: `npm test -- food-log`
   - Verify: Tests fail — fields don't exist on MealEntry.

2. **GREEN** — Add the missing fields to the `MealEntry` interface: `amount: number`, `unitId: number`, `isFavorite: boolean`, `fitbitLogId: number | null`. Update the MealEntry construction in `src/lib/food-log.ts` (around line 975) to include these from `row.custom_foods` and `row.food_log_entries`.
   - Run: `npm test -- food-log`
   - Verify: Tests pass.

**Notes:**
- The query at this point already JOINs `custom_foods` and `food_log_entries`, so the data is available — it's just not being mapped to the output.
- `amount` and `unitId` come from `custom_foods`. `isFavorite` comes from `custom_foods.isFavorite`. `fitbitLogId` comes from `food_log_entries.fitbitLogId`.
- Check the actual column names in `src/db/schema.ts` to use the correct property names.
- Reference: `FoodLogHistoryEntry` (lines 212–233 in types) has all these fields — MealEntry should gain the same ones needed for FoodEntryCard and the detail sheet.

---

### Task 10: Update MealBreakdown and DailyDashboard with FoodEntryCard and interactions

**Issue:** FOO-749
**Files:**
- `src/components/meal-breakdown.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/meal-breakdown.test.tsx` (create or modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify if exists)

**TDD Steps:**

1. **RED** — Write tests for MealBreakdown:
   - Renders `FoodEntryCard` for each entry (not plain Link elements)
   - Calls `onEdit(entry)` when edit button clicked
   - Calls `onDelete(entry.id)` when delete button clicked
   - Calls `onEntryClick(entry)` when card body clicked
   - Does NOT pass `mealTypeId` to FoodEntryCard (entries already grouped)
   - Preserves collapsible structure
   - Run: `npm test -- meal-breakdown`

2. **GREEN** — Update MealBreakdown props to accept callbacks: `onEdit?: (entry: MealEntry) => void`, `onDelete?: (id: number) => void`, `onEntryClick?: (entry: MealEntry) => void`, `deletingId?: number | null`. Replace the `<Link>` elements with `<FoodEntryCard>` using `actions="edit-delete"`. Pass the new MealEntry fields (`amount`, `unitId`, `isFavorite`, etc.) to FoodEntryCard. Remove the `mealTypeId` prop from FoodEntryCard since entries are already grouped by meal type in folders.
   - Run: `npm test -- meal-breakdown`

3. **GREEN** — Update DailyDashboard to wire up the interactions:
   - Import and use `useDeleteFoodEntry` hook
   - Import and render `FoodEntryDetailSheet`
   - `onEdit`: `router.push(\`/app/edit/${entry.id}\`)`
   - `onDelete`: `handleDeleteRequest(id)` from the hook
   - `onEntryClick`: `setSelectedEntry(entry)` to open the detail sheet
   - Show delete errors above the MealBreakdown section
   - Render the DeleteConfirmDialog (AlertDialog)
   - Run: `npm test -- daily-dashboard`

4. **REFACTOR** — Ensure the delete flow invalidates the nutrition summary cache so the dashboard updates after deletion.

**Notes:**
- MealBreakdown should remain a presentational component — callbacks come from the parent (DailyDashboard).
- The `FoodEntryDetailSheet` needs a compatible entry type. Since `MealEntry` now has `customFoodId`, `isFavorite`, `amount`, `unitId`, `fitbitLogId`, it should be compatible with the sheet's props. The sheet may need to accept `MealEntry` directly or a shared base type.
- Reference: `FoodHistory` lines 340–365 for how FoodEntryCard is used with edit/delete actions.

---

### Phase 3: E2E Test Coverage (FOO-752–757)

---

### Task 11: Add E2E tests for Edit Food page

**Issue:** FOO-752
**Files:**
- `e2e/tests/edit-food.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create the spec file with tests:
   - Seed a food log entry via the DB fixture
   - Navigate to `/app/edit/{id}`
   - Assert the page loads with pre-populated entry data (food name visible, nutrition card)
   - Mock `/api/edit-chat` SSE endpoint (follow `refine-chat.spec.ts` patterns)
   - Screenshot: edit page loaded with entry data
   - Simulate a save flow and capture confirmation screenshot
   - Use `captureScreenshots()` for light+dark dual capture
   - Run: `npm run e2e -- --grep "edit-food"`

2. **GREEN** — Implement the test following existing patterns in `e2e/tests/refine-chat.spec.ts` for SSE mocking and `e2e/tests/food-detail.spec.ts` for entry seeding.

**Notes:**
- Reference: `e2e/fixtures/db.ts` for database seeding patterns, `e2e/fixtures/screenshots.ts` for `captureScreenshots()`, `e2e/fixtures/auth.ts` for authenticated page access.
- The edit page uses `FoodChat` in `mode="edit"` with `editEntry` prop — verify the page loads the entry data correctly.

---

### Task 12: Add E2E tests for Log Shared Food page

**Issue:** FOO-753
**Files:**
- `e2e/tests/log-shared.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create the spec file with tests:
   - Mock the share token API to return valid food data
   - Navigate to `/app/log-shared/{token}`
   - Assert NutritionFactsCard renders with correct data
   - Screenshot: shared food loaded with nutrition card
   - Test error state: mock invalid token → assert error message
   - Screenshot: error state
   - Use `captureScreenshots()` for light+dark dual capture
   - Run: `npm run e2e -- --grep "log-shared"`

2. **GREEN** — Implement following existing E2E patterns.

**Notes:**
- This is a public route — may not require the auth fixture.
- Check `src/app/app/log-shared/[token]/page.tsx` for the exact API endpoint being called.

---

### Task 13: Add E2E tests for photo capture flow

**Issue:** FOO-754
**Files:**
- `e2e/tests/analyze-photos.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create the spec file with tests:
   - Navigate to analyze page
   - Use Playwright's `fileChooser` API to simulate photo selection
   - Create small test PNG files in the fixtures directory
   - Assert photo thumbnails appear
   - Screenshot: thumbnails visible
   - Mock the analysis SSE to trigger the analyzing spinner
   - Screenshot: analyzing state with step text
   - Run: `npm run e2e -- --grep "analyze-photos"`

2. **GREEN** — Implement using Playwright's file input handling.

**Notes:**
- Playwright's `page.waitForEvent('filechooser')` + `fileChooser.setFiles()` can simulate gallery selection.
- Camera input may not be testable in headless mode — focus on gallery/file selection.
- Small test images (1x1 PNG) are sufficient for thumbnail rendering tests.

---

### Task 14: Add missing dialog and modal E2E screenshots

**Issue:** FOO-755
**Files:**
- `e2e/tests/history.spec.ts` (modify)
- `e2e/tests/quick-select.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests to `history.spec.ts`:
   - Click a history entry → assert detail bottom sheet opens
   - Screenshot: entry detail sheet with NutritionFactsCard
   - Click delete on an entry → assert confirmation dialog
   - Screenshot: delete confirmation dialog
   - Run: `npm run e2e -- --grep "history"`

2. **RED** — Add tests to `quick-select.spec.ts`:
   - Type in search bar → assert results appear
   - Screenshot: search results
   - Complete a log flow → assert confirmation screen
   - Screenshot: confirmation
   - Run: `npm run e2e -- --grep "quick-select"`

3. **GREEN** — Implement the screenshot captures using `captureScreenshots()`.

**Notes:**
- These extend existing spec files — add new `test()` blocks, don't modify existing ones.
- Entry detail sheet opens on clicking the entry card (not the edit/delete buttons).
- History delete confirmation uses AlertDialog.

---

### Task 15: Add missing empty state and guard E2E screenshots

**Issue:** FOO-756
**Files:**
- `e2e/tests/empty-states.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - Dashboard empty state: navigate to dashboard WITHOUT seeded food data → assert "No meals logged yet" text and CTA buttons
   - Screenshot: dashboard empty state
   - History true empty state: navigate to history WITHOUT seeded food data → assert empty state UI
   - Screenshot: history empty state
   - FitbitSetupGuard: mock Fitbit credentials as missing → navigate to analyze page → assert guard UI shown
   - Screenshot: FitbitSetupGuard
   - Run: `npm run e2e -- --grep "empty-states"`

2. **GREEN** — Implement the tests. The key challenge is creating test scenarios without seeded data (or with specific mock conditions for Fitbit).

**Notes:**
- Dashboard empty state renders at `daily-dashboard.tsx` lines 265–283: "No meals logged yet" with Scan Food and Quick Select links.
- FitbitSetupGuard may require mocking the Fitbit credentials API endpoint.
- May need a separate test setup that skips the default data seeding.

---

### Task 16: Add missing settings page state screenshots

**Issue:** FOO-757
**Files:**
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - Click "Create API Key" button → assert creation dialog/form appears
   - Screenshot: API key creation flow
   - Click delete on an API key → assert confirmation dialog
   - Screenshot: delete confirmation
   - Click edit on Fitbit Client ID → assert inline edit mode (text input visible)
   - Screenshot: Fitbit edit mode
   - Run: `npm run e2e -- --grep "settings"`

2. **GREEN** — Implement using existing settings test patterns and `captureScreenshots()`.

**Notes:**
- Settings tests already exist — extend with new test blocks for interactive states.
- API key manager component is in `src/components/settings/`.
- Use existing authenticated page fixture.

---

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `save_issue` | Move issues to "In Progress" when starting, "Done" when complete |
| Linear | `create_comment` | Add implementation notes to issues if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| `editing_entry_id` is invalid type | `validateFoodAnalysis` throws ClaudeApiError | Unit test (Task 1) |
| `editing_entry_id` is negative | `validateFoodAnalysis` throws ClaudeApiError | Unit test (Task 1) |
| Edit-food API fails during chat-initiated edit | Error shown in FoodChat, same as existing edit mode | Unit test (Task 2) |
| Entry not found during chat-initiated edit | `/api/edit-food` returns 404 | Existing API behavior |
| MealEntry missing new fields (backward compat) | Fields have sensible defaults in type | Unit test (Task 9) |

## Risks & Open Questions

- [ ] **Date handling for chat-initiated edits (Task 4):** When the user edits an entry via regular chat, the client doesn't have the entry's original date. Need to verify how `/api/edit-food` handles this — does it validate the date against the entry? If so, the client may need to fetch the entry's date first.
- [ ] **MealEntry type compatibility with FoodEntryDetailSheet (Task 10):** The detail sheet was designed for `FoodLogHistoryEntry`. After extending `MealEntry` with the needed fields, verify the types are compatible or create a shared base interface.
- [ ] **Photo capture E2E testing (Task 13):** Playwright's file chooser API works for file input but may not cover all PhotoCapture component states (camera mode, HEIC conversion). Coverage may be partial.

## Scope Boundaries

**In Scope:**
- Adding `editing_entry_id` to report_nutrition tool and FoodAnalysis type
- Updating CHAT_SYSTEM_PROMPT with edit vs create guidance
- Extracting reusable delete hook and detail sheet from FoodHistory
- Upgrading MealBreakdown to use FoodEntryCard with interactions
- Extending MealEntry type with missing fields
- Adding E2E test coverage for 6 gap areas

**Out of Scope:**
- Modifying the `/api/edit-food` or `/api/log-food` API routes (unless required for date handling)
- Adding new API endpoints
- Changing the dedicated edit page flow (`/app/edit/[id]`)
- Refactoring PhotoCapture component
- Service worker or offline support
- Performance optimizations

---

## Iteration 1

**Implemented:** 2026-03-01
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add editingEntryId to FoodAnalysis type and report_nutrition tool schema (worker-1)
- Task 2: Update FoodChat to handle editingEntryId from regular chat (worker-1)
- Task 3: Update CHAT_SYSTEM_PROMPT with edit vs create instructions (worker-1)
- Task 4: Handle date resolution for chat-initiated edits (worker-1)
- Task 6: Extract useDeleteFoodEntry hook (worker-2)
- Task 7: Extract FoodEntryDetailSheet component (worker-2)
- Task 8: Refactor FoodHistory to use extracted pieces (worker-2)
- Task 9: Extend MealEntry type and nutrition-summary query (worker-2)
- Task 10: Update MealBreakdown and DailyDashboard with FoodEntryCard and interactions (worker-2)
- Task 11: Add E2E tests for Edit Food page (worker-3)
- Task 12: Add E2E tests for Log Shared Food page (worker-3)
- Task 13: Add E2E tests for photo capture flow (worker-3)
- Task 14: Add missing dialog and modal E2E screenshots (worker-3)
- Task 15: Add missing empty state and guard E2E screenshots (worker-3)
- Task 16: Add missing settings page state screenshots (worker-3)

### Files Modified
- `src/types/index.ts` — Added editingEntryId to FoodAnalysis, extended MealEntry with amount/unitId/isFavorite/fitbitLogId
- `src/lib/claude.ts` — editing_entry_id tool schema, validateFoodAnalysis logic, CHAT_SYSTEM_PROMPT update
- `src/components/food-chat.tsx` — isEditingExisting derived state, handleSaveExisting handler
- `src/lib/__tests__/claude.test.ts` — 7 new tests for editingEntryId validation and prompt
- `src/components/__tests__/food-chat.test.tsx` — 3 new tests for editingEntryId button behavior
- `src/hooks/use-delete-food-entry.ts` — New hook with useCallback/useRef for stale-closure safety
- `src/hooks/__tests__/use-delete-food-entry.test.ts` — 10 tests for delete hook
- `src/components/food-entry-detail-sheet.tsx` — New extracted component
- `src/components/__tests__/food-entry-detail-sheet.test.tsx` — Tests for detail sheet
- `src/components/food-history.tsx` — Refactored to use extracted hook and sheet
- `src/lib/food-log.ts` — Updated MealEntry construction with new fields
- `src/lib/__tests__/food-log.test.ts` — Tests for new MealEntry fields
- `src/components/meal-breakdown.tsx` — Replaced Link with FoodEntryCard
- `src/components/__tests__/meal-breakdown.test.tsx` — Tests for new MealBreakdown interactions
- `src/components/daily-dashboard.tsx` — Wired up entry interactions, delete, detail sheet
- `src/components/__tests__/daily-dashboard.test.tsx` — Tests for dashboard interactions
- `e2e/tests/edit-food.spec.ts` — New: 4 tests for edit page
- `e2e/tests/log-shared.spec.ts` — New: 4 tests for log-shared page
- `e2e/tests/analyze-photos.spec.ts` — New: 5 tests for photo capture flow
- `e2e/tests/history.spec.ts` — Extended: 2 tests for detail sheet and delete dialog
- `e2e/tests/quick-select.spec.ts` — Extended: 2 tests for search results and confirmation
- `e2e/tests/empty-states.spec.ts` — Extended: 4 tests for empty states and guards
- `e2e/tests/settings.spec.ts` — Extended: 3 tests for API key and Fitbit edit flows

### Linear Updates
- FOO-750: Todo → In Progress → Review
- FOO-751: Todo → In Progress → Review
- FOO-748: Todo → In Progress → Review
- FOO-749: Todo → In Progress → Review
- FOO-752: Todo → In Progress → Review
- FOO-753: Todo → In Progress → Review
- FOO-754: Todo → In Progress → Review
- FOO-755: Todo → In Progress → Review
- FOO-756: Todo → In Progress → Review
- FOO-757: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (2 HIGH, 2 MEDIUM), all fixed before commit
  - HIGH: editingEntryId leaking into /api/edit-food body — fixed with undefined spread
  - HIGH: Stale closure in handleDeleteConfirm — fixed with useCallback + useRef
  - MEDIUM: null vs undefined micro-nutrients in dashboard entry click — fixed with ?? undefined normalization
  - MEDIUM: deleteError persisting across date changes — fixed with clearError + useEffect
- verifier: All 2453 tests pass, zero lint warnings, build clean

### Work Partition
- Worker 1: Tasks 1–4 (Chat Edit — types, claude.ts, food-chat.tsx)
- Worker 2: Tasks 6–10 (Dashboard — hooks, components, food-log.ts)
- Worker 3: Tasks 11–16 (E2E Tests — spec files)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: auto-merge, 1 file auto-resolved (src/types/index.ts)
- Worker 3: auto-merge (no conflicts)

### Continuation Status
All tasks completed.
