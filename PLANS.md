# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-541-logging-observability-overhaul
**Issues:** FOO-541, FOO-542, FOO-543, FOO-544, FOO-545, FOO-546, FOO-547
**Created:** 2026-02-16
**Last Updated:** 2026-02-16

## Summary

Comprehensive logging and observability overhaul addressing 7 related issues from a deep-review audit. Fixes a bug where data tool calls are dropped during food analysis, eliminates systematic double-logging, introduces request-scoped loggers with correlation IDs, demotes noisy routine logs, adds debug-level visibility to the Claude API layer and all data modules, and instruments key external API calls with timing data.

## Issues

### FOO-541: needs_chat transition drops Claude's data tool calls, leaving user stuck

**Priority:** High
**Labels:** Bug
**Description:** When `analyzeFood()` returns a `needs_chat` result, any data tool calls Claude made (e.g., `search_food_log`) are silently dropped. The chat opens with a static seed message but no tool execution ever happens. The user must manually send a follow-up message.

**Acceptance Criteria:**
- [ ] When Claude returns data tool calls in `analyzeFood()`, they are executed via `runToolLoop()`
- [ ] If the tool loop resolves to an analysis (report_nutrition), return `{ type: "analysis" }`
- [ ] If the tool loop resolves to text only, return `{ type: "needs_chat" }` with the resolved message
- [ ] Existing tests updated; new tests cover the data-tool-then-resolve path

### FOO-545: Fix systematic double-logging between route handlers and errorResponse()

**Priority:** Medium
**Labels:** Improvement
**Description:** `errorResponse()` in `api-response.ts` auto-logs every error (warn for 4xx, error for 5xx). Most route handlers ALSO log the error just before calling `errorResponse()`, producing duplicate entries. Choose Option A: route handlers own all error logging, `errorResponse()` stops auto-logging.

**Acceptance Criteria:**
- [ ] `errorResponse()` no longer calls `logger.warn` or `logger.error`
- [ ] Every route handler that calls `errorResponse()` has exactly one log entry for the error
- [ ] No loss of diagnostic information (action, error details, status code)
- [ ] Existing `api-response.test.ts` updated to reflect removal of auto-logging

### FOO-543: Adopt request-scoped loggers with correlation IDs in all route handlers

**Priority:** High
**Labels:** Improvement
**Description:** `createRequestLogger(method, path)` exists in `logger.ts` but is never used. All 30 route handlers import the global `logger` directly. Log entries from concurrent requests are indistinguishable.

**Acceptance Criteria:**
- [ ] `createRequestLogger` enhanced to include a `requestId` (crypto.randomUUID)
- [ ] All API route handlers create a request-scoped logger and pass it to lib functions
- [ ] Key lib modules (claude.ts, chat-tools.ts, fitbit.ts, food-log.ts, fasting.ts) accept an optional logger parameter
- [ ] Remaining lib modules called from routes also accept optional logger parameter
- [ ] Default to global logger when no logger is passed (backward compat for tests and non-route callers)

### FOO-546: Demote routine success logs from info to debug level

**Priority:** Medium
**Labels:** Improvement
**Description:** Many successful GET operations are logged at `info` level, dominating production logs. Also, several info logs in `claude.ts` use unstructured string-only format.

**Acceptance Criteria:**
- [ ] All routine read/GET success logs demoted to `debug`
- [ ] All write/state-change success logs remain at `info`
- [ ] All info/warn/error logs use structured `{ action: "..." }` format
- [ ] Production logs contain only significant events at default `info` level

### FOO-542: Add comprehensive debug logging to Claude API and chat flows

**Priority:** High
**Labels:** Improvement
**Description:** The Claude API layer has almost zero debug-level logging. When issues occur, logs only show high-level start/end events with no visibility into what Claude actually did.

