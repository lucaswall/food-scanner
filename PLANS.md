# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-510-claude-api-improvements
**Issues:** FOO-510, FOO-511, FOO-512, FOO-513, FOO-514, FOO-515, FOO-516, FOO-517
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Comprehensive improvements to the Claude API integration layer (`src/lib/claude.ts` and `src/lib/chat-tools.ts`). This plan addresses schema correctness (nullable types, strict mode), robustness (new stop reasons, graceful degradation), performance (prompt caching, conversation management), and a model upgrade evaluation.

## Issues

### FOO-516: Fix nullable Tier 1 nutrient fields in report_nutrition tool schema

**Priority:** High
**Labels:** Bug
**Description:** The Tier 1 nutrient fields (`saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`) are defined with `{type: "number"}` in the tool schema, but the system prompt says "use null only when truly unknown" and `validateFoodAnalysis()` explicitly accepts null. Schema must use `{type: ["number", "null"]}`.

**Acceptance Criteria:**
- [ ] Tier 1 fields schema allows null values via `{type: ["number", "null"]}`
- [ ] Schema consistent with system prompt instructions
- [ ] `validateFoodAnalysis()` behavior unchanged
- [ ] Tests pass

### FOO-517: Add required arrays and additionalProperties: false to data tool schemas

**Priority:** Medium
**Labels:** Improvement
**Description:** The 3 data tool definitions (`search_food_log`, `get_nutrition_summary`, `get_fasting_info`) are missing `required` arrays and `additionalProperties: false`. Since these tools have flexible parameter combinations, all params should be listed as required with nullable types `{type: ["string", "null"]}` for optional parameters.

**Acceptance Criteria:**
- [ ] All tool schemas have `required` arrays listing all properties
- [ ] All tool schemas have `additionalProperties: false`
- [ ] Optional parameters use nullable types
- [ ] Handler functions handle null values for optional params (treat null same as undefined)
- [ ] Tests pass

### FOO-512: Add strict: true to Claude tool definitions for schema conformance

**Priority:** Medium
**Labels:** Improvement
**Description:** Enable `strict: true` on all 4 Claude tool definitions after FOO-516 and FOO-517 fix the prerequisite schema issues. Also add `additionalProperties: false` to `report_nutrition` and add Tier 1 fields to its `required` array (strict mode requires all properties to be listed in required).

**Acceptance Criteria:**
- [ ] All 4 tool definitions have `strict: true`
- [ ] `report_nutrition` has `additionalProperties: false`
- [ ] `report_nutrition` `required` array includes all Tier 1 fields
- [ ] Runtime validation in `validateFoodAnalysis()` still present
- [ ] Existing tests pass

### FOO-511: Handle new Claude 4+ stop reasons (refusal, context_window_exceeded)

**Priority:** High
**Labels:** Bug, Improvement
**Description:** `runToolLoop()` throws `ClaudeApiError("Unexpected stop_reason: ...")` for any stop reason other than `end_turn` and `tool_use`. Claude 4+ can return `refusal` and `model_context_window_exceeded`. Also, `analyzeFood()` doesn't check `stop_reason` before looking for tool blocks — a refusal would produce a confusing "No tool_use block" error.

**Acceptance Criteria:**
- [ ] `refusal` stop reason returns user-facing message (not a crash)
- [ ] `model_context_window_exceeded` logged and handled gracefully
- [ ] `analyzeFood()` checks stop_reason before extracting tool blocks
- [ ] Unknown future stop reasons handled with a generic fallback (not a throw)
- [ ] Tests cover both new stop reasons

### FOO-513: Tool loop max iterations should return best response instead of throwing

**Priority:** Medium
**Labels:** Bug
**Description:** `runToolLoop()` throws when the 5-iteration cap is hit, discarding all work from the loop. Should return the best available response (text + optional analysis from the last response).

**Acceptance Criteria:**
- [ ] Max iterations returns last available text + optional analysis
- [ ] Warning logged when cap is hit
- [ ] No throw on iteration exhaustion
- [ ] Test updated

### FOO-510: Enable prompt caching on Claude API calls

