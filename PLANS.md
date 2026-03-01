# Fix Plan: Chat edit uses customFoodId instead of food_log_entries.id

**Issue:** FOO-768
**Date:** 2026-03-01
**Status:** COMPLETE
**Branch:** fix/FOO-768-chat-edit-wrong-id

## Investigation

### Bug Report
When editing a meal via the chat screen, the user sees a duplicate meal instead of the original being updated. The AI correctly identified the edit intent, the UI showed the "Save Changes" button, and the edit-food API returned success — but the wrong entry was modified.

### Classification
- **Type:** Data Issue
- **Severity:** High
- **Affected Area:** Chat edit flow (search_food_log → report_nutrition → edit-food)

### Root Cause Analysis

The `search_food_log` tool exposes `[id:N]` where N is `custom_foods.id` (customFoodId), but the system prompt instructs Claude to set `editing_entry_id` to this `[id:N]` value. The `/api/edit-food` route interprets `editing_entry_id` as `food_log_entries.id`.

Since `custom_foods` and `food_log_entries` have separate auto-incrementing ID sequences, the edit targets the **wrong** food_log_entries row. The original entry remains untouched, and a different entry gets overwritten — appearing as a duplicate.

#### Evidence

**All three search formatters use `customFoodId` in the `[id:N]` marker:**
- `src/lib/chat-tools.ts:150` — keyword search: `[id:${food.customFoodId}]`
- `src/lib/chat-tools.ts:175` — date search: `[id:${entry.customFoodId}]`
- `src/lib/chat-tools.ts:200` — date range: `[id:${entry.customFoodId}]`

**System prompt instructs Claude to use `[id:N]` for editing:**
- `src/lib/claude.ts:75` — `"Set editing_entry_id to the entry's [id:N] from search_food_log results"`
- `src/lib/claude.ts:150` — `source_custom_food_id` tool description also says `"Set to the [id:N] value"`

Both `source_custom_food_id` and `editing_entry_id` reference the same `[id:N]` marker, but they need different ID types:
- `source_custom_food_id` correctly needs `custom_foods.id` (reuse the food definition)
- `editing_entry_id` needs `food_log_entries.id` (which entry to update)

**The data types already carry both IDs but only one is exposed:**
- `MealEntry` (date search): has `id` (food_log_entries.id) AND `customFoodId` — only `customFoodId` exposed
- `FoodLogHistoryEntry` (date range): has `id` (food_log_entries.id) AND `customFoodId` — only `customFoodId` exposed
- `CommonFood` (keyword search): has `customFoodId` only — no entry ID available (aggregated result)

**Staging logs confirmed the mismatch:**
- Edit request received with `entryId: 51` (the customFoodId, not the actual entry ID)
- API found a food_log_entries row with `id = 51` (a different entry) and updated it
- The user's actual lunch entry (with a different food_log_entries.id) was untouched

### Impact
- Every chat-initiated edit targets the wrong entry (or returns 404 if no entry exists with that customFoodId)
- Original entry is never modified — appears as a duplicate
- A different entry may get silently overwritten with wrong data (data corruption)
- Feature was introduced in FOO-750 on this branch, not yet merged to main

## Fix Plan (TDD Approach)

### Step 1: Add `[entry:N]` marker to date-based search results in chat-tools
**File:** `src/lib/chat-tools.ts` (modify)
**Test:** `src/lib/__tests__/chat-tools.test.ts` (modify)

**Behavior:**
- Date-based search (Case 2, line 175): output format changes from `[id:${entry.customFoodId}]` to `[id:${entry.customFoodId}] [entry:${entry.id}]`
- Date range search (Case 3, line 200): same change — add `[entry:${entry.id}]` marker
- Keyword search (Case 1, line 150): keep `[id:${food.customFoodId}]` only — no entry ID available for aggregated results (editing not possible from keyword-only search)

**Tests:**
1. Date search result string includes both `[id:N]` and `[entry:N]` markers with correct values
2. Date range search result string includes both `[id:N]` and `[entry:N]` markers with correct values
3. Keyword search result string includes `[id:N]` only (no `[entry:N]`)
4. The `[id:N]` value matches `customFoodId` and `[entry:N]` value matches `food_log_entries.id` (verify they are different values in test data)

