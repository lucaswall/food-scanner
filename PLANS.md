# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-731-sentry-and-edit-fixes
**Issues:** FOO-731, FOO-732, FOO-733, FOO-734, FOO-735, FOO-736, FOO-737, FOO-738, FOO-740, FOO-741, FOO-742, FOO-743, FOO-744, FOO-745, FOO-746, FOO-747
**Created:** 2026-03-01
**Last Updated:** 2026-03-01

## Summary

Fix critical bugs (runToolLoop crash, edit context loss), harden Sentry observability (error reporting, PII stripping, user context), improve edit mode prompts, and consolidate duplicated chat functions. 16 issues across two domains: Sentry configuration and edit-mode chat.

## Issues

### FOO-738: runToolLoop crashes when Claude calls report_nutrition multiple times

**Priority:** High
**Labels:** Bug
**Description:** When Claude returns multiple `report_nutrition` tool_use blocks in one response, `runToolLoop` only creates a `tool_result` for the first one. The second `tool_use` ID has no matching `tool_result`, causing a 400 error from the Anthropic API.

**Acceptance Criteria:**
- [ ] All `report_nutrition` tool_use blocks get synthetic `tool_result` responses
- [ ] Analysis is captured from the first `report_nutrition` block
- [ ] No API errors when Claude duplicates `report_nutrition`

### FOO-731: editAnalysis loses analysis context after first refinement

**Priority:** High
**Labels:** Bug
**Description:** In edit mode, multi-turn conversations lose track of current analysis values. Claude always sees the ORIGINAL entry values in the system prompt and never receives updated analysis. Three compounding issues: (1) no `[Current values: ...]` injection in assistant messages, (2) edit-chat route doesn't extract/pass `initialAnalysis`, (3) `editAnalysis` doesn't accept `initialAnalysis` parameter.

**Acceptance Criteria:**
- [ ] `editAnalysis` injects `[Current values: ...]` summaries into assistant messages with analysis
- [ ] edit-chat route extracts and validates `initialAnalysis` from request body
- [ ] `editAnalysis` accepts and uses `initialAnalysis` for system prompt context
- [ ] Multi-turn edit chat preserves analysis context across turns

### FOO-732: Edit mode system prompt missing Tier 1 nutrients

**Priority:** Medium
**Labels:** Bug
**Description:** The `editAnalysis` system prompt only includes basic nutrients from the original entry, omitting Tier 1 nutrients (saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat). Claude has to re-estimate these instead of preserving them.

**Acceptance Criteria:**
- [ ] Edit system prompt includes Tier 1 nutrients when present on the entry
- [ ] Matches the pattern used in `conversationalRefine`'s analysis summary

### FOO-737: REPORT_NUTRITION_UI_CARD_NOTE says "Log to Fitbit" in edit mode

**Priority:** Medium
**Labels:** Bug
**Description:** The `REPORT_NUTRITION_UI_CARD_NOTE` constant tells Claude the button says "Log to Fitbit", but in edit mode the actual button says "Save Changes". Claude instructs users to tap the wrong button.

**Acceptance Criteria:**
- [ ] Edit system prompt tells Claude the button says "Save Changes"
- [ ] Analyze/chat system prompt still says "Log to Fitbit"

### FOO-736: EDIT_SYSTEM_PROMPT doesn't guide Claude on available data tools

**Priority:** Low
**Labels:** Improvement
**Description:** `EDIT_SYSTEM_PROMPT` makes data tools available but doesn't mention them. Claude might not use them effectively during edits.

**Acceptance Criteria:**
- [ ] Edit system prompt briefly mentions data tools and when to use them

### FOO-742: API route errors not reported as Sentry Issues

**Priority:** High
**Labels:** Bug
**Description:** All API route handlers catch errors and return `errorResponse()`, so `onRequestError` never fires. The pino integration only forwards to Sentry Logs (structured logging), not to the Issues dashboard. Adding `error: { levels: [...] }` to the pino integration config bridges this gap.

**Acceptance Criteria:**
- [ ] `error: { levels: ["error", "fatal"] }` added to pino integration
- [ ] `logger.error()` calls create Sentry Issues (not just Sentry Logs)

### FOO-745: sendDefaultPii sends session cookies to Sentry

