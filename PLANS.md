# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-556-backlog-sprint
**Issues:** FOO-556, FOO-557, FOO-558, FOO-559, FOO-560
**Created:** 2026-02-17
**Last Updated:** 2026-02-17

## Summary

Implement all 5 backlog issues in a single sprint covering three feature areas:

1. **About Section** (FOO-556) — Settings page metadata display
2. **Food Reuse from Chat** (FOO-559 + FOO-560) — Prevent duplicate custom foods when Claude references existing entries
3. **SSE Streaming + Tool Visibility** (FOO-557 + FOO-558) — Stream Claude responses token-by-token and show tool usage indicators

## Issues

### FOO-556: Add About section to settings page

**Priority:** Low
**Labels:** Improvement
**Description:** The settings page has no app metadata. Users can't see version, environment, Fitbit mode, or Claude model without checking env vars or deployment logs.

**Acceptance Criteria:**
- [ ] `/api/health` returns version, environment name, Fitbit mode (live/dry-run), and Claude model
- [ ] New `AboutSection` client component styled like `ClaudeUsageSection` (card with border)
- [ ] Shows: version, environment, Fitbit mode, Claude model
- [ ] Includes external link to GitHub Releases (`https://github.com/lucaswall/food-scanner/releases`)
- [ ] Placed at the bottom of the settings page (after Claude Usage)
- [ ] Mobile-friendly layout, 44px touch targets on the link

### FOO-557: Claude API responses are not streamed — full latency felt as dead silence

**Priority:** Medium
**Labels:** Feature
**Description:** Both `/api/analyze-food` and `/api/chat-food` use synchronous request/response. The entire Claude tool loop runs server-side, and only the final result is returned. Users stare at a spinner for 5-30 seconds with zero feedback.

**Acceptance Criteria:**
- [ ] API routes use SSE (Server-Sent Events) via `ReadableStream` in Next.js App Router
- [ ] Claude API calls use `client.messages.stream()` for token-level streaming
- [ ] Chat text arrives token-by-token (word-by-word rendering like ChatGPT/Claude.ai)
- [ ] Analysis screen shows progressive feedback during Claude processing
- [ ] Error handling works correctly in streaming context (abort, timeout, API errors)
- [ ] Claude API usage tracking still works (fire-and-forget per iteration)
- [ ] All existing test coverage is maintained (updated for streaming)

### FOO-558: No visibility into tool usage during AI processing

**Priority:** Medium
**Labels:** Feature
**Description:** When Claude calls tools (web search, food log search, nutrition summary, fasting info), the user has no idea what's happening. Tool execution can take 5-15 seconds per iteration with zero feedback.

**Acceptance Criteria:**
- [ ] System prompts instruct Claude to emit brief thinking text before tool calls
- [ ] Chat: thinking messages appear as persistent italicized messages in conversation
- [ ] Analysis: tool indicators appear during processing (animated text or step-by-step display)
- [ ] Web search detectable via `server_tool_use` blocks, shown as "Searching the web..."
- [ ] One thinking indicator per tool batch is sufficient

### FOO-559: Claude tools don't carry customFoodId — chat food reuse creates duplicates

**Priority:** Medium
**Labels:** Feature
**Description:** When Claude finds a food via `search_food_log` and reports it via `report_nutrition`, the existing `customFoodId` is lost. Every food reported from chat creates a duplicate `custom_food` row.

**Acceptance Criteria:**
- [ ] `search_food_log` response includes `customFoodId` for each entry
- [ ] `report_nutrition` schema has `source_custom_food_id` field (`[number, null]`)
- [ ] System prompts instruct Claude to pass through `source_custom_food_id` when reusing existing food
- [ ] `validateFoodAnalysis()` extracts and passes through `sourceCustomFoodId`

### FOO-560: Chat logging path ignores source food reference — can't reuse existing custom foods

**Priority:** Medium
**Labels:** Feature
**Description:** Even with `source_custom_food_id` in `report_nutrition`, the client has no way to pass it through to `/api/log-food`. Completes the food reuse feature end-to-end.

**Acceptance Criteria:**
- [ ] `FoodAnalysis` type has optional `sourceCustomFoodId?: number` field
- [ ] `food-chat.tsx` `handleLog()` sends `reuseCustomFoodId` when `sourceCustomFoodId` is set
- [ ] `food-analyzer.tsx` skips `/api/find-matches` when `sourceCustomFoodId` is present
- [ ] `food-analyzer.tsx` `handleLogToFitbit()` maps `sourceCustomFoodId` to `reuseCustomFoodId`
- [ ] Fallback: if referenced food no longer exists, normal new-food flow applies

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Node modules installed (`npm install`)
- [ ] All current tests passing (`npm test`)

## Implementation Tasks

Tasks are organized by domain. Dependencies between domains are noted explicitly.

**Domain dependency graph:**
- **A** (About Section) — independent, can run in parallel with anything
- **B** (Claude-Side Food Reuse) — independent
- **C** (Client-Side Food Reuse) — depends on B
- **D** (SSE Streaming) — depends on B+C being merged (touches same files: `claude.ts`, `food-chat.tsx`, `food-analyzer.tsx`)
- **E** (Tool Indicators) — depends on D