**Acceptance Criteria:**
- [ ] Every Claude API response logged at debug: stop_reason, content block types, tool names
- [ ] Conversation content logged at debug: message roles, text lengths
- [ ] Tool call details: tool names, parameter keys/values
- [ ] Tool execution results: result length, errors, duration
- [ ] Token usage per response: input, output, cache creation, cache read
- [ ] Tool loop per-iteration breakdown at debug
- [ ] Loop exit reason logged

### FOO-544: Add debug logging to data layer modules

**Priority:** Medium
**Labels:** Improvement
**Description:** 9 lib modules that handle core data operations have zero logging. Data layer is a complete blind spot.

**Acceptance Criteria:**
- [ ] All listed modules have debug-level logging for key operations
- [ ] No sensitive data logged (tokens, keys, passwords)
- [ ] Logs include function name, input params summary, result summary
- [ ] All at debug level — invisible in production unless LOG_LEVEL=debug

### FOO-547: Add operation timing/duration to key log entries

**Priority:** Medium
**Labels:** Performance
**Description:** No log entry records how long an operation took. Cannot diagnose performance issues without temporary timing code.

**Acceptance Criteria:**
- [ ] All Claude API call logs include `durationMs`
- [ ] All Fitbit API call logs include `durationMs`
- [ ] Duration logged at the same level as the completion log
- [ ] Reusable timing utility to avoid boilerplate

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All existing tests passing
- [ ] Linear MCP connected

## Implementation Tasks

### Task 1: Fix analyzeFood data tool execution

**Issue:** FOO-541
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Write failing tests in `claude.test.ts`:
   - Test: when Claude returns `stop_reason: "tool_use"` with only data tools (e.g., `search_food_log`), `analyzeFood()` should execute the tool loop and return the resolved result instead of dropping the tools
   - Test: when the tool loop resolves with `report_nutrition`, `analyzeFood()` returns `{ type: "analysis" }` (not `needs_chat`)
   - Test: when the tool loop resolves with text only (no report_nutrition), `analyzeFood()` returns `{ type: "needs_chat" }` with the resolved message (not the intermediate fallback)
   - Mock `executeTool` from chat-tools to return canned results; mock subsequent `mockCreate` calls for the tool loop iterations
   - Run: `npm test -- claude.test`
   - Verify: Tests fail because current code drops data tools

2. **GREEN** — Modify `analyzeFood()` in `claude.ts`:
   - After the initial API call, before the `needs_chat` fallback path (after line 375), check if response contains data tool_use blocks (excluding `report_nutrition`)
   - If data tools are present, call `runToolLoop()` with the initial user message array, passing `initialResponse: response`, the same system prompt, all tools (including REPORT_NUTRITION_TOOL), and `operation: "food-analysis"`
   - If `runToolLoop` returns an analysis, return `{ type: "analysis", analysis }`
   - If it returns text only, return `{ type: "needs_chat", message }`
   - Keep the existing text-only `needs_chat` path for responses without any tool_use blocks
   - Run: `npm test -- claude.test`
   - Verify: All tests pass

3. **REFACTOR** — Ensure the data-tool detection logic is clean and the two paths (fast-path analysis vs tool-loop resolution) are clearly documented with comments

**Notes:**
- Follow the pattern from `conversationalRefine()` lines 524-543 which already handles this correctly
- The `runToolLoop` function already supports `initialResponse` parameter — use it
- `executeTool` in `chat-tools.ts` already handles all three data tools
- No type changes needed to `AnalyzeFoodResult` — the existing `needs_chat` and `analysis` variants cover all cases

---

### Task 2: Remove errorResponse auto-logging and audit route handlers

**Issue:** FOO-545
**Files:**
- `src/lib/api-response.ts` (modify)
- `src/lib/__tests__/api-response.test.ts` (modify)
- All route handler files in `src/app/api/` (audit + modify where needed)

**TDD Steps:**