**Priority:** Medium
**Labels:** Security
**Description:** `sendDefaultPii: true` sends request headers (including iron-session cookies) to Sentry. CLAUDE.md states "Never log: Cookie values."

**Acceptance Criteria:**
- [ ] Session cookies no longer sent to Sentry
- [ ] `sendDefaultPii` removed or cookies stripped via `beforeSendTransaction`/`beforeSend`

### FOO-746: AI monitoring sends full prompts and base64 food images to Sentry

**Priority:** High
**Labels:** Security
**Description:** `sendDefaultPii: true` causes AI monitoring to default `recordInputs: true` and `recordOutputs: true`, sending full prompts (with megabytes of base64 images) and outputs to Sentry.

**Acceptance Criteria:**
- [ ] AI monitoring no longer sends full prompt text or base64 image data
- [ ] Token counts, latency, model info, and error status still captured

### FOO-747: Double Anthropic instrumentation

**Priority:** Medium
**Labels:** Bug
**Description:** Both `anthropicAIIntegration()` (module-level) and `instrumentAnthropicAiClient()` (instance wrapper) are active simultaneously. Sentry docs recommend only the manual wrapper for Next.js meta-frameworks.

**Acceptance Criteria:**
- [ ] Only `instrumentAnthropicAiClient()` is used (remove `anthropicAIIntegration()` from integrations)
- [ ] AI monitoring still works correctly

### FOO-744: No Sentry user context set

**Priority:** Medium
**Labels:** Improvement
**Description:** `Sentry.setUser()` is never called. All events lack user identification, making it harder to correlate errors with sessions.

**Acceptance Criteria:**
- [ ] Server-side events include user context (id, email)
- [ ] Client-side events include user context

### FOO-743: Client-side caught errors not reported to Sentry

**Priority:** Medium
**Labels:** Bug
**Description:** Client components catch errors and display them via `setError()` or `console.error()`, but never call `Sentry.captureException()`. Client-side errors are invisible in Sentry.

**Acceptance Criteria:**
- [ ] `food-analyzer.tsx` error handlers call `Sentry.captureException()`
- [ ] `food-chat.tsx` error handlers call `Sentry.captureException()`
- [ ] `food-history.tsx` delete error calls `Sentry.captureException()`
- [ ] Trivial errors (clipboard) are excluded

### FOO-733: handleSave missing FITBIT_TOKEN_INVALID and credentials error handling

**Priority:** Medium
**Labels:** Bug
**Description:** `handleSave` (edit mode) doesn't handle `FITBIT_TOKEN_INVALID` or `FITBIT_CREDENTIALS_MISSING` error codes. Users get a generic error and lose changes, instead of being redirected to re-authenticate.

**Acceptance Criteria:**
- [ ] `handleSave` handles `FITBIT_TOKEN_INVALID` like `handleLog` does (save pending + redirect)
- [ ] `handleSave` handles `FITBIT_CREDENTIALS_MISSING` / `FITBIT_NOT_CONNECTED` with specific error message

### FOO-735: Missing reader.cancel() in food-analyzer SSE stream cleanup

**Priority:** Low
**Labels:** Bug
**Description:** `food-analyzer.tsx` calls `reader.releaseLock()` without `reader.cancel()` first, leaving the fetch connection open unnecessarily.

**Acceptance Criteria:**
- [ ] `reader.cancel()` called before `reader.releaseLock()` (matching `food-chat.tsx` pattern)

### FOO-734: Chat input maxLength (500) unnecessarily restricts message length

**Priority:** Low
**Labels:** Improvement
**Description:** Client-side `maxLength={500}` while server accepts 2000 characters. Prevents valid long descriptions.

**Acceptance Criteria:**
- [ ] Client maxLength matches server limit (2000)

### FOO-741: Skip food re-creation when editing only meal type or time

**Priority:** Medium
**Labels:** Improvement
**Description:** When editing and only changing meal type or time (no nutrition changes), the edit-food route still runs the full delete → create food → log cycle. This is unnecessary when nutrition data hasn't changed.

**Acceptance Criteria:**
- [ ] Metadata-only edits (meal type, time) skip Fitbit food creation
- [ ] Fast path: delete old log → re-log using existing fitbitFoodId → update DB metadata
- [ ] Compensation logic for fast path
- [ ] Handles dry-run mode (fitbitFoodId null)

