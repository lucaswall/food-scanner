# Implementation Plan

**Created:** 2026-03-04
**Source:** Backlog: FOO-781, FOO-782, FOO-783, FOO-784, FOO-785, FOO-786, FOO-787
**Linear Issues:** [FOO-781](https://linear.app/lw-claude/issue/FOO-781/truncateconversation-silently-skips-truncation-for-short-conversations), [FOO-782](https://linear.app/lw-claude/issue/FOO-782/stop-reason-model-context-window-exceeded-not-handled-in-claude-api), [FOO-783](https://linear.app/lw-claude/issue/FOO-783/edit-food-route-casts-to-foodanalysis-with-incomplete-keywords), [FOO-784](https://linear.app/lw-claude/issue/FOO-784/tool-definitions-in-chat-toolsts-and-luments-missing-strict-true), [FOO-785](https://linear.app/lw-claude/issue/FOO-785/orphaned-custom-foods-rows-on-food-log-insert-failure), [FOO-786](https://linear.app/lw-claude/issue/FOO-786/missing-action-field-on-11-log-statements-in-claudets), [FOO-787](https://linear.app/lw-claude/issue/FOO-787/data-tool-result-logged-in-full-risking-log-overflow-on-large-queries)
**Branch:** fix/backlog-claude-api-hardening

## Context Gathered

### Codebase Analysis

- **Related files:**
  - `src/lib/claude.ts` — Claude API client, `runToolLoop`, `analyzeFood`, `conversationalRefine`, `editAnalysis`, `truncateConversation`, `validateFoodAnalysis`, `REPORT_NUTRITION_TOOL`
  - `src/lib/chat-tools.ts` — Data tool definitions (`SEARCH_FOOD_LOG_TOOL`, `GET_NUTRITION_SUMMARY_TOOL`, `GET_FASTING_INFO_TOOL`), `executeTool`
  - `src/lib/lumen.ts` — `REPORT_LUMEN_GOALS_TOOL` definition
  - `src/lib/food-log.ts` — `insertCustomFood`, `insertFoodLogEntry`, existing transaction usage at lines 623/654
  - `src/app/api/edit-food/route.ts` — `isValidFoodAnalysis`, cast to `FoodAnalysis`
  - `src/app/api/log-food/route.ts` — Two-step DB write flow (lines 338-384)
  - `src/types/index.ts` — `FoodAnalysis` interface (`keywords: string[]` is required at line 72)
- **Existing patterns:**
  - `REPORT_NUTRITION_TOOL` has `strict: true` and `additionalProperties: false` — the reference pattern for tool definitions
  - `food-log.ts` already uses `db.transaction()` at lines 623 and 654 — pattern exists for wrapping writes
  - `validateFoodAnalysis` in `claude.ts:372` validates `keywords` as required array of strings
  - Log statements with `action` field: `{ action: "tool_loop_completed", ... }` — the convention to follow
- **Test conventions:**
  - `src/lib/__tests__/claude.test.ts` — Claude API unit tests
  - `src/lib/__tests__/chat-tools.test.ts` — Chat tools unit tests
  - `src/lib/__tests__/food-log.test.ts` — Food log unit tests
  - Tests use Vitest with mocks for DB and external APIs

### MCP Context

- **MCPs used:** Linear (issue management)
- **Findings:** 10 Backlog issues found; 3 canceled during triage, 7 planned

### Triage Results

**Planned:** FOO-781, FOO-782, FOO-783, FOO-784, FOO-785, FOO-786, FOO-787

**Canceled:**

| Issue | Title | Reason |
|-------|-------|--------|
| FOO-778 | SESSION_SECRET reused without domain separation | Compromising the secret compromises both systems regardless of domain separation. Migration risk (re-encrypting production tokens) outweighs theoretical benefit for single-user app. |
| FOO-788 | No retry/backoff for 529 overloaded errors | Already addressed by FOO-775 — SDK client has `maxRetries: 2` which handles 529 retries automatically. |
| FOO-779 | X-Forwarded-For IP spoofable for rate limiting | Single-user app behind Railway proxy. Railway controls X-Forwarded-For. Rate limiting is defense-in-depth; real protection is ALLOWED_EMAILS. |

## Tasks

### Task 1: Fix truncateConversation short conversation bypass
**Linear Issue:** [FOO-781](https://linear.app/lw-claude/issue/FOO-781/truncateconversation-silently-skips-truncation-for-short-conversations)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/claude.test.ts` for `truncateConversation`: create a short conversation (3-4 messages) where `estimateTokenCount` exceeds `maxTokens`. Assert that the function does NOT return all messages unchanged — it should still attempt truncation or log a warning.
2. Run `npx vitest run "claude.test"` — expect fail (currently returns messages unchanged for `length <= 5`).
3. In `src/lib/claude.ts:668-671`, move the `messages.length <= 5` guard AFTER the token check, or remove it. When tokens exceed the limit but the conversation is too short to truncate meaningfully (can't remove middle messages), log a warning with `{ action: "truncate_skip_short", estimatedTokens, maxTokens, messageCount: messages.length }` and return the messages as-is. This way the function still respects the guard for genuinely small conversations but logs when it can't help.
4. Run `npx vitest run "claude.test"` — expect pass.

**Notes:**
- The guard exists to avoid stripping context from very short conversations. The fix should preserve that intent while making the token-exceeded case visible via logging.
- Related to FOO-782 — `model_context_window_exceeded` handling provides the downstream safety net.

### Task 2: Handle model_context_window_exceeded stop reason
**Linear Issue:** [FOO-782](https://linear.app/lw-claude/issue/FOO-782/stop-reason-model-context-window-exceeded-not-handled-in-claude-api)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/claude.test.ts` for `runToolLoop`: mock a response with `stop_reason: "model_context_window_exceeded"` and no content. Assert the generator yields `{ type: "error", message: "..." }` with a user-friendly message mentioning conversation length.
2. Write test for `analyzeFood`: mock the initial API call returning `stop_reason: "model_context_window_exceeded"`. Assert that `ClaudeApiError` is thrown with a descriptive message.
3. Run `npx vitest run "claude.test"` — expect fail (currently falls through to generic "unexpected stop_reason" handler).
4. In `runToolLoop` (around line 1033), add an explicit check for `response.stop_reason === "model_context_window_exceeded"` BEFORE the generic handler. Log with `{ action: "context_window_exceeded", iteration }` at warn level. Yield `{ type: "error", message: "The conversation is too long. Please start a new analysis." }` and return.
5. In `analyzeFood` (after the initial API call around line 1200), check `response.stop_reason === "model_context_window_exceeded"` and throw a `ClaudeApiError` with a descriptive message.
6. Apply the same pattern in `conversationalRefine` and `editAnalysis` initial response checks.
7. Run `npx vitest run "claude.test"` — expect pass.

**Notes:**
- The `truncateConversation` function (Task 1) is the first line of defense. This task provides the safety net when truncation isn't enough.
- Follow existing error yield pattern: `yield { type: "error", message: "..." }` in generators.

### Task 3: Fix keywords validation in edit-food route
**Linear Issue:** [FOO-783](https://linear.app/lw-claude/issue/FOO-783/edit-food-route-casts-to-foodanalysis-with-incomplete-keywords)
**Files:**
- `src/app/api/edit-food/__tests__/route.test.ts` or `src/app/api/edit-food/route.test.ts` (create if not exists, modify if exists)
- `src/app/api/edit-food/route.ts` (modify)

**Steps:**
1. Find the existing test file for edit-food route. If none exists, create one.
2. Write test: POST a valid edit-food body WITHOUT `keywords` field. Assert the request is rejected with 400 validation error.
3. Write test: POST a valid edit-food body WITH `keywords: []` (empty array). Assert it passes validation (empty array is valid — `validateFoodAnalysis` in claude.ts requires at least 1, but the edit route's `isValidFoodAnalysis` is a separate validator with its own rules).
4. Run `npx vitest run "edit-food"` — expect fail.
5. In `isValidFoodAnalysis` at `src/app/api/edit-food/route.ts:57`, change `keywords` from optional to required: validate that `req.keywords` exists, is an array of strings, and has at least 1 element. Remove the `if (req.keywords !== undefined)` guard — make the check unconditional. Default to rejecting requests without keywords since `FoodAnalysis.keywords` is `string[]` (required).
6. Run `npx vitest run "edit-food"` — expect pass.

**Notes:**
- The `keywords ?? null` at line 320 will no longer be needed as a safety net since validation guarantees keywords is present, but leave it — defense in depth.

### Task 4: Add strict mode to data tool definitions
**Linear Issue:** [FOO-784](https://linear.app/lw-claude/issue/FOO-784/tool-definitions-in-chat-toolsts-and-luments-missing-strict-true)
**Files:**
- `src/lib/__tests__/chat-tools.test.ts` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/lib/lumen.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/chat-tools.test.ts`: import `SEARCH_FOOD_LOG_TOOL`, `GET_NUTRITION_SUMMARY_TOOL`, `GET_FASTING_INFO_TOOL` and assert each has `strict: true` and `input_schema.additionalProperties === false`.
2. Run `npx vitest run "chat-tools.test"` — expect fail.
3. In `src/lib/chat-tools.ts`, add `strict: true` to all three tool definitions. Add `additionalProperties: false as const` to each `input_schema`.
4. In `src/lib/lumen.ts`, add `strict: true` and `additionalProperties: false as const` to `REPORT_LUMEN_GOALS_TOOL`.
5. Run `npx vitest run "chat-tools.test"` — expect pass.
6. Run full build (`npm run build`) to verify no type errors — strict mode requires all properties to be in the `required` array.

**Notes:**
- Follow the pattern in `REPORT_NUTRITION_TOOL` at `src/lib/claude.ts:93-196`: `strict: true` and `additionalProperties: false as const`.
- Strict mode requires ALL properties to be listed in `required`. Verify each tool's `required` array includes every property. Currently: `SEARCH_FOOD_LOG_TOOL` has `required: ["keywords", "date", "from_date", "to_date", "meal_type", "limit"]` (6 properties, matches). `GET_NUTRITION_SUMMARY_TOOL` has `required: ["date", "from_date", "to_date"]` (3 properties, matches). `GET_FASTING_INFO_TOOL` has `required: ["date", "from_date", "to_date"]` (3 properties, matches). `REPORT_LUMEN_GOALS_TOOL` has `required: ["day_type", "protein_goal", "carbs_goal", "fat_goal"]` (4 properties, matches).
- Nullable types already use `type: ["string", "null"]` or `anyOf` patterns — compatible with strict mode.

### Task 5: Wrap custom_foods + food_log_entries inserts in a transaction
**Linear Issue:** [FOO-785](https://linear.app/lw-claude/issue/FOO-785/orphaned-custom-foods-rows-on-food-log-insert-failure)
**Files:**
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/app/api/log-food/route.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/food-log.test.ts`: create a new function `insertCustomFoodWithLogEntry` that wraps both inserts in a transaction. Mock `insertFoodLogEntry` to throw after `insertCustomFood` succeeds. Assert that both writes are rolled back (the custom_foods row does not persist).
2. Run `npx vitest run "food-log.test"` — expect fail.
3. In `src/lib/food-log.ts`, add a new exported function `insertCustomFoodWithLogEntry(userId, customFoodData, logEntryData, log?)` that uses `db.transaction()` to wrap both `insertCustomFood` and `insertFoodLogEntry` calls. Follow the existing transaction pattern at lines 623/654. Return `{ customFoodId, foodLogId }`.
4. Run `npx vitest run "food-log.test"` — expect pass.
5. In `src/app/api/log-food/route.ts`, replace the separate `insertCustomFood` + `insertFoodLogEntry` calls (lines 339-364) with a single `insertCustomFoodWithLogEntry` call. Update the catch block — the compensation for Fitbit log deletion remains, but orphaned custom_foods rows are no longer possible.
6. Run `npx vitest run "food-log"` and `npx vitest run "log-food"` — expect pass.

**Notes:**
- The existing `insertCustomFood` and `insertFoodLogEntry` functions should remain exported for use elsewhere (e.g., edit-food route). The new function composes them within a transaction.
- The `food-log.ts` file already uses `db.transaction()` at lines 623 and 654 — follow that pattern.

### Task 6: Add action field to 11 log statements in claude.ts
**Linear Issue:** [FOO-786](https://linear.app/lw-claude/issue/FOO-786/missing-action-field-on-11-log-statements-in-claudets)
**Files:**
- `src/lib/claude.ts` (modify)

**Steps:**
1. No test needed — this is a mechanical logging convention fix. Add `action` field to each log statement:
   - Line 900: `{ action: "report_nutrition_validation_error", error: ... }`
   - Line 955: `{ action: "report_nutrition_captured", foodName: ..., blockCount: ... }`
   - Line 960: `{ action: "report_nutrition_validation_error", error: ... }`
   - Line 1109: `{ action: "analyze_food_start", imageCount: ..., hasDescription: ... }`
   - Line 1191: `{ action: "analyze_food_fast_path", foodName: ..., confidence: ..., durationMs: ... }`
   - Line 1216: `{ action: "analyze_food_tool_loop", dataToolCount: ..., stopReason: ... }`
   - Line 1343: `{ action: "analyze_food_error", error: ... }`
   - Line 1424: `{ action: "refine_food_start", messageCount: ..., imageCount: ... }`
   - Line 1504: `{ action: "refine_food_tool_loop", dataToolCount: ..., stopReason: ... }`
   - Line 1679: `{ action: "edit_analysis_start", messageCount: ... }`
   - Line 1740: `{ action: "edit_analysis_error", error: ... }`
2. Run `npm run build` — expect pass (no type impact).
3. Run `npx vitest run "claude.test"` — expect pass (log statements don't affect test assertions).

**Notes:**
- Action names follow the existing convention: `snake_case`, prefixed by function context (e.g., `analyze_food_`, `refine_food_`, `edit_analysis_`).
- This is a pure mechanical change — no behavioral impact.

### Task 7: Remove full result from data tool debug log
**Linear Issue:** [FOO-787](https://linear.app/lw-claude/issue/FOO-787/data-tool-result-logged-in-full-risking-log-overflow-on-large-queries)
**Files:**
- `src/lib/__tests__/chat-tools.test.ts` (modify)
- `src/lib/chat-tools.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/chat-tools.test.ts`: execute a data tool that returns a large result string. Assert that the debug log call includes `resultLength` but NOT the full `result` string.
2. Run `npx vitest run "chat-tools.test"` — expect fail.
3. In `src/lib/chat-tools.ts:364`, remove `result` from the log object. Keep `resultLength: result.length` which is already there. The line should become: `l.debug({ action: "execute_tool_result", tool: toolName, resultLength: result.length }, "data tool execution complete")`.
4. Run `npx vitest run "chat-tools.test"` — expect pass.

**Notes:**
- This is a one-line change. The `result` is still returned from the function — only the logging changes.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Harden Claude API integration, fix validation gaps, and improve logging consistency across 7 backlog issues.
**Linear Issues:** FOO-781, FOO-782, FOO-783, FOO-784, FOO-785, FOO-786, FOO-787
**Approach:** Fix truncation bypass for short conversations (FOO-781), add explicit handling for `model_context_window_exceeded` stop reason (FOO-782), close keywords validation gap in edit-food route (FOO-783), add strict mode to 4 tool definitions (FOO-784), wrap custom_foods + food_log_entries inserts in a DB transaction (FOO-785), add missing `action` fields to 11 log statements (FOO-786), and remove full result string from debug log (FOO-787).
**Scope:** 7 tasks, 8 files, ~10 tests
**Key Decisions:** FOO-778 (domain separation), FOO-788 (529 retry), FOO-779 (IP spoofing) canceled during triage as invalid for current project context.
**Risks:** Task 4 (strict mode) may require adjusting nullable type definitions if the Anthropic API rejects the schema. Task 5 (transaction) changes the error surface of log-food — compensation logic must be re-tested.

---

## Iteration 1

**Implemented:** 2026-03-04
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Fix truncateConversation short conversation bypass — added warn log before early return when short conversations exceed token limit (worker-1)
- Task 2: Handle model_context_window_exceeded stop reason — explicit handling in runToolLoop, analyzeFood, conversationalRefine (worker-1)
- Task 3: Fix keywords validation in edit-food route — made keywords required with ≥1 element in isValidFoodAnalysis (worker-2)
- Task 4: Add strict mode to data tool definitions — added strict: true and additionalProperties: false to all 4 tool definitions (worker-2)
- Task 5: Wrap custom_foods + food_log_entries inserts in a transaction — new insertCustomFoodWithLogEntry function (worker-3)
- Task 6: Add action field to 11 log statements in claude.ts — mechanical logging convention fix (worker-1)
- Task 7: Remove full result from data tool debug log — replaced result with resultLength in debug log (worker-2)

### Files Modified
- `src/lib/claude.ts` — truncation warning, context window exceeded handling, action fields on 11 log statements
- `src/lib/__tests__/claude.test.ts` — tests for truncation bypass and context window exceeded
- `src/lib/chat-tools.ts` — strict mode on 3 tool definitions, removed result from debug log
- `src/lib/__tests__/chat-tools.test.ts` — tests for strict mode and debug log cleanup
- `src/lib/lumen.ts` — strict mode on REPORT_LUMEN_GOALS_TOOL
- `src/lib/food-log.ts` — new insertCustomFoodWithLogEntry transaction function
- `src/lib/__tests__/food-log.test.ts` — tests for transaction function
- `src/app/api/edit-food/route.ts` — keywords validation made required
- `src/app/api/edit-food/__tests__/route.test.ts` — tests for keywords validation
- `src/app/api/log-food/route.ts` — replaced separate inserts with transaction call
- `src/app/api/log-food/__tests__/route.test.ts` — updated mocks for transaction function

### Linear Updates
- FOO-781: Todo → In Progress → Review
- FOO-782: Todo → In Progress → Review
- FOO-783: Todo → In Progress → Review
- FOO-784: Todo → In Progress → Review
- FOO-785: Todo → In Progress → Review
- FOO-786: Todo → In Progress → Review
- FOO-787: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found in any of the 7 fixes
- verifier: All 2507 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 2, 6 (Claude API domain — claude.ts, claude.test.ts)
- Worker 2: Tasks 3, 4, 7 (Validation + Chat tools — edit-food, chat-tools, lumen)
- Worker 3: Task 5 (Food log transaction — food-log.ts, log-food/route.ts)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 3: merged cleanly (no conflicts), typecheck passed
- Worker 2: merged cleanly (no conflicts), typecheck passed

### Continuation Status
All tasks completed.
