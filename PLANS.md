# Implementation Plan

**Created:** 2026-02-15
**Source:** Inline request: Integrate Claude native web_search tool into food chat and update ROADMAP
**Linear Issues:** [FOO-529](https://linear.app/lw-claude/issue/FOO-529/integrate-claude-web-search-tool-into-food-chat), [FOO-530](https://linear.app/lw-claude/issue/FOO-530/update-roadmap-remove-web-search-add-nutrition-database-api-idea)

## Context Gathered

### Codebase Analysis
- **Chat backend:** `src/lib/claude.ts` — `conversationalRefine()` → `runToolLoop()` is the only chat path (unified FoodChat/FreeChat)
- **Tool definitions:** `src/lib/chat-tools.ts` — 3 data tools (search_food_log, get_nutrition_summary, get_fasting_info) + report_nutrition in claude.ts
- **API route:** `src/app/api/chat-food/route.ts` — calls `conversationalRefine()` with messages, images, userId, currentDate, initialAnalysis, signal
- **SDK version:** `@anthropic-ai/sdk@0.74.0` — confirmed support for `WebSearchTool20250305`, `ServerToolUseBlock`, `WebSearchToolResultBlock`, `ToolUnion` types
- **Current tools array in conversationalRefine (line 460):** `[REPORT_NUTRITION_TOOL, ...DATA_TOOLS]`
- **Current tools default in runToolLoop (line 637):** `options?.tools ?? DATA_TOOLS`
- **Cache control pattern:** `toolsWithCache` spreads `cache_control: { type: "ephemeral" }` onto the last tool in the array
- **Tool loop filtering (line 731):** `response.content.filter((block) => block.type === "tool_use")` — already excludes `server_tool_use` blocks
- **ROADMAP.md lines 213-270:** "Web Search for Nutrition Info" feature spec (will be removed)
- **Test patterns:** `src/lib/__tests__/claude.test.ts` mocks `mockCreate` from SDK, tests `runToolLoop` with various response scenarios

### Key Technical Insight
The `web_search_20250305` tool is a **server-side tool** — the Anthropic API executes searches automatically within a single API call. No external API integration needed from our code. The response includes `server_tool_use` and `web_search_tool_result` content blocks alongside regular `text` and `tool_use` blocks. The existing tool loop already correctly handles this because it filters by `type === "tool_use"` only.

## Original Plan

### Task 1: Add web_search tool to chat and update system prompt
**Linear Issue:** [FOO-529](https://linear.app/lw-claude/issue/FOO-529/integrate-claude-web-search-tool-into-food-chat)

**Context:**
- The web_search tool uses a different type from custom tools: `{ type: "web_search_20250305", name: "web_search" }` (SDK type: `WebSearchTool20250305`)
- The `tools` parameter in `messages.create()` accepts `Array<ToolUnion>` which is a union of `Tool | WebSearchTool20250305 | ...`
- The `options.tools` type in `runToolLoop` must change from `Anthropic.Tool[]` to accept the union type
- Place web_search FIRST in the tools array so the cache_control spread (applied to LAST tool) targets a custom tool, not the server tool

**TDD Steps:**

1. **RED** — Add tests in `claude.test.ts`:
   - In the `conversationalRefine` describe block: test that `mockCreate` is called with a `tools` array containing an object with `type: "web_search_20250305"` and `name: "web_search"`. Assert it's the first element in the tools array.
   - In the `runToolLoop` describe block: test that when `runToolLoop` is called without explicit tools (standalone path), `mockCreate` is called with a `tools` array containing the web_search tool.
   - Test that `CHAT_SYSTEM_PROMPT` includes guidance about web search (e.g., contains "search the web" or similar).
   Run: `npm test -- claude`

2. **GREEN** — In `src/lib/claude.ts`:
   - Define `WEB_SEARCH_TOOL` constant with type `{ type: "web_search_20250305", name: "web_search" }` using `as const` for type narrowing
   - In `conversationalRefine` (line 460): change `allTools` to `[WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS]`
   - In `runToolLoop` (line 637): change the default from `DATA_TOOLS` to `[WEB_SEARCH_TOOL, ...DATA_TOOLS]`
   - Update the `options.tools` type in `runToolLoop` from `Anthropic.Tool[]` to `Array<Anthropic.Tool | Anthropic.WebSearchTool20250305>` (import the type from the SDK's messages module, or use `Anthropic.Messages.ToolUnion`)
   - Update `CHAT_SYSTEM_PROMPT` to add web search guidance after the existing rules. Guidance should cover: (a) when to search — specific restaurants, branded products, unfamiliar regional dishes, packaged foods with known labels; (b) when NOT to search — generic foods like "an apple", "grilled chicken with rice"; (c) cite the source — mention where the nutrition info came from; (d) fallback — if search returns nothing useful, estimate from training data and say so
   Run: `npm test -- claude`

3. **REFACTOR** — Export `WEB_SEARCH_TOOL` for test assertions. Verify the `toolsWithCache` spread still works correctly — since web_search is first and cache_control is applied to last, no type issues arise.

**Notes:**
- Also add web_search to `analyzeFood()` — users can type specific brands/restaurants in the description textarea (e.g., "This is a Big Mac from McDonald's"). Since `web_search_20250305` is a server-side tool, it executes transparently within the API call. The existing `tool_choice: { type: "tool", name: "report_nutrition" }` still works — Claude searches the web first (server-side), then calls report_nutrition with accurate data. Add `WEB_SEARCH_TOOL` to the `toolsWithCache` array in `analyzeFood()` (line 274), placing it before `REPORT_NUTRITION_TOOL`.
- The `toolsWithCache` map uses spread `{ ...tool, cache_control }` on the last element. Since web_search is first, it won't be spread. The last element is a regular `Anthropic.Tool` which supports cache_control.
- No domain restrictions — user explicitly requested open search on any domain
- Add a test in the `analyzeFood` describe block: verify `mockCreate` is called with a tools array containing the web_search tool

### Task 2: Verify tool loop handles web search response blocks
**Linear Issue:** [FOO-529](https://linear.app/lw-claude/issue/FOO-529/integrate-claude-web-search-tool-into-food-chat)

**Context:**
- When Claude uses web_search, the response contains `server_tool_use` (type: `"server_tool_use"`) and `web_search_tool_result` (type: `"web_search_tool_result"`) blocks
- These blocks are NOT `tool_use` blocks, so the existing filter `block.type === "tool_use"` correctly excludes them
- The response is pushed to `conversationMessages` as-is, preserving the web search blocks for conversation continuity
- However, we should add a test to verify this behavior explicitly

**TDD Steps:**

1. **RED** — Add test in `runToolLoop` describe block: mock a response with `stop_reason: "tool_use"` containing a mix of `server_tool_use`, `web_search_tool_result`, `text`, and a custom `tool_use` block (e.g., `search_food_log`). Verify that `executeTool` is called only for `search_food_log` (not for web_search). Verify the final result includes text from both the web search synthesis and the data tool response. Run: `npm test -- claude`

2. **GREEN** — The existing code should already pass this test. If TypeScript complains about unknown content block types in the mock, use type assertions. The key assertion: `executeTool` is called exactly once (for the data tool), not for the web search blocks.

3. **RED** — Add test: mock a response where Claude uses ONLY web_search (no custom tools) and returns `stop_reason: "end_turn"`. Response includes `server_tool_use`, `web_search_tool_result`, and `text` blocks. Verify the result message contains the text content. Run: `npm test -- claude`

4. **GREEN** — The existing `end_turn` code path handles this: it extracts `text` blocks and ignores other types. Should pass without code changes.

**Notes:**
- These tests document the expected behavior with web search responses. If the SDK type system prevents creating mock blocks with `server_tool_use` type, use `as unknown as Anthropic.ContentBlock` casts.
- No code changes expected — this task is pure verification with tests.

### Task 3: Update ROADMAP.md
**Linear Issue:** [FOO-530](https://linear.app/lw-claude/issue/FOO-530/update-roadmap-remove-web-search-add-nutrition-database-api-idea)

**Steps:**

1. Remove the "Web Search for Nutrition Info" section (lines 213-270) from ROADMAP.md — it's now being implemented via Linear
2. Update the Contents table at the top of the file to remove the Web Search row
3. Add a new feature section: "Full Tool Support in Initial Analysis" before the Conventions section. This feature should describe:
   - **Problem:** The initial food analysis (`analyzeFood()`) is a single-shot API call with forced `tool_choice: { type: "tool", name: "report_nutrition" }`. It can only use server-side tools (web_search). Users sometimes type rich queries in the description textarea like "similar to yesterday but half" or "same as Monday's lunch but without the bread" — these require data tools (`search_food_log`, `get_nutrition_summary`) which need a tool loop to execute.
   - **Goal:** Let the initial analysis use all available tools (data tools + web_search + report_nutrition) so users can reference their food history directly from the description textarea.
   - **Design:** Route the initial analysis through `runToolLoop()` instead of a single-shot API call. Change `tool_choice` from forced `report_nutrition` to `auto`. Claude searches the food log, gets context, then calls `report_nutrition` with the result. If Claude doesn't call `report_nutrition` after the loop, treat the response as text-only (prompt user to provide more info).
   - **Architecture:** Refactor `analyzeFood()` to accept `userId` and `currentDate` as required params (currently optional). Reuse existing `runToolLoop()` infrastructure. The API route (`/api/analyze-food`) already has the session — just pass userId/currentDate through. The `analyzeFood` → `conversationalRefine` boundary may blur — consider whether `analyzeFood()` should just call `conversationalRefine()` with a single user message.
   - **Edge Cases:** Claude uses data tools but never calls report_nutrition → return text response, no analysis. Tool loop exceeds MAX_ITERATIONS before reporting nutrition → return partial text. User provides photo + description that doesn't reference history → Claude skips data tools and calls report_nutrition directly (current behavior preserved).
   - **Implementation Order:** 1) Refactor `analyzeFood()` to use `runToolLoop()`. 2) Change tool_choice to auto. 3) Handle no-analysis responses. 4) Update tests.
4. Add a new feature section: "Nutrition Database API Integration" before the Conventions section. This feature should describe:
   - **Problem:** Claude's web search is a good fallback for looking up nutrition info, but a structured nutrition database would give more accurate, consistent results for branded and restaurant foods. However, the main nutrition databases (Nutritionix, FatSecret, USDA) are heavily US/Europe-focused and have poor coverage of Argentine foods and local restaurants.
   - **Goal:** Add a `search_nutrition_database` tool that queries a nutrition API for structured, verified nutrition data — complementing the existing web search with faster, more reliable results for foods that are in the database.
   - **Design:** Claude would have access to both web_search (built-in) and a dedicated nutrition database tool. For known brands/restaurants in the database, it uses the structured API. For everything else (especially Argentine/Latin American foods), it falls back to web search or its training data.
   - **Architecture:** Candidate APIs: FatSecret Platform (5K free calls/day, 1.9M+ foods in 56 countries, best free tier), USDA FoodData Central (free unlimited, US government data), Open Food Facts (free community data, 4M+ products). All are weak on Argentine food coverage.
   - **Edge Cases:** API returns no match → fall back to web search or estimation. API data conflicts with web search data → prefer structured API data. Rate limit hit → graceful degradation.
   - **Implementation Order:** 1) Evaluate API coverage for user's typical foods. 2) Integrate chosen API as a new chat tool. 3) System prompt guidance for tool selection priority.