### FOO-740: Unify chat functions: consolidate conversationalRefine and editAnalysis

**Priority:** Medium
**Labels:** Technical Debt
**Description:** `conversationalRefine` (~270 lines) and `editAnalysis` (~80 lines) duplicate message conversion, system prompt construction, and tool loop delegation. Two API routes (`chat-food`, `edit-chat`) have copy-pasted message validation (~60 lines each). This duplication caused FOO-731.

**Acceptance Criteria:**
- [ ] Shared `convertMessages()` helper with analysis injection
- [ ] Shared message validation extracted from routes
- [ ] `conversationalRefine` and `editAnalysis` are thin wrappers over shared core
- [ ] Exported function signatures preserved (no call-site changes)
- [ ] All existing tests pass

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Dependencies installed (`npm install`)
- [ ] Environment variables configured (`.env.local`)

## Implementation Tasks

### Task 1: Fix runToolLoop multiple report_nutrition crash

**Issue:** FOO-738
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write failing test:
   - Add test case in claude.test.ts for `runToolLoop` behavior when Claude returns multiple `report_nutrition` tool_use blocks in one response
   - Test that ALL report_nutrition blocks get `tool_result` responses (not just the first)
   - Test that analysis is captured from the first block
   - Run: `npm test -- claude`
   - Verify: Test fails (current code only creates one tool_result)

2. **GREEN** — Make it pass:
   - In `runToolLoop` around line 860-917: change `.find()` to `.filter()` to capture ALL `report_nutrition` blocks
   - Keep using the first block's input for `pendingAnalysis` (validated via `validateFoodAnalysis`)
   - In the tool results section, loop over all report_nutrition blocks to create a `tool_result` for each one
   - Pattern: `const reportNutritionBlocks = allToolUseBlocks.filter(b => b.name === "report_nutrition")`
   - Then: `for (const block of reportNutritionBlocks) { toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "Nutrition analysis recorded." }) }`
   - Update `dataToolBlocks` filter to exclude ALL report_nutrition blocks (already correct — `.filter(b => b.name !== "report_nutrition")`)
   - Run: `npm test -- claude`

3. **REFACTOR** — Clean up variable naming (`reportNutritionBlock` → `reportNutritionBlocks`, update conditional from `if (reportNutritionBlock)` to `if (reportNutritionBlocks.length > 0)`)

### Task 2: Fix editAnalysis context loss in multi-turn edit chat