**Priority:** High
**Labels:** Performance, Improvement
**Description:** System prompts and tool definitions are sent identically on every request without prompt caching. Add `cache_control: {type: "ephemeral"}` breakpoints to enable up to 90% input cost reduction.

**Acceptance Criteria:**
- [ ] `cache_control` breakpoints set on system prompt and tool definitions
- [ ] Multi-turn conversation messages use `cache_control` on final block of each turn
- [ ] `cache_read_input_tokens` visible in usage tracking (no longer always 0)
- [ ] Existing tests updated for new request shape
- [ ] Tool/system ordering is stable (no cache invalidation between requests)

### FOO-514: Add conversation length management to prevent unbounded token growth

**Priority:** Medium
**Labels:** Performance, Improvement
**Description:** `conversationalRefine()` and `freeChat()` accept full conversation history with no token count check or truncation. Long chat sessions grow unbounded until hitting the context window limit.

**Acceptance Criteria:**
- [ ] Token estimation function for conversation messages
- [ ] Truncation strategy preserving key messages (system prompt, first user message with images, most recent N messages)
- [ ] Truncation logged at info level
- [ ] Tests for truncation behavior

### FOO-515: Evaluate upgrading from Sonnet 4 to Sonnet 4.5

**Priority:** Low
**Labels:** Improvement
**Description:** The app uses `claude-sonnet-4-20250514`. Sonnet 4.5 (`claude-sonnet-4-5-20250929`) is available at the same price with improved capabilities. Code change is trivial (3 model strings + pricing map). **Note:** Manual quality evaluation should be done by the user before or after this task.

**Acceptance Criteria:**
- [ ] Model string updated in all 3 locations
- [ ] `MODEL_PRICING` updated with Sonnet 4.5 entry
- [ ] All tests pass with new model string
- [ ] Manual quality evaluation noted as required

## Prerequisites

- [ ] All dependencies installed (`npm install`)
- [ ] Tests passing before starting (`npm test`)

## Implementation Tasks

### Task 1: Fix nullable Tier 1 fields in report_nutrition schema

**Issue:** FOO-516
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests that assert the Tier 1 field types in the tool schema:
   - Test that `REPORT_NUTRITION_TOOL.input_schema.properties.saturated_fat_g.type` equals `["number", "null"]` (not just `"number"`)
   - Same for `trans_fat_g`, `sugars_g`, `calories_from_fat`
   - Run: `npm test -- claude`
   - Verify: Tests fail because current schema has `{type: "number"}`

2. **GREEN** — Update the REPORT_NUTRITION_TOOL definition:
   - Change the 4 Tier 1 fields from `{type: "number", description: ...}` to `{type: ["number", "null"], description: ...}`
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Verify no downstream impact:
   - `validateFoodAnalysis()` already accepts null for these fields — no changes needed
   - Confirm existing Tier 1 validation tests still pass

**Notes:**
- Reference: `src/lib/claude.ts:67-82` for current field definitions
- Reference: `src/lib/claude.ts:200-219` for validation logic (should be unchanged)

### Task 2: Add required arrays and additionalProperties to data tool schemas

**Issue:** FOO-517
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests for schema completeness:
   - Test that each data tool schema has `additionalProperties: false`
   - Test that each schema has a `required` array listing all its properties
   - Test that optional properties use nullable types (`["string", "null"]`)
   - For `search_food_log`: all 6 properties required, `query`/`date`/`from_date`/`to_date`/`meal_type` nullable string, `limit` nullable number
   - For `get_nutrition_summary`: all 3 properties required, all nullable string
   - For `get_fasting_info`: all 3 properties required, all nullable string
   - Run: `npm test -- chat-tools`
   - Verify: Tests fail

2. **GREEN** — Update tool definitions:
   - Add `additionalProperties: false as const` to each input_schema
   - Add `required: [...]` listing all properties to each input_schema
   - Change property types from `{type: "string"}` to `{type: ["string", "null"]}` for optional params
   - Change `limit` from `{type: "number"}` to `{type: ["number", "null"]}`
   - Update handler functions: treat null values the same as undefined (e.g., `if (!query || query === null)` — but since null is falsy in JS, existing `!query` checks already handle this correctly)
   - Run: `npm test -- chat-tools`
   - Verify: Tests pass