5. Update the Contents table to include both new features

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Iteration 1

**Implemented:** 2026-02-15
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Task 1: Add web_search tool to chat and update system prompt (FOO-529) — Defined WEB_SEARCH_TOOL constant, added to analyzeFood/conversationalRefine/runToolLoop tools arrays, updated CHAT_SYSTEM_PROMPT with web search guidance, updated runToolLoop options.tools type to accept ToolUnion
- Task 2: Verify tool loop handles web search response blocks (FOO-529) — Added tests confirming server_tool_use and web_search_tool_result blocks are correctly ignored by the tool loop (existing code already handled this)
- Task 3: Update ROADMAP.md (FOO-530) — Removed "Web Search for Nutrition Info" section, added "Full Tool Support in Initial Analysis" and "Nutrition Database API Integration" features, updated Contents table

### Files Modified
- `src/lib/claude.ts` — Added WEB_SEARCH_TOOL constant, added to all tools arrays, updated runToolLoop options type, added web search guidance to CHAT_SYSTEM_PROMPT
- `src/lib/__tests__/claude.test.ts` — Added 8 new tests (web_search tool inclusion in analyzeFood/conversationalRefine/runToolLoop, web search response block handling, system prompt guidance), fixed existing test that assumed tools[0] was report_nutrition
- `ROADMAP.md` — Removed Web Search section, added Full Tool Support and Nutrition Database API sections, updated Contents table