**Recommended execution order:**
1. Domains A + B in parallel
2. Domain C (after B merges)
3. Domain D (after C merges — largest body of work)
4. Domain E (after D merges)

---

### Domain A: About Section (FOO-556)

#### Task 1: Extend `/api/health` to return about info

**Issue:** FOO-556
**Files:**
- `src/app/api/health/route.ts` (modify)
- `src/app/api/health/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for the health endpoint:
   - Test that GET returns `{ status: "ok", version: string, environment: string, fitbitMode: string, claudeModel: string }`
   - Test that `version` matches `package.json` version field
   - Test that `environment` is derived from `APP_URL`: contains "food-test" = "Staging", otherwise = "Production"
   - Test that `fitbitMode` reflects `FITBIT_DRY_RUN` env var: "true" = "Dry Run", absent = "Live"
   - Test that `claudeModel` is the model string from `claude.ts`
   - Run: `npm test -- health`
   - Verify: Tests fail (endpoint only returns `{ status: "ok" }`)

2. **GREEN** — Update the health route handler:
   - Import version from `package.json` (static import or read at module level)
   - Export `CLAUDE_MODEL` from `src/lib/claude.ts` (it's already a module-level const)
   - Derive environment label from `APP_URL` env var
   - Derive Fitbit mode from `FITBIT_DRY_RUN` env var
   - Return all fields alongside existing `status: "ok"`
   - Run: `npm test -- health`
   - Verify: Tests pass

3. **REFACTOR** — Ensure response shape is clean, no unnecessary fields exposed

**Notes:**
- The health endpoint is public (no auth required) — this info is non-sensitive
- Reference `CLAUDE_MODEL` const at `src/lib/claude.ts:10`
- `APP_URL` is already in Railway env vars (see `.env.sample`)

#### Task 2: Create `AboutSection` component

**Issue:** FOO-556
**Files:**
- `src/components/about-section.tsx` (create)
- `src/components/__tests__/about-section.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write component tests:
   - Test loading state shows skeleton placeholder
   - Test successful data renders version, environment, Fitbit mode, Claude model
   - Test GitHub Releases link is present with correct href and `target="_blank"` + `rel="noopener noreferrer"`
   - Test error state shows error message
   - Mock `useSWR` with different states (loading, success, error)
   - Run: `npm test -- about-section`
   - Verify: Tests fail (component doesn't exist)

2. **GREEN** — Create the component:
   - `"use client"` component
   - Fetch from `/api/health` via `useSWR` with `apiFetcher` from `src/lib/swr.ts`
   - Render inside a Card component styled like `ClaudeUsageSection` (reference `src/components/claude-usage-section.tsx` for exact card pattern)
   - Display: Version (badge or monospace), Environment, Fitbit Mode, Claude Model
   - External link to `https://github.com/lucaswall/food-scanner/releases` with 44px touch target
   - Loading skeleton matching final layout
   - Error state with retry option
   - Run: `npm test -- about-section`
   - Verify: Tests pass

3. **REFACTOR** — Ensure consistent spacing and typography with existing sections

**Notes:**
- Follow `ClaudeUsageSection` pattern: `useSWR` → Card → content layout
- Reference: `src/components/claude-usage-section.tsx` for styling pattern
- Reference: `src/lib/swr.ts` for shared fetcher

#### Task 3: Wire `AboutSection` into settings page

**Issue:** FOO-556
**Files:**
- `src/app/settings/page.tsx` (modify)
- `src/app/settings/__tests__/page.test.tsx` (modify, if exists)

**TDD Steps:**

1. **RED** — Add or update test for settings page to verify `AboutSection` renders after `ClaudeUsageSection`
   - Run: `npm test -- settings`
   - Verify: Test fails (AboutSection not rendered)

2. **GREEN** — Import and render `AboutSection` in the settings page:
   - Place after the `ClaudeUsageSection` div with `mt-6` spacing
   - Wrap in a `div` with matching `mt-6` class
   - Run: `npm test -- settings`
   - Verify: Tests pass

3. **REFACTOR** — Verify visual layout on mobile viewport

**Notes:**
- Settings page at `src/app/settings/page.tsx` currently renders: `SettingsContent`, `ApiKeyManager`, `ClaudeUsageSection`
- AboutSection goes last (after Claude Usage), per acceptance criteria

---

### Domain B: Claude-Side Food Reuse (FOO-559)

#### Task 4: Include customFoodId in search_food_log response text

**Issue:** FOO-559
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update tests for `executeSearchFoodLog`:
   - For query-only search (Case 1): verify each food entry line includes `[id:N]` prefix where N is the `customFoodId`
   - For date search (Case 2): verify each entry line includes `[id:N]` prefix
   - For date range (Case 3): verify each entry line includes `[id:N]` prefix
   - Run: `npm test -- chat-tools`
   - Verify: Tests fail (current output has no IDs)

2. **GREEN** — Update the three response formatters in `executeSearchFoodLog`:
   - Case 1 (query, line ~148-153): Prepend `[id:${food.customFoodId}]` to each food line. The `CommonFood` type already has `customFoodId`.
   - Case 2 (date, line ~170-178): The entries come from `getDailyNutritionSummary` which returns `MealEntry` objects. These have `id` (food_log_entry ID) but NOT `customFoodId`. Need to check if `MealEntry` can be extended, OR use `getFoodLogHistory` which returns `FoodLogHistoryEntry` with `id`. The `id` on `MealEntry` is the food_log_entry ID — not the custom_food ID. Must investigate what's available. If the data path doesn't include `customFoodId`, the date case may need a different approach (e.g., query custom_foods join). Alternatively, use the food_log_entry `id` as a reference that the client can look up — but `reuseCustomFoodId` expects a custom_food ID, not a log entry ID.
   - Case 3 (date range, line ~197-203): Same consideration as Case 2.
   - For Case 2 and Case 3, the implementer must check if the data path surfaces `customFoodId`. If not, augment the query or use a different data source. The `food_log_entries` table has a `custom_food_id` FK — it should be joinable.
   - Run: `npm test -- chat-tools`
   - Verify: Tests pass

3. **REFACTOR** — Ensure ID format is consistent across all three cases

**Notes:**
- `CommonFood` type (used in Case 1) already has `customFoodId` field — see `src/types/index.ts:167`
- `MealEntry` type (used in Case 2) has `id` but that's the log entry ID, not custom food ID — see `src/types/index.ts:269`
- The implementer needs to check `getDailyNutritionSummary` in `src/lib/food-log.ts` to see if custom_food_id is available in the query, and extend it if needed
- `FoodLogHistoryEntry` (used in Case 3) has `id` which is also the log entry ID — same gap as Case 2
- The key insight: `food_log_entries.custom_food_id` exists in the schema (`src/db/schema.ts`), so the queries CAN be extended to include it

#### Task 5: Add source_custom_food_id to report_nutrition schema + update prompts + validation

**Issue:** FOO-559
**Files:**
- `src/lib/claude.ts` (modify — REPORT_NUTRITION_TOOL, CHAT_SYSTEM_PROMPT, ANALYSIS_SYSTEM_PROMPT, validateFoodAnalysis)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update tests:
   - Test that `REPORT_NUTRITION_TOOL.input_schema.properties` includes `source_custom_food_id` with type `["number", "null"]`
   - Test that `REPORT_NUTRITION_TOOL.input_schema.required` includes `"source_custom_food_id"`
   - Test `validateFoodAnalysis` with `source_custom_food_id: 42` returns `sourceCustomFoodId: 42`
   - Test `validateFoodAnalysis` with `source_custom_food_id: null` returns `sourceCustomFoodId: undefined`
   - Test `validateFoodAnalysis` with missing `source_custom_food_id` returns `sourceCustomFoodId: undefined`
   - Test `validateFoodAnalysis` rejects `source_custom_food_id: "string"` (invalid type)
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Implement changes:
   - Add `source_custom_food_id` property to `REPORT_NUTRITION_TOOL.input_schema.properties` with type `["number", "null"]` and description explaining: "ID of an existing custom food from search_food_log results. Set to the [id:N] value when reusing a food exactly as-is. Set to null when creating new food or when modifying nutrition values."
   - Add `"source_custom_food_id"` to the `required` array (strict mode requires all fields)
   - Update `validateFoodAnalysis` to extract `source_custom_food_id`: if number > 0, set `sourceCustomFoodId` on the returned object; if null/undefined/0, omit it
   - Update `CHAT_SYSTEM_PROMPT`: add instruction — "When reporting food that came directly from search_food_log results without modification, include the `source_custom_food_id` from the [id:N] prefix. When modifying nutrition values (half portion, different ingredients), set source_custom_food_id to null."
   - Update `ANALYSIS_SYSTEM_PROMPT` similarly for the analysis path
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Ensure prompt additions are concise and well-placed within the existing prompt structure

**Notes:**
- The `strict: true` mode on the tool means ALL properties must be in `required` — use `["number", "null"]` type to allow null values (same pattern as `saturated_fat_g`, `trans_fat_g`, etc.)
- `validateFoodAnalysis` currently returns a `FoodAnalysis` object — the `sourceCustomFoodId` field will be added to `FoodAnalysis` in Task 6 (Domain C). For now, add it to the return object and it will satisfy the type once Domain C updates the type. Alternatively, add it as an extra property that TypeScript won't complain about.
- **Cross-domain note:** This task adds the field to the Claude tool and validation. Task 6 adds the field to the TypeScript type. These can be developed in any order but must both be present before integration testing.

---

### Domain C: Client-Side Food Reuse (FOO-560) — depends on Domain B

#### Task 6: Add sourceCustomFoodId to FoodAnalysis type

**Issue:** FOO-560
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/claude.ts` (modify — validateFoodAnalysis return type alignment)

**TDD Steps:**

1. **RED** — Verify TypeScript compilation with `sourceCustomFoodId` usage:
   - Add a test or type assertion that `FoodAnalysis` accepts optional `sourceCustomFoodId?: number`
   - Run: `npm run typecheck`
   - Verify: Type error (field doesn't exist)

2. **GREEN** — Add the field:
   - Add `sourceCustomFoodId?: number` to `FoodAnalysis` interface in `src/types/index.ts` (after `keywords`)
   - Confirm `validateFoodAnalysis` in `claude.ts` (modified in Task 5) now type-checks correctly
   - Run: `npm run typecheck`
   - Verify: No type errors

3. **REFACTOR** — No refactoring needed; this is a type-only change

**Notes:**
- `FoodAnalysis` is at `src/types/index.ts:55-73`
- The field is optional (not all analyses will have it) — only present when Claude references an existing food
- `FoodLogRequest extends FoodAnalysis` — adding an optional field to FoodAnalysis doesn't break the extension

#### Task 7: Wire food reuse through chat and analyzer components

**Issue:** FOO-560
**Files:**
- `src/components/food-chat.tsx` (modify — handleLog)
- `src/components/food-analyzer.tsx` (modify — handleLogToFitbit, find-matches skip)
- `src/components/__tests__/food-chat.test.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for food-chat reuse behavior:
   - Test that when `latestAnalysis.sourceCustomFoodId` is set, `handleLog` sends `{ reuseCustomFoodId: N, mealTypeId, date, time }` instead of `{ ...analysis, mealTypeId, date, time }`
   - Test that when `latestAnalysis.sourceCustomFoodId` is undefined, `handleLog` sends full analysis (existing behavior)
   - Write tests for food-analyzer reuse behavior:
   - Test that when `analysis.sourceCustomFoodId` is set, `/api/find-matches` is NOT called
   - Test that when `analysis.sourceCustomFoodId` is set, `handleLogToFitbit` sends `{ reuseCustomFoodId: N, mealTypeId, date, time }`
   - Test that when `analysis.sourceCustomFoodId` is undefined, find-matches fires and handleLogToFitbit sends full analysis (existing behavior)
   - Run: `npm test -- food-chat food-analyzer`
   - Verify: Tests fail

2. **GREEN** — Implement the wiring:
   - **food-chat.tsx `handleLog()`** (line ~328-336): Before spreading `...analysis`, check `analysis.sourceCustomFoodId`. If set, construct the request body as `{ reuseCustomFoodId: analysis.sourceCustomFoodId, mealTypeId, ...getLocalDateTime() }` (the reuse path). If unset, keep existing `{ ...analysis, mealTypeId, ...getLocalDateTime() }` behavior.
   - **food-analyzer.tsx `handleAnalyze()`** (line ~188-204): After receiving analysis result, check `result.data.analysis.sourceCustomFoodId`. If set, skip the `/api/find-matches` call entirely. If unset, fire the match search as before.
   - **food-analyzer.tsx `handleLogToFitbit()`** (line ~258-266): Same pattern as food-chat — check `analysis.sourceCustomFoodId`, use reuse path if set.
   - Run: `npm test -- food-chat food-analyzer`
   - Verify: Tests pass

3. **REFACTOR** — Extract the "build log request body" logic into a shared helper if the pattern is duplicated between food-chat and food-analyzer. Consider a utility in `src/lib/` that takes `analysis` + `mealTypeId` + datetime and returns the correct request body.

**Notes:**
- The reuse request body format is `{ reuseCustomFoodId, mealTypeId, date, time }` — see `/api/log-food` validation at `src/app/api/log-food/route.ts:29-39`
- The new-food request body format is `{ ...analysis, mealTypeId, date, time }` — existing behavior
- No changes needed to `/api/log-food` — the `reuseCustomFoodId` path already works (lines 174-292)
- Metadata updates (`newDescription`, `newNotes`, `newKeywords`, `newConfidence`) can be included in the reuse request when the user refines in chat — include from `analysis` if available

---

### Domain D: SSE Streaming Infrastructure (FOO-557) — depends on Domains B+C

This is the largest domain. It replaces synchronous JSON responses with Server-Sent Events for both `/api/analyze-food` and `/api/chat-food`.

**Architecture overview:**
- Server: `runToolLoop` becomes an async generator yielding `StreamEvent` objects
- Server: API routes create a `ReadableStream` from the generator, formatted as SSE
- Client: Replaces `fetch → response.json()` with `fetch → response.body.getReader()` + SSE parsing
- Client: Text renders token-by-token; analysis arrives as a discrete event

#### Task 8: Define SSE event protocol and streaming utilities

**Issue:** FOO-557
**Files:**
- `src/lib/sse.ts` (create)
- `src/lib/__tests__/sse.test.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for SSE utilities:
   - Test `formatSSEEvent` correctly formats a `StreamEvent` as `data: {json}\n\n`
   - Test `createSSEResponse` creates a `Response` with correct headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
   - Test `createSSEResponse` correctly streams events from an async generator
   - Test `parseSSEEvents` (client-side parser) correctly extracts events from SSE text chunks
   - Test parser handles partial chunks (data split across reads)
   - Run: `npm test -- sse`
   - Verify: Tests fail (module doesn't exist)

2. **GREEN** — Create the SSE module:
   - Define `StreamEvent` type union:
     - `{ type: "text_delta"; text: string }` — incremental text token
     - `{ type: "tool_start"; tool: string }` — tool execution beginning
     - `{ type: "analysis"; analysis: FoodAnalysis }` — validated food analysis
     - `{ type: "needs_chat"; message: string }` — analysis requires chat transition
     - `{ type: "usage"; data: { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number } }` — per-iteration usage
     - `{ type: "error"; message: string; code?: string }` — error
     - `{ type: "done" }` — stream complete
   - Implement `formatSSEEvent(event: StreamEvent): string` — JSON serializes the event and wraps in SSE format
   - Implement `createSSEResponse(generator: AsyncGenerator<StreamEvent>): Response` — creates a ReadableStream that consumes the generator and writes formatted SSE events, returns Response with correct headers
   - Implement `parseSSEEvents(chunk: string, buffer: string): { events: StreamEvent[]; remaining: string }` — client-side utility to parse SSE text (handles partial chunks by maintaining a buffer)
   - Run: `npm test -- sse`
   - Verify: Tests pass

3. **REFACTOR** — Ensure types are exported and usable by both server and client code

**Notes:**
- SSE format: each event is `data: {json}\n\n` (double newline separator)
- The `StreamEvent` type will be imported by both API routes (server) and components (client)
- Place in `src/lib/` since it's shared between server and client
- The `parseSSEEvents` function is for client-side use — it must handle the case where a chunk splits a JSON payload across two reads

#### Task 9: Convert Claude API layer to streaming generators

**Issue:** FOO-557
**Files:**
- `src/lib/claude.ts` (major refactor — runToolLoop, analyzeFood, conversationalRefine)
- `src/lib/__tests__/claude.test.ts` (major update)

**TDD Steps:**

1. **RED** — Update tests for the new streaming signatures:
   - **runToolLoop tests:** Change from asserting on `Promise<{message, analysis}>` to consuming `AsyncGenerator<StreamEvent>`. Collect all yielded events into an array and assert:
     - For a simple end_turn response: yields `text_delta` events + optional `analysis` + `done`
     - For a tool_use response: yields `text_delta` + `tool_start` + more `text_delta` + `analysis` + `done`
     - For multi-iteration: yields events across iterations with `tool_start` between them
     - For report_nutrition in tool_use: yields `analysis` event with validated data
     - For max iterations exceeded: yields `error` event
   - **analyzeFood tests:** Change return type to `AsyncGenerator<StreamEvent>`. Assert:
     - Fast path (report_nutrition immediately): yields `analysis` + `done`
     - Slow path (data tools): yields tool loop events
     - Needs chat: yields `needs_chat` + `done`
   - **conversationalRefine tests:** Same pattern as analyzeFood
   - Mock `client.messages.stream()` instead of `client.messages.create()`. The stream mock should emit events matching the Anthropic SDK streaming format: `content_block_start`, `content_block_delta` (text_delta), `content_block_stop`, `message_stop`, plus `finalMessage()` returning the complete message.
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Rewrite the core functions:
   - **`runToolLoop`**: Change signature from `Promise<{message, analysis}>` to `AsyncGenerator<StreamEvent>`. Replace `client.messages.create()` with `client.messages.stream()`. For each streaming response:
     - As `content_block_delta` events arrive with `text_delta` type, yield `{ type: "text_delta", text }` immediately
     - Accumulate `tool_use` blocks as they complete (via `content_block_stop`)
     - After stream completes, check `finalMessage().stop_reason`:
       - `end_turn`: extract analysis if present (yield `analysis`), yield `done`, return
       - `tool_use`: yield `tool_start` events for each tool, execute tools in parallel, add results to conversation, continue loop
     - Yield `usage` event after each iteration with token counts
     - Record usage (fire-and-forget) as before
   - **`analyzeFood`**: Change signature to `AsyncGenerator<StreamEvent>`. Make the initial Claude call streaming. Handle fast path (report_nutrition in first response — yield `analysis` + `done`), slow path (delegate to `runToolLoop` generator via `yield*`), and text-only path (yield `needs_chat` + `done`).
   - **`conversationalRefine`**: Same pattern as `analyzeFood` — streaming initial call, delegate to `runToolLoop` if data tools present.
   - Keep all existing logic: truncation, cache_control, system prompt construction, data tool execution, pending analysis tracking, usage recording
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Extract shared streaming setup (system prompt with cache, tools with cache, conversation construction) into helper functions to reduce duplication between `analyzeFood` and `conversationalRefine`

**Notes:**
- The Anthropic SDK `client.messages.stream()` returns a `MessageStream` that is async-iterable and has a `.finalMessage()` method
- `server_tool_use` blocks (web search) appear as content blocks — detect these and yield `tool_start` events with tool name "web_search"
- Data tool blocks (search_food_log, etc.) are regular `tool_use` blocks
- The `pendingAnalysis` pattern (storing report_nutrition from a tool_use response to return later) must be preserved — yield the `analysis` event when the pending analysis is used
- Important: the old non-streaming function signatures (`analyzeFood` returning `Promise<AnalyzeFoodResult>`) are removed — they're fully replaced by generators
- `signal` (AbortSignal) handling: pass to `client.messages.stream()` and check `signal.aborted` between iterations

#### Task 10: Convert API routes to SSE endpoints

**Issue:** FOO-557
**Files:**
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/chat-food/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify)
- `src/app/api/chat-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update route tests:
   - Test that POST returns a Response with `Content-Type: text/event-stream`
   - Test that the response body is a ReadableStream
   - Test that consuming the stream yields valid SSE events
   - Test that validation errors (missing images, invalid body, rate limit) still return JSON error responses (NOT SSE) — validation happens before streaming starts
   - Test abort signal handling — if client disconnects, stream closes cleanly
   - Run: `npm test -- analyze-food chat-food`
   - Verify: Tests fail

2. **GREEN** — Update both routes:
   - **`/api/analyze-food`**: Keep all existing validation logic (session, rate limit, form data, images). After validation passes, call the streaming `analyzeFood()` generator and pass it to `createSSEResponse()` from `src/lib/sse.ts`. Wrap in try/catch — if the generator throws during setup, return a JSON error response.
   - **`/api/chat-food`**: Same pattern — keep validation, then stream `conversationalRefine()` via `createSSEResponse()`.
   - Both routes: pass `request.signal` through to the generators for abort handling
   - Run: `npm test -- analyze-food chat-food`
   - Verify: Tests pass

3. **REFACTOR** — Factor out the common "validate then stream" pattern if it reduces duplication

**Notes:**
- Validation errors should remain as JSON responses (`errorResponse()`) — the client needs to handle these before attempting SSE parsing
- The route tests should use a helper to consume the ReadableStream and parse SSE events — can reuse `parseSSEEvents` from `src/lib/sse.ts`
- Reference existing route test patterns in `src/app/api/analyze-food/__tests__/route.test.ts`

#### Task 11: Update food-analyzer.tsx to consume SSE stream

**Issue:** FOO-557
**Files:**
- `src/components/food-analyzer.tsx` (modify — handleAnalyze)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/hooks/use-streaming-analysis.ts` (create — optional, if extraction helps)
- `src/hooks/__tests__/use-streaming-analysis.test.ts` (create — optional)

**TDD Steps:**

1. **RED** — Write tests for streaming analysis behavior:
   - Test that during analysis, loading state updates as `text_delta` events arrive (progressive feedback)
   - Test that when `analysis` event arrives, analysis state is set and loading ends
   - Test that when `needs_chat` event arrives, chat transition happens (existing behavior)
   - Test that when `error` event arrives, error state is set
   - Test that abort (user cancels) works correctly
   - Test that `/api/find-matches` still fires after analysis (unless `sourceCustomFoodId` is set — from Task 7)
   - Mock `fetch` to return a ReadableStream of SSE events (use `ReadableStream` constructor with a `start` controller that enqueues encoded SSE text)
   - Run: `npm test -- food-analyzer`
   - Verify: Tests fail

2. **GREEN** — Update `handleAnalyze()`:
   - Replace the existing `fetch → response.json()` pattern with `fetch → response.body.getReader()` + SSE event parsing
   - Use `parseSSEEvents` from `src/lib/sse.ts` to parse chunks
   - Handle each event type:
     - `text_delta`: update `loadingStep` state with accumulated text (shows what Claude is thinking/doing)
     - `tool_start`: update `loadingStep` with tool description (e.g., "Searching web..." for web_search)
     - `analysis`: set `analysis` state, fire find-matches if appropriate
     - `needs_chat`: set up seed messages and open chat
     - `error`: set error state
     - `done`: end loading state
   - Handle non-SSE responses (validation errors return JSON) — check `Content-Type` header before attempting SSE parsing
   - Run: `npm test -- food-analyzer`
   - Verify: Tests pass

3. **REFACTOR** — Consider extracting the SSE consumption logic into a custom hook (`useStreamingAnalysis`) if the handler is too complex

**Notes:**
- The `loadingStep` state already exists in food-analyzer.tsx (line 42) — used for "Preparing images...", "Analyzing food...". The streaming version will update it with Claude's progressive output.
- The analysis screen shows the `AnalysisResult` component with `loadingStep` prop — this will naturally display streaming updates
- The abort controller pattern already exists (line 55, `abortControllerRef`) — SSE reader cleanup should use this
- Important: keep the FormData request format for `/api/analyze-food` — only the response format changes from JSON to SSE

#### Task 12: Update food-chat.tsx to consume SSE stream with token-by-token rendering

**Issue:** FOO-557
**Files:**
- `src/components/food-chat.tsx` (modify — handleSend)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for streaming chat behavior:
   - Test that during message processing, text appears incrementally (not all at once)
   - Test that an empty assistant message appears immediately when loading starts
   - Test that `text_delta` events append to the growing assistant message
   - Test that `analysis` events set the analysis on the assistant message
   - Test that `tool_start` events are indicated in the UI (can test for presence of tool indicator element)
   - Test that `error` events show error state
   - Test that abort/timeout works correctly
   - Mock `fetch` to return a ReadableStream of SSE events
   - Run: `npm test -- food-chat`
   - Verify: Tests fail

2. **GREEN** — Update `handleSend()`:
   - Replace `fetch → response.json()` with `fetch → response.body.getReader()` + SSE parsing
   - When sending starts: immediately append an empty assistant message to the messages array (this is the bubble that will fill with text)
   - As `text_delta` events arrive: update the last assistant message's `content` field with appended text — use a state update pattern that doesn't re-render the entire list (functional updater)
   - As `analysis` events arrive: update the last assistant message's `analysis` field
   - As `tool_start` events arrive: the thinking text from Claude (emitted before the tool call) is already in the message via `text_delta`. No additional UI needed here for FOO-557 — tool indicators are addressed in FOO-558.
   - As `error` events arrive: revert the empty assistant message, show error
   - As `done` events arrive: finalize loading state
   - Handle non-SSE responses (validation errors) — same as Task 11
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

3. **REFACTOR** — The current `handleSend` is ~80 lines — the streaming version will be longer. Consider extracting the SSE consumption into a `useStreamingChat` hook or a standalone function that returns a callback.

**Notes:**
- The key UX change: text appears word-by-word instead of all-at-once. This is the primary user-facing improvement.
- For the chat, `text_delta` events between tool loops may create separate "paragraphs" of thinking text followed by the final response. The implementer should consider whether to show all text in one message or split thinking text into separate messages.
- The error recovery pattern (revert message, restore input) at lines 298-313 must be preserved
- The `120000ms` timeout on `AbortSignal.timeout` should be kept — streaming doesn't eliminate the overall timeout need
- `ChatFoodResponse` type in `src/types/index.ts` is no longer used for the streaming path — but keep it for type reference. The actual response is now a stream of events.

---

### Domain E: Tool Usage Indicators (FOO-558) — depends on Domain D

#### Task 13: Update system prompts for thinking text before tool calls

**Issue:** FOO-558
**Files:**
- `src/lib/claude.ts` (modify — CHAT_SYSTEM_PROMPT, ANALYSIS_SYSTEM_PROMPT)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests that verify prompt content:
   - Test that `CHAT_SYSTEM_PROMPT` contains instruction to emit thinking text before tool calls
   - Test that `ANALYSIS_SYSTEM_PROMPT` contains the same instruction
   - Run: `npm test -- claude`
   - Verify: Tests fail (prompts don't contain thinking instruction)

2. **GREEN** — Add thinking text instruction to both prompts:
   - Add to both `CHAT_SYSTEM_PROMPT` and `ANALYSIS_SYSTEM_PROMPT`: "Before calling any tool, emit a brief natural-language sentence describing what you're about to do (e.g., 'Let me check your food history...', 'Looking up nutrition info for this restaurant...', 'Checking your fasting patterns...'). This gives the user real-time feedback. Keep it to one short sentence per tool batch."
   - Place this instruction in the "Follow these rules:" section of each prompt
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Ensure the instruction is concise and doesn't bloat the prompts

**Notes:**
- The thinking text is generated by Claude (not hardcoded) — this provides natural, context-appropriate messages
- Web search is a special case: the Anthropic API returns `server_tool_use` blocks. Claude may or may not emit text before these. The `tool_start` event from the streaming layer handles web search indicators regardless.
- The instruction should emphasize brevity — "one short sentence" — to avoid Claude being too verbose

#### Task 14: Add thinking message rendering in chat UI

**Issue:** FOO-558
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for thinking message rendering:
   - Test that when `tool_start` events arrive during streaming, a thinking indicator appears in the chat
   - Test that thinking text (from `text_delta` events preceding a `tool_start`) renders in italicized/muted style
   - Test that thinking messages persist in conversation history after the response completes
   - Test that multiple tool batches show separate thinking indicators
   - Run: `npm test -- food-chat`
   - Verify: Tests fail

2. **GREEN** — Implement thinking message rendering:
   - Extend `ConversationMessage` type (or add a local variant) with an optional `isThinking?: boolean` flag
   - During SSE streaming in `handleSend`: when a `tool_start` event arrives, mark the current assistant message's text-so-far as a thinking message (set `isThinking: true`). Create a new empty assistant message for the next text phase.
   - In the message rendering loop: if `msg.isThinking`, render the bubble with italic text and muted foreground color instead of the standard assistant bubble style
   - Thinking messages remain in the conversation history (they're informational, like "I searched your food log and found...")
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

3. **REFACTOR** — Ensure thinking bubbles are visually distinct but not distracting. The exact styling should match the existing muted color scheme.

**Notes:**
- `ConversationMessage` is defined in `src/types/index.ts:396-400` — adding `isThinking` is a minimal change
- The chat already has different styling for user vs assistant messages — thinking is a third variant
- If Claude emits text like "Let me check your food history..." followed by `tool_start(search_food_log)`, the text becomes a thinking bubble, and the tool execution begins
- After tool execution, Claude's next response starts a new non-thinking message

#### Task 15: Add tool usage indicators in analysis screen

**Issue:** FOO-558
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/analysis-result.tsx` (modify, if needed)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for analysis screen tool indicators:
   - Test that during streaming analysis, `tool_start` events update the loading step text
   - Test that web search (`tool_start: "web_search"`) shows "Searching the web..."
   - Test that `tool_start: "search_food_log"` shows "Checking your food log..."
   - Test that `tool_start: "get_nutrition_summary"` shows "Looking up your nutrition data..."
   - Test that Claude's thinking text (from `text_delta` before tool_start) also appears as loading step
   - Test that indicators are transient — replaced by the final analysis result
   - Run: `npm test -- food-analyzer`
   - Verify: Tests fail

2. **GREEN** — Implement tool indicators:
   - Create a mapping from tool names to user-friendly descriptions: `{ web_search: "Searching the web...", search_food_log: "Checking your food log...", get_nutrition_summary: "Looking up your nutrition data...", get_fasting_info: "Checking your fasting patterns...", report_nutrition: "Preparing nutrition report..." }`
   - In `handleAnalyze` (updated in Task 11): when `tool_start` events arrive, update `loadingStep` with the mapped description
   - When `text_delta` events arrive during loading, also update `loadingStep` — Claude's thinking text provides richer context than the static mapping
   - The `AnalysisResult` component already accepts a `loadingStep` prop and displays it — no changes needed to that component
   - Run: `npm test -- food-analyzer`
   - Verify: Tests pass

3. **REFACTOR** — Move the tool name → description mapping to a shared constant if it could be reused

**Notes:**
- `loadingStep` state is already wired through to `AnalysisResult` (line 580-581)
- Current loading steps are: "Preparing images...", "Analyzing food..." — the streaming version adds dynamic steps
- The indicators are transient by nature — once `analysis` or `needs_chat` event arrives, loading ends and the indicators disappear
- The `AnalysisResult` component shows the loading step below the spinner — check `src/components/analysis-result.tsx` for the exact rendering

---

### Task 16: Integration & Verification

**Issue:** FOO-556, FOO-557, FOO-558, FOO-559, FOO-560
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Run E2E tests: `npm run e2e`
6. Manual verification:
   - [ ] Settings page shows About section with correct version, environment, model info
   - [ ] GitHub Releases link opens in new tab
   - [ ] Chat food reuse: say "log the same as yesterday" → Claude uses search_food_log → reports with source_custom_food_id → logs as reuse (no duplicate custom food)
   - [ ] Analysis screen: photo analysis shows streaming tool indicators ("Analyzing...", "Searching the web...", etc.)
   - [ ] Analysis screen: final result appears smoothly after streaming
   - [ ] Chat screen: text appears token-by-token (not all at once)
   - [ ] Chat screen: thinking messages appear in italics before tool execution
   - [ ] Chat screen: tool indicators visible during multi-tool interactions
   - [ ] Error handling: disconnect during stream shows appropriate error
   - [ ] Abort: closing chat/analysis during stream cancels cleanly

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude API error during stream | Yield `error` event, close stream | Unit test |
| Client disconnects (abort) | Stream closes cleanly, no server errors | Unit test |
| Network timeout | Error event or JSON error (before stream starts) | Unit test |
| Invalid source_custom_food_id (food deleted between search and log) | `/api/log-food` returns validation error, client falls back to new-food | Existing test |
| SSE parsing error on client | Show error state, allow retry | Unit test |
| Tool execution fails in stream | Yield tool error to Claude, continue loop (existing behavior) | Unit test |

## Risks & Open Questions

- [ ] **Risk: Anthropic SDK streaming compatibility** — `client.messages.stream()` with tools must handle `server_tool_use` blocks (web search) correctly. Verify during implementation that the SDK exposes these in the streaming events.
- [ ] **Risk: Next.js App Router SSE** — ReadableStream responses in App Router route handlers work but need careful handling of the response object lifetime. If the route handler function returns before the stream completes, the stream may be prematurely closed. The implementer should verify with a manual test.
- [ ] **Risk: State management during streaming** — React state updates from within a streaming loop may cause excessive re-renders. The implementer should batch text_delta updates (e.g., accumulate 50ms of deltas before updating state) or use `useRef` for the growing text with periodic `setState` flushes.
- [ ] **Question: MealEntry customFoodId availability** — Task 4 notes that `getDailyNutritionSummary` returns `MealEntry` which lacks `customFoodId`. The implementer needs to check if the Drizzle query can be extended to join `food_log_entries.custom_food_id` → `custom_foods.id`, or if a different query approach is needed for date-based food log search.
- [ ] **Question: ChatFoodResponse type retirement** — With streaming, `ChatFoodResponse` (message + analysis) is no longer the API response format. Should it be kept for internal use or removed? The implementer should decide based on whether any non-streaming code path remains.

## Scope Boundaries

**In Scope:**
- Health API about info (FOO-556)
- Settings page AboutSection component (FOO-556)
- search_food_log tool response with customFoodId (FOO-559)
- report_nutrition schema with source_custom_food_id (FOO-559)
- FoodAnalysis type extension (FOO-560)
- Client-side food reuse wiring (FOO-560)
- SSE streaming infrastructure (FOO-557)
- Streaming API routes (FOO-557)
- Client-side SSE consumption (FOO-557)
- System prompt thinking text (FOO-558)
- Chat thinking message rendering (FOO-558)
- Analysis screen tool indicators (FOO-558)

**Out of Scope:**
- Service worker / offline support
- WebSocket alternative to SSE
- Streaming for external API v1 routes
- Caching of streamed responses
- Streaming for non-Claude API calls (Fitbit, etc.)
