# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-523-chat-bugs
**Issues:** FOO-523, FOO-524, FOO-525, FOO-526, FOO-527, FOO-528
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Fix 6 bugs and improvements found during deep review of the AI chat functionality. All issues are in `src/lib/claude.ts`, `src/lib/chat-tools.ts`, `src/components/food-chat.tsx`, and `src/components/chat-page-client.tsx`. Changes are focused — no new features, no schema changes, no migrations.

## Issues

### FOO-523: Chat system prompt missing current date (High/Bug)

`CHAT_SYSTEM_PROMPT` has no date reference. `currentDate` is passed to `executeTool()` but never injected into the system prompt. Claude cannot resolve "today", "yesterday", "this week" to YYYY-MM-DD dates for tool calls.

**Acceptance Criteria:**
- [ ] System prompt includes `Today's date is: {currentDate}` (injected dynamically)
- [ ] Existing tests updated to verify date injection
- [ ] Add test: `conversationalRefine` includes current date in system prompt text

### FOO-524: search_food_log date range incomplete results (Medium/Bug)

`executeSearchFoodLog` date range case calls `getFoodLogHistory(userId, { endDate: to_date, limit: effectiveLimit })` then filters client-side by `from_date`. The limit may exclude entries within the range.

**Acceptance Criteria:**
- [ ] `getFoodLogHistory` supports `startDate` parameter for server-side date range filtering
- [ ] `executeSearchFoodLog` uses `startDate` instead of client-side filtering
- [ ] Add test: date range search returns all entries within range regardless of limit

### FOO-525: Client 30s timeout too short for tool loop (Medium/Bug)

`FoodChat` uses `AbortSignal.timeout(30000)`. Server-side `runToolLoop` can make up to 5 sequential Claude API calls (each with 30s timeout). Complex queries exceed 30s.

**Acceptance Criteria:**
- [ ] Client timeout increased to 120s
- [ ] Server propagates `request.signal` to abort Claude API calls when client disconnects

### FOO-526: report_nutrition executed as "unknown tool" in tool loop (Low/Bug)

When Claude emits `report_nutrition` alongside a data tool in a `stop_reason: "tool_use"` response, `runToolLoop` passes it to `executeTool()` which throws "Unknown tool". Wastes an iteration and may lose the analysis.

**Acceptance Criteria:**
- [ ] `runToolLoop` extracts `report_nutrition` from tool_use blocks before executing data tools
- [ ] If `report_nutrition` is present, its input is validated and stored as a pending analysis
- [ ] Only data tools are passed to `executeTool`
- [ ] Add test: tool loop with both `report_nutrition` and data tool in same response

### FOO-527: ChatPageClient missing mealTypeId in confirmation (Low/Improvement)

`FoodChat.onLogged` callback only passes `(response, analysis)`, not `mealTypeId`. `ChatPageClient` renders `FoodLogConfirmation` without it.

**Acceptance Criteria:**
- [ ] `onLogged` callback includes `mealTypeId` parameter
- [ ] `ChatPageClient` passes `mealTypeId` to `FoodLogConfirmation`
- [ ] `FoodAnalyzer`'s `onLogged` handler updated to match new signature

### FOO-528: Conversation truncation invalid role ordering (Low/Bug)

`truncateConversation` keeps first message + last 4. If first is "user" and the 5th-from-last is also "user", two consecutive same-role messages violate the Anthropic API requirement.

**Acceptance Criteria:**
- [ ] After slicing, validate no two consecutive messages have the same role
- [ ] If consecutive same-role messages found, drop the earlier one of the pair
- [ ] Add test: truncation with even message count produces valid alternating roles

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] No pending migrations or schema changes

## Implementation Tasks

### Task 1: Inject current date into chat system prompt

**Issue:** FOO-523
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in the `conversationalRefine` describe block: when called with `currentDate="2026-02-15"`, verify that `mockCreate` receives a system prompt containing `"Today's date is: 2026-02-15"`. The existing tests call `conversationalRefine` with `currentDate` as the 4th arg — check the system prompt in the `mockCreate` call's `system` field. Run: `npm test -- claude`

2. **GREEN** — In `conversationalRefine`, change the system prompt construction (around line 442) to append `\n\nToday's date is: ${currentDate}` to `systemPrompt` when `currentDate` is provided. Also do the same in `runToolLoop` (line 614 area) where it builds the systemPrompt for subsequent iterations — but `runToolLoop` already receives the `systemPrompt` from `conversationalRefine` via `options.systemPrompt`, so the date is already baked in. Just need to ensure the standalone `runToolLoop` path (when `options.systemPrompt` is undefined) also has the date. Add `currentDate` injection in `runToolLoop` when building the default systemPrompt. Run: `npm test -- claude`

3. **REFACTOR** — Extract a helper `buildSystemPrompt(basePrompt: string, currentDate?: string, initialAnalysis?: FoodAnalysis): string` to avoid duplicating the date injection + initialAnalysis appending logic. Both `conversationalRefine` and the default path in `runToolLoop` should use it.