### Linear Updates
- FOO-529: Todo → In Progress → Review
- FOO-530: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed (no bugs found)
- verifier: All 1791 tests pass, zero warnings

### Review Findings

Summary: 1 issue found (Single-agent review: security, reliability, quality)
- FIX: 1 issue — Linear issue created
- DISCARDED: 0 findings

**Issues requiring fix:**
- [MEDIUM] TIMEOUT: SDK client timeout (30s) not updated for web search latency (`src/lib/claude.ts:17`) — The Anthropic SDK `timeout: 30000` was set before web search was enabled. Web search adds 2-5s per search to individual API calls. In edge cases (multiple searches, slow network), a single API call could exceed 30s and timeout. The frontend timeout was bumped to 120s (FOO-525) but the SDK timeout was missed. Also, the comment `// 30 second timeout as per ROADMAP.md` now references a removed section.

### Linear Updates
- FOO-529: Review → Merge (original task completed)
- FOO-530: Review → Merge (original task completed)
- FOO-531: Created in Todo (Fix: SDK timeout for web search latency)

<!-- REVIEW COMPLETE -->

---

## Iteration 2

**Implemented:** 2026-02-15
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Fix 1: SDK timeout too tight for web search (FOO-531) — Increased SDK timeout from 30s to 60s, updated stale comment, added test asserting timeout configuration