3. **RED/GREEN** — Test that handler functions work correctly with null parameters:
   - Test `executeTool("search_food_log", { query: null, date: "2026-02-15", from_date: null, to_date: null, meal_type: null, limit: null }, ...)` returns date search results
   - Test `executeTool("get_fasting_info", { date: null, from_date: null, to_date: null }, ...)` defaults to current date
   - Run: `npm test -- chat-tools`
   - Verify: Tests pass (null is falsy, so existing `!param` checks work)

**Notes:**
- The `meal_type` enum property: with strict mode, an enum with nullable type uses `{type: ["string", "null"], enum: ["breakfast", ..., "anytime"]}`. However, the JSON Schema spec says `enum` should include all possible values including `null` when the type is nullable. Use: `{type: "string", enum: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "anytime", null]}` or restructure using `anyOf`. Check what Anthropic's strict mode requires — if `anyOf` is needed, use `{anyOf: [{type: "string", enum: [...]}, {type: "null"}]}`.
- Handler functions use `!param` checks which already treat null as falsy — verify no code paths break.

### Task 3: Enable strict: true on all Claude tool definitions

**Issue:** FOO-512
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**Depends on:** Task 1 (FOO-516), Task 2 (FOO-517)

**TDD Steps:**

1. **RED** — Write tests for strict mode properties:
   - Test that `REPORT_NUTRITION_TOOL` has `additionalProperties: false` in input_schema
   - Test that `REPORT_NUTRITION_TOOL.input_schema.required` includes all Tier 1 fields (`saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`)
   - Test that all 4 tools pass a strict schema validation (all properties in required, additionalProperties false, no unsupported schema features)
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Update tool definitions:
   - Add `additionalProperties: false as const` to REPORT_NUTRITION_TOOL input_schema
   - Add Tier 1 fields to the existing `required` array in REPORT_NUTRITION_TOOL
   - Verify data tools already have `additionalProperties` and `required` from Task 2
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **RED** — Write tests asserting `strict: true` on tool definitions:
   - Test that the `tools` array passed to `messages.create()` calls includes tools where each has a top-level `strict` property set to `true` (note: this is a top-level property on the `Anthropic.Tool` object, not inside `input_schema`)
   - But verify the Anthropic SDK type: check if `strict` goes on the tool object or somewhere else. Look at the SDK's `Anthropic.Tool` type definition.
   - Actually, with the Anthropic SDK, tool definitions use `cache_control` as a top-level field. For `strict`, check if this is a supported field or if structured outputs work differently for tools vs. messages. Research the SDK type.
   - Run: `npm test -- claude`
   - Verify: Tests fail

4. **GREEN** — Add `strict: true` to tool definitions:
   - The Anthropic Node SDK may not have a `strict` field on `Anthropic.Tool`. If not directly supported, this may need to be passed via a different mechanism. The implementer should check the SDK types and Anthropic documentation.
   - If the SDK doesn't support `strict` directly, the implementer should note this in the Linear issue and adjust the approach (e.g., cast, or skip this specific field if the schema correctness from Tasks 1-2 is sufficient).
   - Run: `npm test -- claude`
   - Verify: Tests pass

**Notes:**
- The Anthropic SDK `Tool` type may or may not have a `strict` field. The implementer must check the actual TypeScript type. If it doesn't exist, the schema improvements from Tasks 1-2 still provide value even without `strict: true`.
- Reference: Anthropic documentation on structured outputs / tool use strict mode

### Task 4: Handle new Claude 4+ stop reasons in runToolLoop and analyzeFood

**Issue:** FOO-511
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write test for `refusal` stop reason in `runToolLoop`:
   - Mock `messages.create` to return `stop_reason: "refusal"` with a text block
   - Assert the function returns a message (not throws) with the refusal text
   - Run: `npm test -- claude`
   - Verify: Test fails (currently throws "Unexpected stop_reason: refusal")

