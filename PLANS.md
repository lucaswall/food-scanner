# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-532-full-tool-support-initial-analysis
**Issues:** FOO-532
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Enable all 5 tools (web_search, report_nutrition, search_food_log, get_nutrition_summary, get_fasting_info) in the initial food analysis, and automatically transition to the chat UI when Claude needs data tools or clarification instead of immediately reporting nutrition.

Currently `analyzeFood()` forces `tool_choice: { type: "tool", name: "report_nutrition" }` with only web_search and report_nutrition available. When users type descriptions like "same as yesterday but half", Claude can't look up food history. This change allows Claude to choose its response strategy: call report_nutrition directly (fast path) or signal that a conversational interaction is needed (needs-chat path).

## Issues

### FOO-532: Full tool support in initial analysis with automatic chat transition

**Priority:** Medium
**Labels:** Feature
**Description:** Change `analyzeFood()` to `tool_choice: auto` with all 5 tools. Branch on Claude's response: if `report_nutrition` is called, return analysis (fast path); if data tools or text-only, return a "needs chat" response. The client auto-slides into FoodChat with the conversation pre-seeded.

**Acceptance Criteria:**
- [ ] `analyzeFood()` sends all 5 tools with `tool_choice: auto`
- [ ] `analyzeFood()` requires `userId` and `currentDate` parameters
- [ ] System prompt includes data tool instructions and date context
- [ ] When Claude calls `report_nutrition`, the fast path returns `FoodAnalysis` (no UX change for simple foods)
- [ ] When Claude calls data tools or responds text-only, the API returns a "needs_chat" response
- [ ] On "needs_chat", the FoodAnalyzer auto-opens FoodChat with the conversation pre-seeded (user description + assistant message)
- [ ] No intermediate screen or confirmation between analysis and chat transition
- [ ] FoodChat handles seeded conversations correctly (sends all messages to API, not skipping first)
- [ ] Images are still sent with the first chat API call after seeding
- [ ] Existing fast-path behavior is unchanged for clear food descriptions
- [ ] All existing tests pass with updates for the new return type

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] No active PLANS.md

## Implementation Tasks

### Task 1: Define `AnalyzeFoodResult` discriminated union type

**Issue:** FOO-532
**Files:**
- `src/types/index.ts` (modify)

**TDD Steps:**

1. **RED** — No test needed for pure type definitions. TypeScript compiler validates usage.

2. **GREEN** — Add a discriminated union type to `src/types/index.ts`:
   - `AnalyzeFoodDirectResult`: `{ type: "analysis"; analysis: FoodAnalysis }` — Claude called report_nutrition directly
   - `AnalyzeFoodNeedsChatResult`: `{ type: "needs_chat"; message: string }` — Claude used data tools or responded with text only; `message` is Claude's text response
   - `AnalyzeFoodResult`: union of the two above
   - Export all three interfaces/types

**Notes:**
- The `message` field in `AnalyzeFoodNeedsChatResult` contains Claude's text response (e.g., "Let me check what you had yesterday..."). It becomes the first assistant message in the seeded chat.
- Follow existing pattern: use `interface` for the result shapes (per CLAUDE.md style preference)
- Place near the existing `FoodAnalysis` interface for cohesion

### Task 2: Modify `analyzeFood()` to support all tools with auto tool choice

**Issue:** FOO-532
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update existing `analyzeFood` tests in `src/lib/__tests__/claude.test.ts`:
   - Change expected return type from `FoodAnalysis` to `AnalyzeFoodResult`
   - Add test: when Claude returns `report_nutrition` tool_use, result is `{ type: "analysis", analysis: <validated> }`
   - Add test: when Claude returns text-only (no tool_use blocks), result is `{ type: "needs_chat", message: <text> }`
   - Add test: when Claude returns data tool_use (e.g., `search_food_log`) without report_nutrition, result is `{ type: "needs_chat", message: <text> }`
   - Add test: when Claude returns report_nutrition AND a data tool, result is `{ type: "analysis" }` (report_nutrition wins)
   - Add test: when Claude returns no text blocks and data tool calls, result is `{ type: "needs_chat", message: "" }` (empty message is acceptable)
   - Add test: `userId` and `currentDate` are now required (TypeScript enforces this)
   - Add test: all 5 tools are passed to the Claude API call (web_search + report_nutrition + 3 data tools)
   - Add test: `tool_choice` is `{ type: "auto" }` (not forced)
   - Add test: system prompt includes the current date
   - Run: `npm test -- claude`
   - Verify: new tests fail (analyzeFood still returns FoodAnalysis, uses forced tool_choice)