**Issue:** FOO-731
**Files:**
- `src/lib/claude.ts` (modify — `editAnalysis` function)
- `src/app/api/edit-chat/route.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write failing test:
   - Test that `editAnalysis` injects `[Current values: ...]` summaries into assistant messages that have `analysis` data (matching `conversationalRefine` behavior at line 1328-1342)
   - Test that `editAnalysis` accepts an optional `initialAnalysis` parameter and uses it to augment the system prompt
   - Run: `npm test -- claude`

2. **GREEN** — Make it pass:
   - In `editAnalysis` message conversion (line 1593-1614): add the same `[Current values: ...]` injection logic from `conversationalRefine` (lines 1328-1342) — append structured analysis summary for assistant messages with `msg.analysis`
   - Add `initialAnalysis?: FoodAnalysis` parameter to `editAnalysis` function signature (after `entry`)
   - When `initialAnalysis` is provided, use its values instead of `entry` values in the system prompt context section (lines 1621-1628). Fall back to `entry` when `initialAnalysis` is not provided
   - In `edit-chat/route.ts`: extract `data.initialAnalysis` from request body, validate with the same pattern used in `chat-food/route.ts` (lines 107+), pass to `editAnalysis`
   - Run: `npm test -- claude`

3. **REFACTOR** — Ensure the analysis injection logic references the same fields as the existing pattern in `conversationalRefine`

### Task 3: Fix edit mode system prompt issues

**Issues:** FOO-732, FOO-737, FOO-736
**Files:**
- `src/lib/claude.ts` (modify — `EDIT_SYSTEM_PROMPT`, `REPORT_NUTRITION_UI_CARD_NOTE`, `editAnalysis`)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write failing tests:
   - Test that the edit system prompt entry context includes Tier 1 nutrients (saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat) when present on the entry
   - Test that the edit system prompt tells Claude the button says "Save Changes" (not "Log to Fitbit")
   - Test that the edit system prompt mentions data tools (search_food_log, get_nutrition_summary, get_fasting_info)
   - Run: `npm test -- claude`

2. **GREEN** — Make it pass:
   - **FOO-732:** In `editAnalysis` system prompt construction (lines 1621-1628), add Tier 1 nutrients conditionally: `if (entry.saturatedFatG != null) systemPrompt += ...; if (entry.transFatG != null) ...` etc. Check that `FoodLogEntryDetail` type has these fields (it should from custom_foods join)
   - **FOO-737:** Make the UI card note dynamic. Either: (a) parameterize `REPORT_NUTRITION_UI_CARD_NOTE` as a function that accepts button label, or (b) create a separate `EDIT_REPORT_NUTRITION_UI_CARD_NOTE` constant that says "Save Changes". Use the correct version in `EDIT_SYSTEM_PROMPT` vs `CHAT_SYSTEM_PROMPT`
   - **FOO-736:** Add a brief paragraph to `EDIT_SYSTEM_PROMPT` mentioning data tools: "You also have access to data tools (search_food_log, get_nutrition_summary, get_fasting_info) to look up the user's food history and nutrition context when helpful for making corrections."
   - Run: `npm test -- claude`

3. **REFACTOR** — Ensure prompt construction is clean and consistent

**Notes:**
- Check `FoodLogEntryDetail` in `src/types/index.ts` to confirm Tier 1 nutrient fields exist. If missing, add them to the type and the query in `src/lib/food-log.ts`

### Task 4: Enable pino error reporting to Sentry Issues

**Issue:** FOO-742
**Files:**
- `src/instrumentation.ts` (modify)
- `src/lib/__tests__/instrumentation.test.ts` (create if needed, or verify manually)

**TDD Steps:**

1. **RED** — Write a test verifying the pino integration config includes both `log` and `error` options. Since `src/instrumentation.ts` calls `Sentry.init()` at module level, the test may need to mock `@sentry/nextjs` and verify the integration config. Alternatively, this is a one-line config change that can be verified by reading the file.

2. **GREEN** — In `src/instrumentation.ts` line 18-19, change:
   ```
   Sentry.pinoIntegration({
     log: { levels: ["warn", "error", "fatal"] },
   }),
   ```
   to include `error` option:
   ```
   Sentry.pinoIntegration({
     log: { levels: ["warn", "error", "fatal"] },
     error: { levels: ["error", "fatal"] },
   }),
   ```
   - Run: `npm test` (full suite to ensure no regressions)

3. **REFACTOR** — None needed, this is a config-only change

**Notes:**
- This single change automatically creates Sentry Issues from every `logger.error()` and `logger.fatal()` call in the codebase, including the SSE error handler in `sse.ts` (previously FOO-739)
- `warn` level is intentionally excluded from `error` — warnings create Sentry Logs entries but not Issues

### Task 5: Fix Sentry PII exposure and double instrumentation

**Issues:** FOO-745, FOO-746, FOO-747
**Files:**
- `src/instrumentation.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests verifying:
   - `sendDefaultPii` is not `true` in the Sentry init config
   - `anthropicAIIntegration()` is NOT in the integrations array
   - Only `instrumentAnthropicAiClient()` is used for AI monitoring (already in `claude.ts:23`)

2. **GREEN** — In `src/instrumentation.ts`:
   - **FOO-745 + FOO-746:** Remove `sendDefaultPii: true` (line 15). This stops cookies being sent AND stops AI monitoring from defaulting `recordInputs`/`recordOutputs` to `true`. The Anthropic instrumentation will still capture token counts, latency, model info, and error status without PII
   - **FOO-747:** Remove `Sentry.anthropicAIIntegration()` from the integrations array (line 21). The manual `Sentry.instrumentAnthropicAiClient(client)` in `claude.ts:23` is the correct approach for Next.js
   - Run: `npm test` and `npm run build`

3. **REFACTOR** — Verify the integrations array is clean and well-documented

**Notes:**
- After removing `sendDefaultPii`, user IP and user-agent headers will no longer be automatically included in events. This is acceptable — FOO-744 adds explicit user context via `Sentry.setUser()` which is more useful
- If fine-grained PII control is needed later, use `beforeSend` / `beforeSendTransaction` hooks to strip specific headers