2. **GREEN** — Handle `refusal` in `runToolLoop`:
   - Add a case for `response.stop_reason === "refusal"` after the `tool_use` case
   - Extract text blocks and return them as the message
   - Log a warning about the refusal
   - Run: `npm test -- claude`
   - Verify: Test passes

3. **RED** — Write test for `model_context_window_exceeded` stop reason in `runToolLoop`:
   - Mock response with `stop_reason: "model_context_window_exceeded"` and text content
   - Assert the function returns partial text (not throws)
   - Run: `npm test -- claude`
   - Verify: Test fails

4. **GREEN** — Handle `model_context_window_exceeded` in `runToolLoop`:
   - Add a case for this stop reason
   - Log a warning
   - Extract and return any text + optional analysis from the response
   - Run: `npm test -- claude`
   - Verify: Test passes

5. **RED** — Write test for unknown future stop reasons:
   - Mock response with `stop_reason: "some_future_reason"` and text content
   - Assert the function returns partial text with a warning (not throws)
   - Run: `npm test -- claude`
   - Verify: Test fails (currently throws "Unexpected stop_reason")

6. **GREEN** — Handle unknown stop reasons gracefully:
   - Replace the `throw new ClaudeApiError("Unexpected stop_reason: ...")` with a fallback that logs a warning and returns whatever text/analysis is available
   - Run: `npm test -- claude`
   - Verify: Test passes

7. **RED** — Write test for `refusal` in `analyzeFood`:
   - Mock response with `stop_reason: "refusal"` and text content (no tool_use block)
   - Assert the function throws a `ClaudeApiError` with a clear refusal-specific message (e.g., "Claude declined to analyze this image")
   - Run: `npm test -- claude`
   - Verify: Test fails (currently throws generic "No tool_use block in response")

8. **GREEN** — Add stop_reason check in `analyzeFood`:
   - Before looking for `tool_use` blocks, check `response.stop_reason`
   - If `refusal`, throw `ClaudeApiError` with a clear message mentioning the refusal
   - If `model_context_window_exceeded`, throw with a context window message
   - Run: `npm test -- claude`
   - Verify: Test passes

9. **REFACTOR** — Extract shared stop_reason handling:
   - Consider extracting a helper function `extractResponseContent(response)` that handles all stop reasons and returns `{ message, analysis }`, used by both `runToolLoop` and the end_turn path
   - Only do this if it reduces duplication significantly

**Notes:**
- The existing test at `claude.test.ts:2189-2215` ("throws on unknown stop_reason") will need updating — it currently expects a throw for `max_tokens`, which should now return gracefully
- `analyzeFood()` uses `tool_choice: { type: "tool", name: "report_nutrition" }` which forces tool use, so `refusal` is the main stop_reason to handle there (Claude refuses the content)

### Task 5: Tool loop max iterations returns best response

**Issue:** FOO-513
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Depends on:** Task 4 (FOO-511) — both modify `runToolLoop`, do Task 4 first to avoid conflicts

**TDD Steps:**

1. **RED** — Update the existing max iterations test:
   - Change the test at `claude.test.ts:1991-2025` from expecting a throw to expecting a return value
   - The 5th iteration's response should have text content; assert the function returns that text
   - Assert a warning is logged
   - Run: `npm test -- claude`
   - Verify: Test fails (currently throws)