### Files Modified
- `src/lib/claude.ts` — Changed timeout from 30000 to 60000, updated comment
- `src/lib/__tests__/claude.test.ts` — Added SDK constructor mock capture, added test for 60s timeout

### Linear Updates
- FOO-531: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 bug (incorrect analyzeFood call signature in test), fixed before proceeding
- verifier: All 1792 tests pass, zero warnings

### Continuation Status
All fix plan tasks completed.

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-531](https://linear.app/lw-claude/issue/FOO-531/increase-sdk-timeout-from-30s-to-60s-for-web-search-latency)

### Fix 1: SDK timeout too tight for web search
**Linear Issue:** [FOO-531](https://linear.app/lw-claude/issue/FOO-531/increase-sdk-timeout-from-30s-to-60s-for-web-search-latency)

1. Update test in `src/lib/__tests__/claude.test.ts` to assert SDK timeout is 60000 (if such a test exists, or add one)
2. Change `timeout: 30000` to `timeout: 60000` in `src/lib/claude.ts:17`
3. Update the stale comment from `// 30 second timeout as per ROADMAP.md` to `// 60 second timeout — accommodates web search latency`

---

## Plan Summary

**Objective:** Integrate Claude's native web_search tool into the food chat so Claude can look up real nutrition info from the web

**Request:** Enable Claude's built-in web_search_20250305 tool in chat, open to all domains. Remove web search from ROADMAP (it's being implemented). Add nutrition database API idea to ROADMAP noting limited usefulness in Argentina.

**Linear Issues:** FOO-529, FOO-530

**Approach:** Add the `web_search_20250305` server-side tool to the existing tools array in `conversationalRefine` and `runToolLoop`. This is a minimal integration — the Anthropic API handles search execution automatically, and the existing tool loop already correctly ignores server-side tool blocks. Update the system prompt with guidance on when to search vs. estimate. Add tests verifying web search blocks flow through the tool loop correctly.

**Scope:**
- Tasks: 3
- Files affected: 3 (claude.ts, claude.test.ts, ROADMAP.md)
- New tests: yes

**Key Decisions:**
- Use Claude's native `web_search_20250305` (not Jina or custom search APIs) — simplest integration, $10/1K searches, negligible for single-user
- No domain restrictions — open to all domains as requested
- Place web_search first in tools array to avoid cache_control spread issues
- Also add web_search to `analyzeFood()` — users type brand/restaurant names in the description textarea, and web_search is server-side so it works with forced tool_choice

**Risks/Considerations:**
- SDK v0.74.0 types are confirmed to support WebSearchTool20250305. If the TypeScript union type causes issues with the toolsWithCache spread, the fix is to handle server tools separately in the cache_control logic.
- Web search adds latency to API calls (~2-5s per search), but doesn't add tool loop iterations since it's handled server-side within a single API call.
- The client timeout was already bumped to 120s (FOO-525), which accommodates web search latency.