### Task 6: Add Sentry user context

**Issue:** FOO-744
**Files:**
- `src/components/sentry-user-context.tsx` (create — client component)
- `src/app/app/layout.tsx` (modify — add SentryUserContext component)
- `src/lib/__tests__/sentry-user-context.test.ts` (create)

**TDD Steps:**

1. **RED** — Write test for a `SentryUserContext` client component that calls `Sentry.setUser()` on mount with user info and `Sentry.setUser(null)` on unmount

2. **GREEN** — Create a `'use client'` component `SentryUserContext` that:
   - Accepts `userId` and `email` props
   - Calls `Sentry.setUser({ id: userId, email })` in a `useEffect` on mount
   - Calls `Sentry.setUser(null)` in the cleanup function
   - Renders `null` (no visual output)
   - Add this component to `src/app/app/layout.tsx` (the protected app layout), passing the user data from the session. The layout is a Server Component that can read the session and pass props to the client component
   - For server-side context: in API route handlers, the existing `logger.error()` calls include request context. With FOO-742's pino-to-Sentry bridge, errors already carry request metadata. Explicit server-side `setUser()` is not needed at this stage — the client component covers all user-facing Sentry events
   - Run: `npm test -- sentry-user-context`

3. **REFACTOR** — Ensure the component follows existing patterns (see `src/components/app-refresh-guard.tsx` for a similar "invisible client component" pattern)

### Task 7: Add client-side Sentry error reporting

**Issue:** FOO-743
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/food-chat.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write failing tests:
   - Mock `@sentry/nextjs` with `vi.mock()`
   - Test that when `food-analyzer.tsx` catches an error during analysis, `Sentry.captureException()` is called with the error
   - Test that when `food-chat.tsx` catches an error during send/log/save, `Sentry.captureException()` is called
   - Test that `food-history.tsx` delete errors call `Sentry.captureException()`
   - Test that AbortError and TimeoutError do NOT call `captureException()` (these are expected)
   - Run: `npm test -- food-analyzer food-chat food-history`

2. **GREEN** — Add `import * as Sentry from "@sentry/nextjs"` to each component and add `Sentry.captureException(err)` in error catch blocks:
   - `food-analyzer.tsx`: in the catch block (~line 291-308), after `setError()`, call `Sentry.captureException(err)` — but skip for AbortError and TimeoutError
   - `food-chat.tsx`: in `handleSend` catch (~line 471+), `handleLog` catch (~line 563+), `handleSave` catch (~line 620+) — same pattern, skip AbortError/TimeoutError
   - `food-history.tsx`: in the delete error handler, call `Sentry.captureException(err)` — skip for clipboard errors
   - Run: `npm test -- food-analyzer food-chat food-history`

3. **REFACTOR** — Consider extracting a small helper `reportError(err)` that checks for abort/timeout before calling `captureException`, to avoid duplicating the guard logic. Only if it's used in 3+ places in the same file.

### Task 8: Add handleSave Fitbit error handling

**Issue:** FOO-733
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write failing test:
   - Test that `handleSave` handles `FITBIT_TOKEN_INVALID` error code by saving pending submission and redirecting to Fitbit auth (matching `handleLog` behavior)
   - Test that `handleSave` handles `FITBIT_CREDENTIALS_MISSING` / `FITBIT_NOT_CONNECTED` with a specific error message
   - Run: `npm test -- food-chat`

2. **GREEN** — In `handleSave` function (lines 576-629), after the `if (!response.ok || !result.success || !result.data)` check:
   - Add the same `FITBIT_TOKEN_INVALID` handling from `handleLog` (lines 540-549): save pending submission with edit-specific data, redirect to `/api/auth/fitbit`
   - Add the same `FITBIT_CREDENTIALS_MISSING` / `FITBIT_NOT_CONNECTED` handling from `handleLog` (lines 553-556)
   - Keep the generic error fallback for other error codes
   - Run: `npm test -- food-chat`

3. **REFACTOR** — The pending submission for edit should include `editEntry.id` so the app can resume the edit after re-auth. Check if `savePendingSubmission` supports this.

**Notes:**
- Depends on understanding `savePendingSubmission` format in `src/components/pending-submission-handler.tsx`