2. **GREEN** — Modify `analyzeFood()` in `src/lib/claude.ts`:
   - Change signature: `userId` and `currentDate` become required `string` parameters (remove `?`)
   - Change return type from `Promise<FoodAnalysis>` to `Promise<AnalyzeFoodResult>`
   - Create a new `ANALYSIS_SYSTEM_PROMPT` constant that extends `SYSTEM_PROMPT` with:
     - Instructions to use data tools when the user references past meals, history, or goals
     - Instruction to call `report_nutrition` immediately for clearly described foods
     - Web search guidelines (same as in `CHAT_SYSTEM_PROMPT`)
     - Append `currentDate` to the system prompt
   - Include all 5 tools: `WEB_SEARCH_TOOL`, `REPORT_NUTRITION_TOOL`, `SEARCH_FOOD_LOG_TOOL`, `GET_NUTRITION_SUMMARY_TOOL`, `GET_FASTING_INFO_TOOL`
   - Change `tool_choice` from `{ type: "tool", name: "report_nutrition" }` to `{ type: "auto" }`
   - After receiving response, branch:
     - Check if any content block is `type: "tool_use"` with `name: "report_nutrition"` → validate with `validateFoodAnalysis()`, return `{ type: "analysis", analysis }`
     - Otherwise → extract text from `TextBlock`s, return `{ type: "needs_chat", message }`
   - Run: `npm test -- claude`
   - Verify: all tests pass

3. **REFACTOR** — The new `ANALYSIS_SYSTEM_PROMPT` shares web search guidelines with `CHAT_SYSTEM_PROMPT`. If duplication is minimal, keep them separate for clarity. If significant, extract shared guidelines into a constant.

**Notes:**
- Reference `CHAT_SYSTEM_PROMPT` at `src/lib/claude.ts:30-60` for the style of data tool instructions
- Reference `DATA_TOOLS` array at `src/lib/claude.ts:573-577` for the tool imports
- Do NOT build a tool loop into `analyzeFood()` — the chat path's existing `runToolLoop` handles multi-turn tool execution
- Keep `max_tokens: 1024` — sufficient for both fast path (tool_use block) and needs-chat (short text + optional tool_use)
- Keep `cache_control` on system prompt and last tool (existing pattern)

### Task 3: Update `/api/analyze-food` route for new return type