**Notes:**
- The `CHAT_SYSTEM_PROMPT` constant stays unchanged — it's the base template
- Date injection happens at call time, not at import time
- Reference: `conversationalRefine` at line 442 already appends `initialAnalysis` context — follow the same pattern

### Task 2: Add startDate support to getFoodLogHistory

**Issue:** FOO-524
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in the `getFoodLogHistory` describe block: call with `{ startDate: "2026-02-10", endDate: "2026-02-15" }`, verify the DB query includes a `gte(foodLogEntries.date, "2026-02-10")` condition. Mock the DB to return entries spanning the range. Run: `npm test -- food-log`

2. **GREEN** — In `getFoodLogHistory`, add optional `startDate` to the options type. In the conditions array, add `gte(foodLogEntries.date, options.startDate)` when provided. Import `gte` from drizzle-orm if not already imported. Run: `npm test -- food-log`

3. **REFACTOR** — No refactoring needed; this is a one-line addition.

**Notes:**
- `getFoodLogHistory` signature at line 350: add `startDate?: string` to the options type
- The existing `endDate` condition uses `lte` — mirror it with `gte` for `startDate`
- Check that `gte` is already imported from drizzle-orm at the top of food-log.ts

### Task 3: Use startDate in executeSearchFoodLog

**Issue:** FOO-524
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**Depends on:** Task 2

**TDD Steps:**

1. **RED** — Add test: call `executeTool("search_food_log", { from_date: "2026-02-10", to_date: "2026-02-15", ... }, userId, currentDate)`. Verify `mockGetFoodLogHistory` is called with `{ startDate: "2026-02-10", endDate: "2026-02-15" }` (no `limit` — see below). Run: `npm test -- chat-tools`

2. **GREEN** — In `executeSearchFoodLog` date range case (line 182), change the `getFoodLogHistory` call to pass `startDate: from_date` and remove the `limit` parameter for date range queries (let the DB return all entries in the range). Remove the client-side `from_date` filter on line 189. Cap at a hard max of 100 entries to prevent runaway queries. Run: `npm test -- chat-tools`

3. **REFACTOR** — Remove the comment on line 188 that says "getFoodLogHistory only supports endDate".

**Notes:**
- For date range queries, the limit is counterproductive — we want ALL entries in the range
- Add a hard cap (100 entries) as a safety limit for the DB query, not for the tool output
- The `effectiveLimit` from the user's `limit` param should still be respected for the output (truncate after fetching) — if Claude passes `limit: 5` with a date range, return only 5

### Task 4: Increase client timeout and propagate abort signal