### Task 9: Fix reader.cancel() in food-analyzer

**Issue:** FOO-735
**Files:**
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **GREEN** — In `food-analyzer.tsx` line 288-289, change:
   ```
   } finally {
     reader.releaseLock();
   }
   ```
   to match the `food-chat.tsx` pattern (lines 448-449):
   ```
   } finally {
     await reader.cancel().catch(() => {});
     reader.releaseLock();
   }
   ```
   - Run: `npm test -- food-analyzer`

**Notes:**
- This is a one-line fix with no test needed — the pattern is already proven in `food-chat.tsx`

### Task 10: Fix chat input maxLength

**Issue:** FOO-734
**Files:**
- `src/components/food-chat.tsx` (modify)

**TDD Steps:**

1. **GREEN** — In `food-chat.tsx` line 909, change `maxLength={500}` to `maxLength={2000}` to match the server-side validation limit in both `chat-food/route.ts:68` and `edit-chat/route.ts:73`
   - Run: `npm test -- food-chat`

**Notes:**
- One-line change. Existing tests should be updated if they assert on maxLength value.

### Task 11: Optimize edit-food route for metadata-only edits

**Issue:** FOO-741
**Files:**
- `src/app/api/edit-food/route.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/types/index.ts` (modify — `FoodLogEntryDetail`)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/__tests__/edit-food.test.ts` (modify or create)

**TDD Steps:**

1. **RED** — Write failing tests:
   - Test `isNutritionUnchanged(analysis, entry)` helper: returns `true` when all nutrition fields match, `false` when any differ
   - Test `updateFoodLogEntryMetadata(entryId, { mealTypeId, time, fitbitLogId })` — updates only metadata columns without creating new custom_foods record
   - Test the fast path in edit-food route: when nutrition is unchanged, it should NOT call `findOrCreateFood` — only delete old log, re-log with existing foodId, update metadata
   - Run: `npm test -- edit-food food-log`

2. **GREEN** — Implement:
   - **Types:** Add `fitbitFoodId: number | null` to `FoodLogEntryDetail` in `src/types/index.ts`
   - **Query:** In `src/lib/food-log.ts`, update `getFoodLogEntryDetail()` to include `fitbitFoodId` from the `custom_foods` join (it's already in the joined row, just not selected)
   - **Helper:** Add `isNutritionUnchanged(analysis, entry)` in `edit-food/route.ts` — compare food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat
   - **DB:** Add `updateFoodLogEntryMetadata(entryId, updates)` to `food-log.ts` — updates mealTypeId, time, fitbitLogId on `food_log_entries` without touching `custom_foods`
   - **Fast path:** In edit-food route, before the full delete/create cycle: if `isNutritionUnchanged()` and entry has `fitbitFoodId`: delete old Fitbit log → `logFood` with existing `fitbitFoodId` → `updateFoodLogEntryMetadata` → return success. Skip `findOrCreateFood` and new custom_foods creation
   - **Compensation:** Fast path compensation is simpler — re-log with same `fitbitFoodId` (no new food was created)
   - **Dry-run:** When `fitbitFoodId` is null (dry-run entries), skip Fitbit ops but still update DB metadata
   - Run: `npm test -- edit-food food-log`

3. **REFACTOR** — Ensure both paths (fast and full) return the same response shape

**Migration note:** Adds `fitbitFoodId` to `FoodLogEntryDetail` type. No schema change — field already exists in `custom_foods` table, just not exposed in the query result type.

### Task 12: Unify chat functions

**Issue:** FOO-740
**Files:**
- `src/lib/claude.ts` (modify — major refactor)
- `src/lib/message-validation.ts` (create)
- `src/app/api/chat-food/route.ts` (modify)
- `src/app/api/edit-chat/route.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/message-validation.test.ts` (create)

**TDD Steps:**

1. **RED** — Write failing tests:
   - Test `convertMessages()` helper: converts `ConversationMessage[]` to `Anthropic.MessageParam[]` with image support and analysis injection
   - Test `convertMessages()` with `initialAnalysis` parameter — augments system prompt context
   - Test shared `validateChatMessages()` in message-validation.ts — validates message array, role, content length, images
   - Run: `npm test -- claude message-validation`

2. **GREEN** — Implement step by step:
   - **Extract `convertMessages()`:** Pull the message conversion logic from `conversationalRefine` (lines 1302-1348) into a standalone function. It already handles analysis injection — this becomes the single source of truth
   - **Extract `validateChatMessages()`:** Pull the shared message validation logic from `chat-food/route.ts` (lines 41-103) and `edit-chat/route.ts` (lines 47-108) into `src/lib/message-validation.ts`. Return either `null` (valid) or an error `Response`
   - **Rewrite `editAnalysis`:** Replace its inline message conversion (lines 1593-1614) with a call to `convertMessages()`. The analysis injection (previously missing — fixed in Task 2) now comes for free from the shared function
   - **Simplify `conversationalRefine`:** Replace its inline message conversion with `convertMessages()`. The function should focus on building the system prompt and calling `runToolLoop`
   - **Update routes:** Replace copy-pasted validation in both routes with `validateChatMessages()` call
   - **Preserve signatures:** Both `conversationalRefine` and `editAnalysis` keep their existing exported signatures — no call-site changes needed
   - Run: `npm test -- claude message-validation`

3. **REFACTOR** — Ensure `conversationalRefine`'s initial streaming call (lines 1388-1535) is reviewed. Currently it duplicates `runToolLoop`'s initial API call logic with streaming. Consider whether this can also be consolidated, but only if it doesn't increase complexity. If the streaming-first approach serves a different purpose (streaming text deltas immediately vs. buffering), keep it separate but document why.

**Notes:**
- This task comes LAST because it refactors code touched by Tasks 1, 2, and 3. All bug fixes should be in place before the refactor
- The refactor should incorporate all fixes (analysis injection, Tier 1 nutrients, correct button name) into the shared functions
- Reference: `analyzeFood` remains separate (different input format: FormData with images)
- ~345 lines of duplication removed

### Task 13: Integration & Verification

**Issues:** All
**Files:** Various

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Multi-turn edit chat preserves analysis context across corrections
   - [ ] Edit mode prompt shows correct button name ("Save Changes")
   - [ ] Sentry dashboard receives Issues from `logger.error()` calls
   - [ ] No session cookies visible in Sentry event data
   - [ ] AI monitoring shows token counts but NOT prompt text or images
   - [ ] Client errors (simulate network failure) appear in Sentry
   - [ ] Metadata-only edits (change meal type) are faster than full edits
6. E2E tests: `npm run e2e`

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude sends multiple report_nutrition blocks | All get tool_results, first is used for analysis | Unit test (Task 1) |
| Multi-turn edit chat (3+ turns) | Analysis context preserved from previous corrections | Unit test (Task 2) |
| Fitbit token expires during edit save | Save pending + redirect to re-auth | Unit test (Task 8) |
| SSE error during streaming | logger.error() → Sentry Issue (via pino bridge) | Config change (Task 4) |
| Client-side fetch failure | Error shown to user + Sentry.captureException() | Unit test (Task 7) |
| Metadata-only edit in dry-run mode | Skip Fitbit ops, update DB only | Unit test (Task 11) |

## Risks & Open Questions

- [ ] **FOO-744 server-side user context:** The plan relies on client-side `Sentry.setUser()` only. If server-side user identification is needed in Sentry events, a middleware-based approach (calling `Sentry.setUser()` per request) would be more comprehensive. Start with client-side; add server-side if Sentry events lack user info.
- [ ] **FOO-740 streaming refactor:** `conversationalRefine` has a streaming-first initial call that differs from `runToolLoop`. The refactor should assess whether this can be unified without breaking the streaming UX. If not, document the divergence.
- [ ] **FOO-741 compensation edge cases:** The fast path compensation (re-log with same foodId) assumes the Fitbit food definition still exists. If Fitbit deletes old food definitions, the fast path compensation could fail — fall back to full compensation in that case.

## Scope Boundaries

**In Scope:**
- Fix all 16 valid issues listed above
- TDD for all non-trivial changes
- Maintain all existing tests

**Out of Scope:**
- FOO-739 (SSE Sentry reporting) — Canceled, subsumed by FOO-742
- Service worker or offline support
- Sentry session replay configuration changes
- Client-side Sentry `sendDefaultPii` changes (client init at `instrumentation-client.ts` doesn't have `sendDefaultPii`)
- Production data migration — no schema changes in this plan