**Issue:** FOO-532
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (create if doesn't exist, or modify)

**TDD Steps:**

1. **RED** — Check if route tests exist. If yes, update them for the new response shape. If no route-level tests exist (route is tested via integration/E2E), skip dedicated route tests and test through the component tests in Task 6.

2. **GREEN** — Modify the route handler:
   - Accept `clientDate` from FormData: `formData.get("clientDate")` as an optional string
   - Validate `clientDate` with `isValidDateFormat()` if provided; fall back to `getTodayDate()` (same pattern as `chat-food/route.ts:113-116`)
   - Pass `currentDate` to `analyzeFood()` as the new required parameter
   - `userId` is already available from `session!.userId` — pass it as required (currently passed as optional)
   - Return the `AnalyzeFoodResult` from `analyzeFood()` directly via `successResponse()` — the discriminated union serializes correctly to JSON
   - Run: `npm test -- analyze-food` (if route tests exist)
   - Verify: tests pass

3. **REFACTOR** — Ensure the imports from `date-utils` are added (`isValidDateFormat`, `getTodayDate`)

**Notes:**
- Reference `src/app/api/chat-food/route.ts:113-116` for the clientDate validation pattern
- The `successResponse()` wrapper already handles any data shape — no changes needed there
- No changes to rate limiting, auth, or image validation

### Task 4: Update FoodChat component to accept seeded conversations

**Issue:** FOO-532
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests in `src/components/__tests__/food-chat.test.tsx`:
   - Test: when `seedMessages` prop is provided, renders the seed messages (user bubble + assistant bubble)
   - Test: when `seedMessages` is provided, the initial message is NOT the default greeting
   - Test: when user sends a message in seeded conversation, ALL seed messages are included in the API request body (no `slice(1)` skipping)
   - Test: when `seedMessages` is NOT provided, existing behavior is unchanged (default greeting, slice(1) on API calls)
   - Test: `apiMessageCount` correctly excludes seed messages for limit tracking (seed messages don't count toward the 30-message limit — they represent the initial analysis turn, not chat refinements)
   - Run: `npm test -- food-chat`
   - Verify: new tests fail

2. **GREEN** — Modify `FoodChat` in `src/components/food-chat.tsx`:
   - Add optional prop: `seedMessages?: ConversationMessage[]`
   - When `seedMessages` is provided, initialize `messages` state with `seedMessages` instead of the auto-generated initial message
   - Track whether conversation is seeded (e.g., via a ref or derived from seedMessages presence)
   - When sending API messages: if seeded, send all messages (no `slice(1)`); if not seeded, keep existing `slice(1)` behavior
   - For `apiMessageCount` (used for limit tracking): when seeded, subtract the seed message count so the limit counts only user-initiated chat messages
   - Run: `npm test -- food-chat`
   - Verify: all tests pass

3. **REFACTOR** — Ensure no regressions in existing FoodChat behavior (initialAnalysis prop, compressedImages, photo handling)

**Notes:**
- Reference existing `initialMessage` logic at `src/components/food-chat.tsx:50-59`
- Reference `apiMessages` construction at `src/components/food-chat.tsx:226` (`allMessages.slice(1)`)
- The seed messages represent a user message (their description) + an assistant message (Claude's response). Both are "real" messages that should be sent to the chat API.
- `latestAnalysis` derivation at line 85-88 still works: it searches all messages for `.analysis` — seed messages won't have analysis attached, so `latestAnalysis` will be undefined initially. Once Claude calls `report_nutrition` in the chat flow, it updates correctly.
- Initial images (`compressedImages`) are still sent with the first user message via the `!initialImagesSent` logic — this works correctly for seeded conversations because the first `handleSend` triggers the image send.

### Task 5: Update FoodAnalyzer to handle new response shape and auto-transition

**Issue:** FOO-532
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add/update tests in `src/components/__tests__/food-analyzer.test.tsx`:
   - Update existing analysis success tests: mock API to return `{ type: "analysis", analysis: {...} }` instead of raw `FoodAnalysis`
   - Add test: when API returns `{ type: "needs_chat", message: "..." }`, FoodChat opens automatically
   - Add test: when auto-transitioning to chat, FoodChat receives `seedMessages` prop containing the user's description (as user message) and the API's message (as assistant message)
   - Add test: when auto-transitioning to chat, FoodChat receives `compressedImages` prop
   - Add test: `clientDate` is included in the FormData sent to `/api/analyze-food`
   - Add test: when API returns `{ type: "analysis" }`, existing behavior is unchanged (shows AnalysisResult, not FoodChat)
   - Run: `npm test -- food-analyzer`
   - Verify: new tests fail

2. **GREEN** — Modify `FoodAnalyzer` in `src/components/food-analyzer.tsx`:
   - Add state for seed messages: `seedMessages` (type `ConversationMessage[] | null`)
   - In `handleAnalyze()`: append `clientDate` to FormData using `getTodayDate()`
   - Update the response handling after the fetch:
     - If `result.data.type === "analysis"`: set `analysis` state as before (extract from `result.data.analysis`)
     - If `result.data.type === "needs_chat"`: construct seed messages array (user message from description input + assistant message from `result.data.message`), set `seedMessages` state, open chat (`setChatOpen(true)`)
   - In the render section where `chatOpen && analysis` currently gates the FoodChat, change to also handle the seeded case: render FoodChat when `chatOpen && (analysis || seedMessages)`
   - When rendering FoodChat with seedMessages: pass `seedMessages` prop, pass `compressedImages`, do NOT pass `initialAnalysis` (there is none yet)
   - When FoodChat is opened via needs_chat, the `onLogged` callback should still work — it receives the analysis from the chat flow
   - In `resetAnalysisState()`: also clear `seedMessages`
   - Run: `npm test -- food-analyzer`
   - Verify: all tests pass

3. **REFACTOR** — Verify the `onClose` callback from FoodChat correctly returns to the analyze screen and clears seedMessages

**Notes:**
- Reference existing chat-open logic at `src/components/food-analyzer.tsx:464-477`
- Reference `handleAnalyze` fetch at lines 157-178
- The user message in seed messages should use the `description` state value. If the user only provided photos (no description), use a default like "Analyze this food." to match the existing behavior in `analyzeFood()` line 324
- The match search (`/api/find-matches`) should only fire for the "analysis" case, not for "needs_chat" — skip it when transitioning to chat
- Import `ConversationMessage` type and `getTodayDate` from their respective modules

### Task 6: Integration & Verification

**Issue:** FOO-532
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification (dev server):
   - [ ] Simple food description ("grilled chicken with rice") → immediate analysis result (fast path, no UX change)
   - [ ] History-referencing description ("same as yesterday but half") → auto-transitions to chat, Claude uses data tools
   - [ ] Description-only with no photos → both paths work
   - [ ] Photos with description → both paths work, images sent to chat on first message
   - [ ] After auto-transition to chat, "Log to Fitbit" button appears once Claude calls report_nutrition
   - [ ] Chat back button returns to analyze screen correctly
   - [ ] Existing "Refine with chat" button still works after fast-path analysis

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-532 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude returns no text and no tools | Return `{ type: "needs_chat", message: "" }` | Unit test |
| Claude returns report_nutrition with invalid data | Throw `ClaudeApiError` (existing behavior) | Unit test |
| analyzeFood called without userId/currentDate | TypeScript compilation error | Type system |
| API returns needs_chat but client fails to open chat | Error state shown in FoodAnalyzer | Component test |
| FoodChat with seedMessages receives API error | Existing error handling in FoodChat | Existing tests |

## Risks & Open Questions

- [ ] **Latency impact:** With `tool_choice: auto`, Claude may take slightly longer to decide whether to call report_nutrition vs asking a question. Monitor response times for simple foods to ensure fast path stays fast.
- [ ] **Prompt engineering:** The new `ANALYSIS_SYSTEM_PROMPT` needs to strongly prefer calling report_nutrition for clear food descriptions. If Claude becomes "chatty" for simple foods, the prompt may need tuning.
- [ ] **Token usage:** With 5 tools instead of 2, the tool definitions add ~500 input tokens per request. Minimal cost impact but worth noting.

## Scope Boundaries

**In Scope:**
- Enabling all 5 tools in initial analysis
- Auto-transition from analysis to chat on needs-chat response
- Seeding FoodChat with the initial conversation
- Updating types, API route, and both components

**Out of Scope:**
- Building a tool loop into `analyzeFood()` (explicitly excluded by issue)
- Streaming responses from the initial analysis
- Changes to the chat-food API route or `conversationalRefine()`
- Changes to the data tool implementations (`chat-tools.ts`)
- UI redesign of the analysis or chat screens

---

## Iteration 1

**Implemented:** 2026-02-15
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Task 1: Define `AnalyzeFoodResult` discriminated union type - Added interfaces and union type to `src/types/index.ts`
- Task 2: Modify `analyzeFood()` to support all tools with auto tool choice - Changed to `tool_choice: auto`, all 5 tools, new `ANALYSIS_SYSTEM_PROMPT`, discriminated return type
- Task 3: Update `/api/analyze-food` route for new return type - Added `clientDate` FormData field, updated response handling for discriminated union
- Task 4: Update FoodChat component to accept seeded conversations - Added `seedMessages` prop, conditional message initialization, adjusted API message construction
- Task 5: Update FoodAnalyzer to handle new response shape and auto-transition - Added `seedMessages` state, auto-chat on `needs_chat`, `clientDate` in FormData, defensive error handling
- Task 6: Integration & Verification - All 1812 tests pass, lint/typecheck/build clean

### Files Modified
- `src/types/index.ts` - Added `AnalyzeFoodDirectResult`, `AnalyzeFoodNeedsChatResult`, `AnalyzeFoodResult` types
- `src/lib/claude.ts` - New `ANALYSIS_SYSTEM_PROMPT`, changed `analyzeFood` signature/return type, all 5 tools with `tool_choice: auto`
- `src/lib/__tests__/claude.test.ts` - Updated 134 tests for new return type, added needs_chat/data tool/auto tests
- `src/app/api/analyze-food/route.ts` - Added `clientDate` extraction, updated `analyzeFood` call, discriminated union response handling
- `src/app/api/analyze-food/__tests__/route.test.ts` - Updated 24 tests for new response shape
- `src/components/food-chat.tsx` - Added `seedMessages` prop, `isSeeded` flag, conditional `slice(1)`, seed-aware `apiMessageCount`
- `src/components/__tests__/food-chat.test.tsx` - Added 5 seeded conversation tests
- `src/components/food-analyzer.tsx` - Added `seedMessages` state, `clientDate` in FormData, branching on `analysis`/`needs_chat`, defensive else branch
- `src/components/__tests__/food-analyzer.test.tsx` - Updated all mocks for new response shape, added 7 needs_chat/clientDate tests
- `src/components/__tests__/food-analyzer-reconnect.test.tsx` - Updated mocks for new response shape

### Linear Updates
- FOO-532: Todo → In Progress

### Pre-commit Verification
- bug-hunter: Found 3 medium bugs + 1 low, all real bugs fixed:
  - Fixed malformed API response handling (defensive else branch in FoodAnalyzer)
  - Fixed empty seed array edge case in FoodChat isSeeded check
  - Fixed FoodAnalysis optional-vs-nullable inconsistency (changed `?:` to required-but-nullable across type + 18 test files + quick-select.tsx)
  - Skipped timezone validation finding (false positive)
- verifier: All 1812 tests pass, zero warnings

### Continuation Status
All tasks completed.