**Issue:** FOO-525
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/app/api/chat-food/route.ts` (modify)
- `src/lib/claude.ts` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — In `food-chat.test.tsx`, update the existing timeout test (if it checks for 30000) to expect 120000 instead. Run: `npm test -- food-chat`

2. **GREEN** — In `food-chat.tsx` line 258, change `AbortSignal.timeout(30000)` to `AbortSignal.timeout(120000)`. Run: `npm test -- food-chat`

3. **Server-side abort** — In the API route (`route.ts`), pass `request.signal` to `conversationalRefine`. In `conversationalRefine`, accept an optional `signal?: AbortSignal` parameter and pass it through to `runToolLoop`. In `runToolLoop`, check `signal?.aborted` before each iteration and throw if aborted. This is a best-effort optimization — the Anthropic SDK doesn't natively accept AbortSignal, but we can avoid starting new iterations after the client disconnects.

**Notes:**
- The Anthropic SDK `timeout` option (30s per call) is separate from the client timeout — don't change the SDK timeout
- The server-side abort check only prevents new iterations; it won't cancel an in-flight SDK call
- `conversationalRefine` signature gains `signal?: AbortSignal` as the last parameter
- `runToolLoop` `options` gains `signal?: AbortSignal`

### Task 5: Handle report_nutrition in tool loop

**Issue:** FOO-526
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in the `runToolLoop` describe block: mock Claude response with `stop_reason: "tool_use"` containing both a `report_nutrition` tool_use block and a `get_nutrition_summary` tool_use block. Verify that `executeTool` is only called for `get_nutrition_summary` (not for `report_nutrition`). Verify the final result includes the analysis from `report_nutrition`. Run: `npm test -- claude`

2. **GREEN** — In `runToolLoop`, in the `stop_reason === "tool_use"` branch (line 698), after extracting `toolUseBlocks`, partition them:
   - `reportNutritionBlock` = find and remove any block with `name === "report_nutrition"`
   - `dataToolBlocks` = remaining blocks
   - If `reportNutritionBlock` exists, validate its input via `validateFoodAnalysis` and store as `pendingAnalysis`
   - Only execute `dataToolBlocks` via `executeTool`
   - For the tool_result sent back to Claude, include a success result for `report_nutrition` (e.g., `"Nutrition analysis recorded."`) so Claude doesn't think it failed
   - When the loop ends (any exit path), if `pendingAnalysis` is set and the response doesn't already have an analysis, use `pendingAnalysis`

   Run: `npm test -- claude`

3. **REFACTOR** — The `pendingAnalysis` variable should be declared at the top of the function alongside `lastResponse`, to be accessible from all exit paths.

**Notes:**
- Reference: `conversationalRefine` lines 480-486 already does a similar filter for the initial (non-loop) response — follow the same pattern
- The tool_result for report_nutrition needs to be included in the `toolResults` array so the conversation stays valid (Claude expects a tool_result for every tool_use)

### Task 6: Pass mealTypeId through onLogged callback

**Issue:** FOO-527
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/chat-page-client.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — In `food-chat.test.tsx`, find the test that verifies `onLogged` is called after successful logging. Update the expectation to include a third argument for `mealTypeId`. Run: `npm test -- food-chat`

2. **GREEN** — In `food-chat.tsx`:
   - Change the `onLogged` prop type (line 39) from `(response: FoodLogResponse, analysis: FoodAnalysis) => void` to `(response: FoodLogResponse, analysis: FoodAnalysis, mealTypeId: number) => void`
   - In `handleLog` (line 357), change `onLogged(result.data, analysis)` to `onLogged(result.data, analysis, mealTypeId)`

   In `chat-page-client.tsx`:
   - Add `mealTypeId` state: `const [loggedMealTypeId, setLoggedMealTypeId] = useState<number | null>(null)`
   - Update the `onLogged` handler to capture it: `(response, analysis, mealType) => { setLogResponse(response); setLoggedAnalysis(analysis); setLoggedMealTypeId(mealType); }`
   - Pass to confirmation: `<FoodLogConfirmation ... mealTypeId={loggedMealTypeId ?? undefined} />`

   In `food-analyzer.tsx`:
   - Update the `onLogged` handler (line 471) to accept the third arg: `(response, refinedAnalysis, _mealType) => { ... }` — the analyzer already has its own `mealTypeId` state so it doesn't need this value, but the signature must match

   Run: `npm test -- food-chat`

3. **REFACTOR** — No refactoring needed.

**Notes:**
- `food-analyzer.tsx` line 471 needs the signature updated even though it ignores the value — TypeScript will error on mismatched callback types

### Task 7: Fix conversation truncation role ordering

**Issue:** FOO-528
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test for `truncateConversation`: create a message array of 10 messages with very high estimated tokens (to trigger truncation). The messages alternate user/assistant. After truncation (first + last 4), check that no two consecutive messages have the same role. Specifically test the case where the result would be [user(0), user(6), assistant(7), user(8), assistant(9)] — the function should drop the first of the consecutive pair to produce [user(0), assistant(7), user(8), assistant(9)]. `truncateConversation` is not exported — either export it for testing, or test it indirectly through `conversationalRefine` by mocking `estimateTokenCount` to return a high value. Run: `npm test -- claude`

2. **GREEN** — In `truncateConversation` (line 581), after building `[firstMessage, ...lastFourMessages]`, add a post-processing step: iterate the result array and if `result[i].role === result[i-1].role`, drop `result[i-1]` (keeping the more recent message). A simple filter loop works. Run: `npm test -- claude`

3. **REFACTOR** — Consider whether the function should be exported for direct testing. If it's small and self-contained, exporting it is cleaner than testing indirectly.

**Notes:**
- The function is currently not exported. Either export it or test via `conversationalRefine` with mocked token estimation.
- The safest approach is to drop earlier duplicates, preserving the most recent context.
- Edge case: if after dropping duplicates the array starts with "assistant", that's still valid for the Anthropic API (tool_result messages can appear as "user" before the first "user" text message, but in practice the first message in this app is always "user").

### Task 8: Integration verification

**Issue:** FOO-523, FOO-524, FOO-525, FOO-526, FOO-527, FOO-528

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Missing currentDate in conversationalRefine | System prompt omits date line (graceful) | Unit test |
| Date range with >100 entries | Capped at 100 from DB | Unit test |
| Client timeout at 120s | "Request timed out" error shown | Unit test |
| report_nutrition validation fails in tool loop | Error logged, loop continues without analysis | Unit test |
| Truncation produces empty array | Return original (already handled by length check) | Unit test |

## Risks & Open Questions

- [ ] Task 4 (abort signal): The Anthropic SDK doesn't accept AbortSignal. Server-side abort only prevents new loop iterations, not in-flight API calls. This is a known limitation — full abort would require SDK changes.
- [ ] Task 5 (report_nutrition in loop): Need to verify that sending a synthetic tool_result for report_nutrition doesn't confuse Claude's subsequent responses. The result should be a simple acknowledgment string.

## Scope Boundaries

**In Scope:**
- All 6 issues listed above
- Unit test coverage for each fix
- Type safety across modified interfaces

**Out of Scope:**
- Streaming responses for the chat endpoint (mentioned in FOO-525 as an alternative)
- E2E test updates (run before release, not during TDD)
- Any refactoring beyond what's needed for the fixes