### Step 2: Update system prompt and tool descriptions to distinguish the two IDs
**File:** `src/lib/claude.ts` (modify)
**Test:** `src/lib/__tests__/claude.test.ts` (modify)

**Behavior:**
- `CHAT_SYSTEM_PROMPT` (line 75): Update `editing_entry_id` rule to say "Set editing_entry_id to the `[entry:N]` value from search_food_log results" instead of `[id:N]`
- `CHAT_SYSTEM_PROMPT` (line 74): Keep `source_custom_food_id` referencing `[id:N]` (unchanged)
- `REPORT_NUTRITION_TOOL.editing_entry_id` description (line 152-154): Update to reference `[entry:N]` marker
- `REPORT_NUTRITION_TOOL.source_custom_food_id` description (line 148-150): Keep referencing `[id:N]` (unchanged)

**Tests:**
1. `CHAT_SYSTEM_PROMPT` contains `[entry:N]` reference for `editing_entry_id`
2. `CHAT_SYSTEM_PROMPT` still contains `[id:N]` reference for `source_custom_food_id`
3. `REPORT_NUTRITION_TOOL` editing_entry_id description references `[entry:N]`

### Step 3: Verify
- [ ] All new tests pass
- [ ] All existing tests pass (existing `[id:N]` tests for `source_custom_food_id` unchanged)
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds

## Notes
- The fix is backwards-compatible: `[id:N]` continues to work for `source_custom_food_id` (food reuse). Only `editing_entry_id` behavior changes.
- Keyword search intentionally does NOT get `[entry:N]` — it returns aggregated food definitions, not specific log entries. To edit, the user must reference a date-specific entry.
- No DB migration needed — the data model is correct; only the tool output format and prompt need updating.
- E2E test `e2e/tests/edit-food.spec.ts` may need updating if it tests the chat edit flow end-to-end.

---

## Iteration 1

**Implemented:** 2026-03-01
**Method:** Single-agent (2 tasks, 2 units, effort score 2)

### Tasks Completed This Iteration
- Step 1: Add `[entry:N]` marker to date-based search results — Added `[entry:${entry.id}]` to Case 2 (date search) and Case 3 (date range search) in `chat-tools.ts`
- Step 2: Update system prompt and tool descriptions — Changed `editing_entry_id` references from `[id:N]` to `[entry:N]` in `CHAT_SYSTEM_PROMPT` and `REPORT_NUTRITION_TOOL`

### Files Modified
- `src/lib/chat-tools.ts` — Added `[entry:N]` marker to date search (line 175) and date range search (line 200)
- `src/lib/claude.ts` — Updated `editing_entry_id` rule in system prompt (line 75) and tool description (line 154) to reference `[entry:N]`
- `src/lib/__tests__/chat-tools.test.ts` — Added 3 tests: date search `[entry:N]`, date range `[entry:N]`, keyword search no `[entry:N]`
- `src/lib/__tests__/claude.test.ts` — Added 3 tests: prompt references `[entry:N]`, prompt still references `[id:N]`, tool description references `[entry:N]`

### Linear Updates
- FOO-768: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 2467 tests pass, zero warnings, build clean

### Review Findings

Files reviewed: 4
Reviewer: single-agent (≤4 files)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found — all implementations are correct and follow project conventions.

- `src/lib/chat-tools.ts`: `[entry:N]` marker correctly exposes `food_log_entries.id` in date and date-range searches; keyword search correctly omits it
- `src/lib/claude.ts`: System prompt and tool description properly distinguish `[entry:N]` (entry ID for editing) from `[id:N]` (food definition ID for reuse)
- Edit-food API validated: `getFoodLogEntryDetail(userId, entryId)` scopes lookup to authenticated user — no IDOR risk
- Tests verify marker separation with distinct IDs (customFoodId=7, id=42), keyword exclusion, and prompt/tool description content

### Linear Updates
- FOO-768: Review → Merge

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