1. **RED** — Update tests in `api-response.test.ts`:
   - Change the "logs at warn level for 4xx errors" test to assert `logger.warn` is NOT called
   - Change the "logs at error level for 5xx errors" test to assert `logger.error` is NOT called
   - Remove the "does not include details in log output" test (no longer relevant since errorResponse won't log)
   - Run: `npm test -- api-response.test`
   - Verify: Tests fail because errorResponse still auto-logs

2. **GREEN** — Remove auto-logging from `errorResponse()` in `api-response.ts`:
   - Remove the `logger` import
   - Remove the `logData` variable and the `if (status >= 500)` / `else` logging block (lines 21-27)
   - Keep the function signature and response body unchanged
   - Run: `npm test -- api-response.test`
   - Verify: Tests pass

3. **REFACTOR** — Audit all route handlers that call `errorResponse()` to ensure each error path has exactly one log entry:
   - Route handlers that already log before `errorResponse()`: no changes needed (they become the single source of truth)
   - Route handlers that rely solely on `errorResponse()` for logging (no preceding log): add a `logger.warn` or `logger.error` call with `{ action: "...", error: "..." }` structured format before the `errorResponse()` call
   - Use `grep` to find all `errorResponse(` calls and check each one
   - Key routes to check: `src/app/api/v1/` routes (some have bare `errorResponse` without preceding log for validation errors like missing date param), `auth/` routes, `api-keys/` routes
   - Run: `npm test` (full suite to catch any test that asserted on errorResponse logging behavior)
   - Verify: All tests pass, no double-logging

**Notes:**
- Option A from the issue: route handlers own all error logging, errorResponse is a pure response builder
- Several route handler tests (e.g., `food-history/[id]/__tests__/route.test.ts`) may assert on `logger.error` or `logger.warn` calls — review and update as needed
- Validation error paths (400s) that just call `errorResponse("VALIDATION_ERROR", ...)` without a preceding log may not need a log entry at all — simple validation failures don't need logging unless they indicate misuse

---

### Task 3: Enhance createRequestLogger with correlation ID

**Issue:** FOO-543
**Files:**
- `src/lib/logger.ts` (modify)
- `src/lib/__tests__/logger.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests in `logger.test.ts`:
   - Test: `createRequestLogger` returns a child logger with `method`, `path`, and `requestId` fields
   - Test: `requestId` is a valid UUID string (matches UUID v4 pattern)
   - Test: `createRequestLoggerWithDestination` also includes `requestId`
   - Use the existing `createCaptureDest` + `flush` pattern to capture JSON output and parse it
   - Run: `npm test -- logger.test`
   - Verify: Tests fail because current createRequestLogger doesn't include requestId

2. **GREEN** — Modify `createRequestLogger` in `logger.ts`:
   - Import `randomUUID` from `node:crypto`
   - Add `requestId: randomUUID()` to the child logger context in both `createRequestLogger` and `createRequestLoggerWithDestination`
   - Run: `npm test -- logger.test`
   - Verify: Tests pass

3. **REFACTOR** — Export `Logger` type re-export from pino for convenience (so lib modules can type their optional logger parameter without importing pino directly)

**Notes:**
- The existing `createRequestLogger` function signature stays the same: `(method: string, path: string) => Logger`
- The `requestId` is automatically included in every log entry from the child logger
- Re-exporting the `Logger` type: add `export type { Logger } from "pino"` to logger.ts (check if it's already exported — it is as an import type, just needs re-export)

---

### Task 4: Add optional logger parameter to Claude + chat-tools modules

**Issue:** FOO-543, FOO-546 (partial)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - In `claude.test.ts`: test that when a logger is passed to `analyzeFood`, `conversationalRefine`, and `runToolLoop`, that logger is used (not the global one). Mock the passed logger and verify calls on it.
   - In `chat-tools.test.ts`: test that `executeTool` accepts an optional logger parameter
   - Run: `npm test -- claude.test chat-tools.test`
   - Verify: Tests fail because functions don't accept logger parameter yet

2. **GREEN** — Add optional `log?: Logger` parameter to exported functions:
   - `analyzeFood(images, description, userId, currentDate, log?)` — use `const l = log ?? logger` at the top, replace all `logger.` calls with `l.`
   - `conversationalRefine(messages, images, userId?, currentDate?, initialAnalysis?, signal?, log?)` — same pattern
   - `runToolLoop(messages, userId, currentDate, options?)` — add `log?: Logger` to the options object, use `const l = options?.log ?? logger`
   - `executeTool(toolName, params, userId, currentDate, log?)` — same pattern, and pass it to sub-functions
   - Import `Logger` type from `@/lib/logger`
   - Run: `npm test -- claude.test chat-tools.test`
   - Verify: Tests pass

3. **REFACTOR** — Also fix unstructured log format in claude.ts (FOO-546 partial):
   - Line 388: change `logger.info("food analysis needs chat transition")` to use structured format `l.info({ action: "analyze_food_needs_chat" }, "food analysis needs chat transition")`
   - Line 564: change `logger.info("conversational refinement completed (text only)")` to `l.info({ action: "conversational_refine_text_only" }, "conversational refinement completed (text only)")`
   - Verify no other unstructured log calls remain in these files
   - Run: `npm test -- claude.test chat-tools.test`

**Notes:**
- The optional logger is always the LAST parameter (or inside an options object for `runToolLoop`)
- Existing callers that don't pass a logger get the global logger — fully backward compatible
- The `executeTool` function in `chat-tools.ts` currently has zero logging — for now just add the parameter; debug logging is added in Task 9
- `runToolLoop` is called from both `analyzeFood` (Task 1) and `conversationalRefine` — thread the logger through

---

### Task 5: Add optional logger parameter to fitbit module

**Issue:** FOO-543
**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add a test in `fitbit.test.ts`:
   - Test that exported functions (`createFood`, `logFood`, `deleteFoodLog`, `findOrCreateFood`, `refreshFitbitToken`, `getFoodGoals`, `getActivitySummary`) accept an optional `log?: Logger` parameter
   - Verify that when passed, the custom logger receives log calls instead of the global one
   - Run: `npm test -- fitbit.test`
   - Verify: Tests fail

2. **GREEN** — Add optional `log?: Logger` parameter to all exported functions in `fitbit.ts`:
   - Use `const l = log ?? logger` pattern at the top of each function
   - Replace all `logger.` calls with `l.` throughout the function body
   - Internal helper functions called by exported functions (like `fitbitRequest`, `refreshFitbitToken`) should also accept and propagate the logger
   - Import `Logger` type from `@/lib/logger`
   - Run: `npm test -- fitbit.test`
   - Verify: Tests pass

3. **REFACTOR** — Ensure logger propagation through the retry/refresh chain in fitbit.ts (e.g., `fitbitRequest` → `refreshFitbitToken` → retry)

**Notes:**
- `fitbit.ts` has many internal functions — the logger must be threaded through the call chain
- Reference the existing function signatures and add `log?` as the last parameter
- `fitbitRequest` is a private function that wraps all API calls — adding logger there propagates to all callers

---

### Task 6: Add optional logger parameter to all remaining data layer modules

**Issue:** FOO-543
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/fasting.ts` (modify)
- `src/lib/food-matching.ts` (modify)
- `src/lib/fitbit-tokens.ts` (modify)
- `src/lib/fitbit-credentials.ts` (modify)
- `src/lib/session-db.ts` (modify)
- `src/lib/users.ts` (modify)
- `src/lib/api-keys.ts` (modify)
- `src/lib/rate-limit.ts` (modify)
- `src/lib/nutrition-goals.ts` (modify)
- `src/lib/lumen.ts` (modify)
- `src/lib/claude-usage.ts` (modify)
- Corresponding test files (modify where needed)

**TDD Steps:**

1. **RED** — For each module, add a test verifying the optional `log?: Logger` parameter is accepted. Focus on the most important modules first: `food-log.ts`, `fasting.ts`, `session-db.ts`.
   - Run: `npm test -- food-log.test fasting.test session-db.test`
   - Verify: Tests fail

2. **GREEN** — Add optional `log?: Logger` parameter to all exported functions in each module:
   - Import `Logger` type from `@/lib/logger` (or `import type { Logger } from "pino"` if logger.ts doesn't re-export yet)
   - For modules that currently don't import logger at all (most of them), add: `import { logger } from "@/lib/logger"` and `import type { Logger } from "@/lib/logger"`
   - Use `const l = log ?? logger` pattern at the top of each function
   - For modules with many exported functions (e.g., `food-log.ts` has ~15 functions), add the parameter to all of them
   - Run: `npm test` (full suite — many modules, easier to run all)
   - Verify: All tests pass

3. **REFACTOR** — Ensure consistency: every exported function in every data module has `log?: Logger` as its last parameter

**Notes:**
- These modules currently have ZERO logging (confirmed by grep) — the optional logger parameter is added now, but actual debug log statements are added in Task 10
- Modules with zero current logging won't have any `logger.` calls to replace — just add the parameter and the `const l = log ?? logger` setup for use by later tasks
- `food-log.ts` is the largest (872 lines, ~15 exported functions) — be thorough
- `rate-limit.ts` is synchronous and in-memory — still add the parameter for consistency
- Some modules may have internal helper functions — only exported functions need the parameter (internal helpers will be called with the resolved `l`)

---

### Task 7: Update all route handlers to use request-scoped loggers

**Issue:** FOO-543, FOO-545 (continuation)
**Files:**
- All 30 route files in `src/app/api/` (modify)
- `src/middleware.ts` (modify if it exists and uses logger)

**TDD Steps:**

1. **RED** — Pick 3 representative route handlers with existing tests and update their tests:
   - `src/app/api/analyze-food/route.ts` — complex route with multiple log calls
   - `src/app/api/v1/food-log/route.ts` — v1 API route
   - `src/app/api/food-history/[id]/route.ts` — route with multiple error paths
   - In each test file, verify that `createRequestLogger` is called with the correct method and path
   - Verify that the request logger (not global logger) is passed to lib functions
   - Run: `npm test -- analyze-food chat-food food-log`
   - Verify: Tests fail because routes still use global logger

2. **GREEN** — Update all route handlers:
   - At the start of each handler function, create a request logger: `const log = createRequestLogger(request.method, url.pathname)` (or hardcode the method/path string for simpler routes)
   - Replace all `logger.` calls with `log.` throughout the handler
   - Pass `log` to lib function calls as the last argument (e.g., `analyzeFood(images, desc, userId, date, log)`)
   - Import `createRequestLogger` from `@/lib/logger` (replacing or supplementing the `logger` import)
   - For route handlers that don't call any lib functions (e.g., health, session), just use the request logger for their own logging
   - Run: `npm test` (full suite)
   - Verify: All tests pass

3. **REFACTOR** — Remove unused `import { logger }` from route handlers that no longer directly use the global logger

**Notes:**
- Route test files that mock `@/lib/logger` may need updating — they should mock `createRequestLogger` to return a mock child logger
- The `request.method` is available on the Request object; for the path, use `new URL(request.url).pathname` or hardcode the known path
- For `src/app/api/health/route.ts`: this is a public route with minimal logging — still use request logger for consistency
- Auth routes (`google/`, `fitbit/`, `logout/`, `session/`, `test-login/`) need the same treatment

---

### Task 8: Demote routine success logs to debug level

**Issue:** FOO-546
**Files:**
- `src/app/api/v1/food-log/route.ts` (modify)
- `src/app/api/v1/nutrition-summary/route.ts` (modify)
- `src/app/api/v1/lumen-goals/route.ts` (modify)
- `src/app/api/v1/activity-summary/route.ts` (modify)
- `src/app/api/v1/nutrition-goals/route.ts` (modify)
- `src/app/api/fasting/route.ts` (modify)
- `src/app/api/find-matches/route.ts` (modify)
- `src/app/api/nutrition-summary/route.ts` (modify)
- `src/app/api/claude-usage/route.ts` (modify)
- `src/app/api/earliest-entry/route.ts` (modify)
- `src/lib/nutrition-goals.ts` (modify)
- Route test files that assert on log levels (modify)

**TDD Steps:**

1. **RED** — Update test files that assert `logger.info` for routine GET success:
   - Change assertions from `expect(log.info)` to `expect(log.debug)` for the success paths
   - Run: `npm test -- v1 fasting find-matches nutrition-summary claude-usage earliest-entry nutrition-goals`
   - Verify: Tests fail because code still logs at info

2. **GREEN** — In each listed route file, change the success log from `log.info(...)` to `log.debug(...)` for read/GET operations:
   - v1 routes: "v1 food log retrieved", "v1 nutrition summary retrieved", "v1 lumen goals retrieved", "v1 activity summary retrieved", "v1 nutrition goals retrieved"
   - Browser routes: "fasting window retrieved", "fasting windows retrieved", "food matching complete", "nutrition summary retrieved", "claude usage retrieved", "earliest entry retrieved"
   - `nutrition-goals.ts`: "calorie goal upserted" — demote to debug (frequent during normal use)
   - Do NOT demote: write operations (log_food_success, delete_food_log), auth events, Claude API results, server lifecycle
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** — Verify production log output would only contain significant events at info level

**Notes:**
- Some of these route handlers will already have request-scoped loggers from Task 7 — use `log.debug` (the request logger variable), not `logger.debug`
- The "calorie goal upserted" in `nutrition-goals.ts` happens on every food log page load — demoting to debug reduces noise significantly
- Logs that should STAY at info: `log_food_success`, `delete_food_log`, `google_login_success`, `fitbit_connect_success`, "food analysis completed", lumen goals parsed/upserted (write), server start/shutdown

---

### Task 9: Add debug logging to Claude API and chat-tools

**Issue:** FOO-542
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify — optional, for smoke tests)
- `src/lib/__tests__/chat-tools.test.ts` (modify — optional, for smoke tests)

**TDD Steps:**

1. **RED** — Add targeted tests:
   - Test that `analyzeFood` logs at debug level with stop_reason and content block types after receiving a response
   - Test that `executeTool` logs at debug level with tool name and result length
   - Test that `runToolLoop` logs per-iteration debug info
   - Run: `npm test -- claude.test chat-tools.test`
   - Verify: Tests fail

2. **GREEN** — Add debug logging throughout:

   **In `analyzeFood()`:**
   - After receiving the API response: log stop_reason, content block types (text/tool_use), tool names if any
   - Log token usage: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens

   **In `conversationalRefine()`:**
   - After receiving the API response: log stop_reason, content block types, tool names
   - Log token usage
   - When truncation happens: log before/after message counts

   **In `runToolLoop()` — per iteration:**
   - Log iteration number, stop_reason, content block types, tools called (names)
   - Log tool results: tool name, result length, whether error
   - Log token usage per response
   - On loop exit: log the exit reason (end_turn, max_iterations, abort, error)

   **In `executeTool()` (chat-tools.ts):**
   - At entry: log tool name and parameter keys/values (e.g., search query, date range)
   - At exit: log result length and whether it's an error result
   - Log the specific sub-function called (executeSearchFoodLog, etc.)

   **In `truncateConversation()`:**
   - Log when truncation is triggered: estimated tokens, max tokens, messages before/after

   All logging at `l.debug()` using the optional logger parameter added in Task 4.
   - Run: `npm test -- claude.test chat-tools.test`
   - Verify: Tests pass

3. **REFACTOR** — Consider extracting a `summarizeResponse(response)` helper to build the debug payload consistently for Claude API responses (stop_reason, block types, tool names, token counts)

**Notes:**
- All new logging MUST use `l.debug()` (the optional logger variable from Task 4)
- Security: do NOT log raw image base64 data. Log image count and mime types instead.
- Security: do NOT log cookie values, access tokens, or API keys
- DO log conversation text content at debug level — this was explicitly approved per FOO-542 description
- Token usage fields: `response.usage.input_tokens`, `response.usage.output_tokens`, `response.usage.cache_creation_input_tokens`, `response.usage.cache_read_input_tokens`

---

### Task 10: Add debug logging to data layer modules

**Issue:** FOO-544
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/fasting.ts` (modify)
- `src/lib/food-matching.ts` (modify)
- `src/lib/fitbit-tokens.ts` (modify)
- `src/lib/fitbit-credentials.ts` (modify)
- `src/lib/session-db.ts` (modify)
- `src/lib/users.ts` (modify)
- `src/lib/api-keys.ts` (modify)
- `src/lib/rate-limit.ts` (modify)

**TDD Steps:**

1. **RED** — Add targeted tests for the 3 most important modules:
   - `food-log.ts`: test that `searchFoods` logs at debug with query and result count
   - `fasting.ts`: test that `getFastingWindow` logs at debug with date and result
   - `session-db.ts`: test that session operations log at debug
   - Run: `npm test -- food-log.test fasting.test session-db.test`
   - Verify: Tests fail

2. **GREEN** — Add debug logging to each module, using the optional `l` logger from Task 6:

   **food-log.ts** — For each exported function, add `l.debug()` at entry (params summary) and exit (result summary):
   - `searchFoods`: query, result count
   - `getDailyNutritionSummary`: date, meal count, total calories
   - `getDateRangeNutritionSummary`: date range, day count
   - `getFoodLogHistory`: date range, entry count
   - `insertFoodLogEntry`: food name, date, calories
   - `getCommonFoods`: result count, top 3 food names and scores (at debug)
   - Other functions: entry/exit with key params and result counts

   **fasting.ts** — `getFastingWindow`: date, duration result; `getFastingWindows`: date range, window count

   **food-matching.ts** — Match criteria, candidate count, final match count

   **fitbit-tokens.ts** / **fitbit-credentials.ts** — Read/write operations. Log "token found for userId" or "token not found" (NOT token values). Log "credentials upserted".

   **session-db.ts** — Session create (sessionId prefix), delete, touch, cleanup count

   **users.ts** — User find/create: email (this is a single-user app so email is not sensitive across users), action taken

   **api-keys.ts** — Validation: "key validated for userId" or "key not found" (NOT key values)

   **rate-limit.ts** — When a key is near limit (>80% consumed), log a debug warning with key identifier and usage percentage

   - Run: `npm test` (full suite)
   - Verify: All tests pass

3. **REFACTOR** — Ensure consistent log format across all modules: `l.debug({ action: "module_function_name", ...params }, "description")`

**Notes:**
- All logging MUST be `l.debug()` using the logger parameter from Task 6
- Security: NEVER log token values, key values, or passwords. Log identifiers (userId, sessionId prefix) and operation metadata only.
- `food-log.ts` is 872 lines with ~15 functions — be thorough but don't over-log. Entry + exit (with result count) is sufficient for most functions.
- `rate-limit.ts` is synchronous and in-memory — the 80% warning is the most useful debug log here
- Modules not listed here (`nutrition-goals.ts`, `lumen.ts`, `claude-usage.ts`) are lower priority — they're called less frequently and their behavior is straightforward. Add basic entry/exit debug logs if time permits.

---

### Task 11: Add timing to Claude and Fitbit API calls

**Issue:** FOO-547
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - In `claude.test.ts`: test that `analyzeFood` completion log includes `durationMs` as a number
   - In `claude.test.ts`: test that `runToolLoop` per-iteration and completion logs include `durationMs`
   - In `fitbit.test.ts`: test that `createFood`, `logFood`, `deleteFoodLog` completion logs include `durationMs`
   - Run: `npm test -- claude.test fitbit.test`
   - Verify: Tests fail

2. **GREEN** — Add timing instrumentation:

   **Create a timing utility** — Add to `src/lib/logger.ts` or inline in each module:
   - Simple pattern: `const start = Date.now()` before the operation, `const durationMs = Date.now() - start` after
   - Include `durationMs` in the existing completion log entry (add it to the structured data object)

   **claude.ts:**
   - `analyzeFood()`: time the entire function (API call + optional tool loop). Include `durationMs` in the completion info log.
   - `conversationalRefine()`: time the entire function. Include `durationMs` in completion log.
   - `runToolLoop()` each iteration: time each API call. Include `durationMs` in the per-iteration debug log.
   - `runToolLoop()` total: time from start to loop exit. Include `durationMs` in the completion log.

   **fitbit.ts:**
   - `createFood()`: time the Fitbit API call. Include `durationMs` in the existing info log.
   - `logFood()`: same.
   - `deleteFoodLog()`: same.
   - `refreshFitbitToken()`: time the token refresh. Include `durationMs` in the existing info log.
   - `getFoodGoals()`, `getActivitySummary()`: same.
   - Consider adding timing to the internal `fitbitRequest` wrapper so all calls get timing automatically.

   - Run: `npm test -- claude.test fitbit.test`
   - Verify: Tests pass

3. **REFACTOR** — If the `Date.now()` pattern is repeated more than 5 times, extract a utility like `startTimer()` that returns a function `() => number` (returning elapsed ms). Add to `logger.ts` and export.

**Notes:**
- Duration is logged at the same level as the completion log (info for state changes, debug for reads)
- `fitbitRequest` is the internal wrapper for all Fitbit API calls — adding timing there is the most efficient approach (one change covers all calls)
- The timing utility should be simple: `const elapsed = startTimer()` at the beginning, `elapsed()` at the end returns ms

---

### Task 12: Integration & Verification

**Issue:** FOO-541, FOO-542, FOO-543, FOO-544, FOO-545, FOO-546, FOO-547
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Start dev server with `LOG_LEVEL=debug` and verify debug logs appear
   - [ ] Start dev server with default level and verify routine GET logs are suppressed
   - [ ] Analyze a food with "same as yesterday" (no image) to verify FOO-541 fix
   - [ ] Check that error responses produce exactly one log entry
   - [ ] Verify `requestId` appears in log entries across a request lifecycle
   - [ ] Verify `durationMs` appears in Claude and Fitbit API logs

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| analyzeFood data tools fail | Tool loop catches error, returns partial response | Unit test |
| Logger parameter not passed | Falls back to global logger silently | Unit test |
| requestId generation fails | Should not happen (crypto.randomUUID is stable) | N/A |

## Risks & Open Questions

- [ ] **Large scope:** 7 issues across 40+ files. Plan-implement workers may need careful file partitioning.
- [ ] **Test fragility:** Many existing tests mock `logger` globally. Adding request-scoped loggers (Task 7) may require updating mock patterns in test files.
- [ ] **FOO-541 edge case:** If Claude calls both data tools AND report_nutrition in the initial analyzeFood response, the current fast-path handles report_nutrition. The tool loop is only needed when there's NO report_nutrition. Verify this logic is correct.

## Scope Boundaries

**In Scope:**
- Fix dropped data tool calls in analyzeFood (FOO-541)
- Remove auto-logging from errorResponse (FOO-545)
- Request-scoped loggers with requestId in all route handlers (FOO-543)
- Demote routine GET success logs to debug (FOO-546)
- Fix unstructured log format in claude.ts (FOO-546)
- Add debug logging to Claude API layer (FOO-542)
- Add debug logging to 9 data layer modules (FOO-544)
- Add durationMs to Claude and Fitbit API logs (FOO-547)

**Out of Scope:**
- Middleware request logging (FOO-543 mentions middleware but the issue focuses on route handlers)
- Request duration at the middleware level (FOO-547 mentions "if request-scoped loggers are adopted" for request-level timing — defer to a follow-up)
- Structured logging aggregation/alerting setup
- Log sampling or log rotation configuration
- Adding logging to client-side components