2. **GREEN** — Replace the throw with a graceful return:
   - After the while loop (when `iteration >= MAX_ITERATIONS`), instead of throwing:
     - The last response from the loop should still be accessible. Track it as a variable.
     - Actually, at this point the last response was a `tool_use` (that's why the loop continued). We need the text from the last `tool_use` response (if any).
     - Extract text blocks from the most recent response content
     - Extract any `report_nutrition` tool use from the response
     - Log a warning about hitting the iteration cap
     - Return `{ message, analysis }`
   - The implementer needs to track the last response in a variable that's accessible after the loop
   - Run: `npm test -- claude`
   - Verify: Test passes

3. **RED** — Write test for max iterations with analysis in last response:
   - Mock 5 tool_use responses where the last one includes both text and a `report_nutrition` tool_use
   - Assert the returned object includes both message and analysis
   - Run: `npm test -- claude`
   - Verify: Test passes (if the implementation handles it) or fails (add handling)

**Notes:**
- When max iterations is hit, the last response had `stop_reason: "tool_use"`. The response content may include text blocks alongside tool_use blocks. Extract text from those blocks.
- If no text blocks exist in the last response, return a generic message like "I wasn't able to complete the analysis. Please try again."
- Reference: `src/lib/claude.ts:570-691`

### Task 6: Enable prompt caching on Claude API calls

**Issue:** FOO-510
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests for cache_control on system prompt:
   - Test that the `system` parameter in `analyzeFood()` API call uses an array format with `cache_control` on the last block: `[{type: "text", text: "...", cache_control: {type: "ephemeral"}}]`
   - Note: The Anthropic SDK accepts `system` as either a string or an array of content blocks. Switching to the array format enables `cache_control`.
   - Run: `npm test -- claude`
   - Verify: Test fails (system is currently a string)

2. **GREEN** — Convert system prompts to cacheable format:
   - In `analyzeFood()`: Change `system: SYSTEM_PROMPT` to `system: [{type: "text", text: SYSTEM_PROMPT, cache_control: {type: "ephemeral"}}]`
   - In `conversationalRefine()`: Same pattern for `systemPrompt`
   - In `runToolLoop()`: Same pattern for the system prompt parameter
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **RED** — Write tests for cache_control on tool definitions:
   - Test that the last tool in the `tools` array has `cache_control: {type: "ephemeral"}` set
   - For `analyzeFood()`: only 1 tool, so it gets cache_control
   - For `conversationalRefine()`: 4 tools, last one gets cache_control
   - For `runToolLoop()`: last tool in the array gets cache_control
   - Run: `npm test -- claude`
   - Verify: Test fails

4. **GREEN** — Add cache_control to last tool definition:
   - Before passing tools to `messages.create()`, clone the last tool and add `cache_control: {type: "ephemeral"}`
   - Use spread: `[...tools.slice(0, -1), {...tools[tools.length - 1], cache_control: {type: "ephemeral"}}]`
   - Don't mutate the original tool constants
   - Run: `npm test -- claude`
   - Verify: Tests pass

5. **REFACTOR** — Consider extracting a helper:
   - `addCacheControl(tools: Anthropic.Tool[]): Anthropic.Tool[]` that adds cache_control to the last tool
   - `toCacheableSystem(text: string): Anthropic.MessageCreateParams["system"]` that wraps a string system prompt
   - Only extract if it reduces duplication across `analyzeFood`, `conversationalRefine`, and `runToolLoop`

**Notes:**
- Cache breakpoint placement: Anthropic caches everything up to and including the block with `cache_control`. So placing it on the system prompt caches the system prompt. Placing it on the last tool caches all tools.
- The ordering of system + tools is managed by the SDK — system is always first, then tools, then messages. Our cache breakpoints on system and last tool will create two cache prefixes.
- `conversationalRefine()` and `freeChat()` already pass `cache_creation_input_tokens` and `cache_read_input_tokens` to `recordUsage()` — these will now have non-zero values.
- Verify that tool ordering is stable across calls (it is — we always use `[REPORT_NUTRITION_TOOL, ...DATA_TOOLS]` or just `DATA_TOOLS`).

### Task 7: Add conversation length management

**Issue:** FOO-514
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests for token estimation function:
   - Create a `estimateTokenCount(messages: Anthropic.MessageParam[]): number` function
   - Test with text-only messages: rough heuristic ~4 chars per token
   - Test with image messages: fixed estimate per image (e.g., ~1000 tokens for a typical food photo at low detail)
   - Test with empty messages array
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Implement token estimation:
   - Iterate over messages, sum up text character counts / 4
   - For image blocks, add a fixed estimate (e.g., 1000 tokens per image)
   - Return total estimated tokens
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **RED** — Write tests for conversation truncation:
   - Create a `truncateConversation(messages: Anthropic.MessageParam[], maxTokens: number): Anthropic.MessageParam[]` function
   - Test that when under the limit, messages are returned unchanged
   - Test that when over the limit, older middle messages are removed while preserving:
     - First user message (contains the food images/initial context)
     - Most recent N messages (e.g., last 4 messages)
   - Test that alternating user/assistant order is maintained after truncation
   - Test edge case: very few messages (< 4) are never truncated
   - Run: `npm test -- claude`
   - Verify: Tests fail

4. **GREEN** — Implement truncation strategy:
   - If estimated tokens < threshold (e.g., 150,000 for Sonnet's 200k context), return unchanged
   - Otherwise, keep first message + last N messages, drop the middle
   - Ensure the result maintains valid user/assistant alternation
   - Log at info level when truncation occurs (message count before/after, estimated tokens)
   - Run: `npm test -- claude`
   - Verify: Tests pass

5. **RED/GREEN** — Integrate into conversationalRefine and freeChat:
   - Call `truncateConversation()` before passing messages to the API
   - Test that the integration works (mock a long conversation, verify truncation is applied)
   - The token threshold should be a reasonable constant (not configurable)
   - Run: `npm test -- claude`
   - Verify: Tests pass

**Notes:**
- Token estimation doesn't need to be exact — it's a safety net. A rough heuristic is fine.
- Sonnet 4 / 4.5 has a 200k token context window. System prompt + tools use ~2-3k tokens. Leave headroom for the response. A threshold of ~150k for the conversation messages is reasonable.
- The truncation should preserve the first user message because in food chat, it contains the initial images being analyzed.
- `runToolLoop` accumulates messages internally, but those are within a single API session (max 5 iterations) so they won't grow unbounded. The truncation should happen on the input messages before entering the loop.

### Task 8: Upgrade model from Sonnet 4 to Sonnet 4.5

**Issue:** FOO-515
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/claude-usage.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update tests to expect new model string:
   - Change all test assertions from `"claude-sonnet-4-20250514"` to `"claude-sonnet-4-5-20250929"`
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Update model strings:
   - Change the model string in `analyzeFood()` (line ~254), `conversationalRefine()` (line ~424), and `runToolLoop()` (line ~584) from `"claude-sonnet-4-20250514"` to `"claude-sonnet-4-5-20250929"`
   - Add `"claude-sonnet-4-5-20250929"` to `MODEL_PRICING` in `claude-usage.ts` with same pricing ($3/M input, $15/M output)
   - Keep the old Sonnet 4 entry in `MODEL_PRICING` for historical usage records
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Extract model string to a constant:
   - Define `const CLAUDE_MODEL = "claude-sonnet-4-5-20250929"` at the top of `claude.ts`
   - Use it in all 3 `messages.create()` calls to avoid repetition
   - Run: `npm test -- claude`
   - Verify: Tests pass

**Notes:**
- Sonnet 4.5 pricing is identical to Sonnet 4: $3/M input, $15/M output
- **Manual evaluation required:** The user should test food analysis and chat quality with the new model in staging before releasing to production. The code change is safe to deploy — the model is stable and same-priced.
- Extracting the model string to a constant prevents the 3-location update problem in the future.

### Task 9: Integration verification

**Issues:** FOO-510, FOO-511, FOO-512, FOO-513, FOO-514, FOO-515, FOO-516, FOO-517

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Verify cache_control appears in API call structure (via test assertions)
   - [ ] Verify all 4 tools have strict-compatible schemas
   - [ ] Verify stop_reason handling covers all known cases

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude returns `refusal` stop reason | Return user-friendly refusal message | Unit test (Task 4) |
| Claude returns `model_context_window_exceeded` | Log warning, return partial text | Unit test (Task 4) |
| Tool loop hits 5 iterations | Return best available response | Unit test (Task 5) |
| Conversation exceeds token estimate | Truncate middle messages, log info | Unit test (Task 7) |
| Unknown future stop_reason | Log warning, return partial text | Unit test (Task 4) |

## Risks & Open Questions

- [ ] **Anthropic SDK `strict` field:** The SDK's `Anthropic.Tool` type may not have a `strict` property. The implementer should check the SDK types. If unsupported, the schema improvements from Tasks 1-2 still provide value. Update FOO-512 accordingly.
- [ ] **`meal_type` enum with nullable type in strict mode:** JSON Schema for nullable enums may need `anyOf` instead of `type: ["string", "null"]` with `enum`. The implementer should test this with the Anthropic API.
- [ ] **Token estimation accuracy:** The ~4 chars/token heuristic is approximate. For this use case (safety net, not billing), it's acceptable.
- [ ] **Model upgrade quality:** Sonnet 4.5 should be evaluated on real food images before the release branch merge. The code change is safe but quality should be confirmed.

## Scope Boundaries

**In Scope:**
- Tool schema fixes (nullable types, required arrays, additionalProperties, strict mode)
- Stop reason handling (refusal, context_window_exceeded, unknown)
- Graceful max iterations (return partial instead of throw)
- Prompt caching (system prompt + tools)
- Conversation length management (token estimation + truncation)
- Model string upgrade to Sonnet 4.5

**Out of Scope:**
- Changes to the Fitbit API integration
- UI changes
- Database schema changes
- New tool definitions
- E2E test changes (these are API-level changes, tested via unit tests)

---

## Iteration 1

**Implemented:** 2026-02-15
**Method:** Agent team (1 worker)

### Tasks Completed This Iteration
- Task 1: Fix nullable Tier 1 fields in report_nutrition schema (FOO-516) - Changed saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat to type: ["number", "null"]
- Task 2: Add required arrays and additionalProperties to data tool schemas (FOO-517) - Added additionalProperties: false, required arrays, nullable types, anyOf for meal_type enum
- Task 3: Enable strict: true on all Claude tool definitions (FOO-512) - Added strict: true to all 4 tools, additionalProperties: false and Tier 1 fields to required on report_nutrition
- Task 4: Handle new Claude 4+ stop reasons (FOO-511) - Graceful handling for refusal, model_context_window_exceeded, unknown stop reasons in runToolLoop and analyzeFood
- Task 5: Tool loop max iterations returns best response (FOO-513) - Returns last response text + optional analysis instead of throwing
- Task 6: Enable prompt caching on Claude API calls (FOO-510) - cache_control on system prompts (array format) and last tool definition
- Task 7: Add conversation length management (FOO-514) - estimateTokenCount() and truncateConversation() with 150k threshold
- Task 8: Upgrade model from Sonnet 4 to Sonnet 4.5 (FOO-515) - Extracted CLAUDE_MODEL constant, updated to claude-sonnet-4-5-20250929, added to MODEL_PRICING

### Files Modified
- `src/lib/claude.ts` - Nullable Tier 1 schema, strict mode, stop reason handling, max iterations graceful return, prompt caching, conversation truncation, model upgrade
- `src/lib/chat-tools.ts` - Required arrays, additionalProperties, nullable types, strict mode, null limit fix
- `src/lib/claude-usage.ts` - Added Sonnet 4.5 to MODEL_PRICING
- `src/lib/__tests__/claude.test.ts` - Updated for all changes: schema tests, stop reason tests, caching format, model string, token estimation/truncation
- `src/lib/__tests__/chat-tools.test.ts` - Schema completeness tests, null parameter handling, strict mode tests

### Linear Updates
- FOO-516: Todo → In Progress → Review
- FOO-517: Todo → In Progress → Review
- FOO-512: Todo → In Progress → Review
- FOO-511: Todo → In Progress → Review
- FOO-513: Todo → In Progress → Review
- FOO-510: Todo → In Progress → Review
- FOO-514: Todo → In Progress → Review
- FOO-515: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (null limit defaulting to 0), fixed before commit
- verifier: All 104 tests pass, zero lint warnings, build clean (1 pre-existing Edge Runtime warning in instrumentation.ts, unrelated)

### Work Partition
- Worker 1: Tasks 1-8 (all files share claude.ts/claude.test.ts through Task 3 dependencies)

### Continuation Status
All tasks completed.
