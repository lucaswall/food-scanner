# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-581-keyword-search-and-model-upgrade
**Issues:** FOO-581, FOO-582, FOO-583
**Created:** 2026-02-17
**Last Updated:** 2026-02-17

## Summary

Three improvements to the food analysis pipeline:
1. Fix the search_food_log tool to use keyword-based matching (same as find-matches) instead of naive substring matching
2. Upgrade the Claude model from Sonnet 4.5 to Sonnet 4.6 and bump the SDK
3. Upgrade the web search tool from v1 to v2 with dynamic filtering for better accuracy and 24% token savings

## Issues

### FOO-581: search_food_log uses substring matching instead of keyword-based matching

**Priority:** High
**Labels:** Bug
**Description:** The `search_food_log` tool uses naive `.includes()` substring matching on free-text queries, while the `find-matches` endpoint uses Claude-generated keyword set intersection via `computeMatchRatio()`. This creates a UX inconsistency where the UI shows food matches but the chat can't find them.

Real example: query "té leche" fails because it's matched as a single substring against "Té con leche" (the "con" breaks it), and accent characters aren't normalized.

**Acceptance Criteria:**
- [ ] `search_food_log` tool accepts a `keywords` array parameter instead of a `query` string
- [ ] Matching uses `computeMatchRatio()` from `src/lib/food-matching.ts`
- [ ] The tool description instructs Claude to generate keywords following the same rules as `report_nutrition`
- [ ] Date-based and meal-type searches continue to work unchanged
- [ ] Foods that `find-matches` can find are also findable via `search_food_log`

### FOO-582: Upgrade Claude model from Sonnet 4.5 to Sonnet 4.6

**Priority:** Medium
**Labels:** Improvement
**Description:** The app uses `claude-sonnet-4-5-20250929` (pinned snapshot). Sonnet 4.6 (`claude-sonnet-4-6`) is available with better coding performance, improved long-context reasoning, and stronger safety — at the same price ($3/$15 per MTok).

**Acceptance Criteria:**
- [ ] `CLAUDE_MODEL` changed to `claude-sonnet-4-6`
- [ ] SDK bumped to `@anthropic-ai/sdk@^0.75.0`
- [ ] `MODEL_PRICING` includes `claude-sonnet-4-6` entry
- [ ] All test references updated
- [ ] E2E fixtures left as-is (historical data)
- [ ] No adaptive thinking or effort level changes

### FOO-583: Upgrade web search tool to v2 with dynamic filtering

**Priority:** Medium
**Labels:** Improvement
**Description:** The food analysis uses the old web search tool version (`web_search_20250305`). The new v2 (`web_search_20260209`) includes dynamic filtering for 24% fewer input tokens and improved accuracy.

**Acceptance Criteria:**
- [ ] `WEB_SEARCH_TOOL` type changed to `web_search_20260209`
- [ ] Beta header `anthropic-beta: code-execution-web-tools-2026-02-09` added to API calls
- [ ] TypeScript types updated for the new tool type
- [ ] All test references updated
- [ ] Existing web search behavior preserved (no regressions)

## Prerequisites

- [ ] `main` branch is clean and up to date
- [ ] `npm install` runs successfully
- [ ] `npm test` passes before starting

## Implementation Tasks

### Task 1: Replace query parameter with keywords in search_food_log tool definition

**Issue:** FOO-581
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update the tool schema test in `chat-tools.test.ts`:
   - Change the `SEARCH_FOOD_LOG_TOOL` schema test to expect a `keywords` property (type: array of strings) instead of `query` (type: string/null)
   - Update the `required` array assertion to use `keywords` instead of `query`
   - Update the non-strict schema test to check `keywords` has `type: "array"` with `items: { type: "string" }`
   - Run: `npm test -- chat-tools`
   - Verify: Schema tests fail because the tool still has `query`

2. **GREEN** — Update `SEARCH_FOOD_LOG_TOOL` in `chat-tools.ts`:
   - Replace the `query` property with a `keywords` property: `type: "array"`, `items: { type: "string" }`, description instructs Claude to generate 1-5 lowercase single-word tokens (same rules as report_nutrition's keywords)
   - Update `required` array: replace `"query"` with `"keywords"`
   - Update the tool `description` to mention keyword-based search instead of free-text search
   - Run: `npm test -- chat-tools`
   - Verify: Schema tests pass

3. **REFACTOR** — Ensure the description is clear and concise. Reference the keyword generation rules from `report_nutrition`.

### Task 2: Update searchFoods to use keyword matching via computeMatchRatio

**Issue:** FOO-581
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update `searchFoods` tests in `food-log.test.ts`:
   - Change the function signature in tests: replace `query: string` with `keywords: string[]`
   - Add test: searching with keywords `["te", "leche"]` matches a food with keywords `["te", "leche", "azucar"]` (match ratio >= 0.5)
   - Add test: searching with keywords `["pizza"]` matches a food with keywords `["pizza", "jamon", "muzzarella"]` (match ratio >= 0.5)
   - Add test: searching with keywords `["cerveza", "sin-alcohol"]` does NOT match a food with keywords `["pizza", "jamon"]` (match ratio < 0.5)
   - Run: `npm test -- food-log`
   - Verify: Tests fail because `searchFoods` still expects a string

2. **GREEN** — Refactor `searchFoods` in `food-log.ts`:
   - Change signature from `searchFoods(userId, query: string, ...)` to `searchFoods(userId, keywords: string[], ...)`
   - Import `computeMatchRatio` from `@/lib/food-matching`
   - Replace the application-level filter block (lines 544-551) with keyword-based matching: for each row, compute `computeMatchRatio(keywords, row.custom_foods.keywords ?? [])` and include if ratio >= 0.5
   - Remove the `lowerQuery` variable and `.includes()` logic
   - Keep the grouping, sorting, and limit logic unchanged
   - Run: `npm test -- food-log`
   - Verify: Tests pass

3. **REFACTOR** — Clean up: remove unused `lowerQuery` variable, ensure consistent naming.

### Task 3: Update executeSearchFoodLog to pass keywords to searchFoods

**Issue:** FOO-581
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update execution tests in `chat-tools.test.ts`:
   - In "executes query-only search" test: change params from `{ query: "pizza" }` to `{ keywords: ["pizza"] }` and update the `mockSearchFoods` assertion to expect `["pizza"]` instead of `"pizza"`
   - In "search_food_log accepts null parameters" test: update params to use `keywords: ["pizza"]` instead of `query: "pizza"`, update assertion
   - Add new test: "executes keyword search with multiple keywords" — pass `{ keywords: ["te", "leche"] }`, verify `mockSearchFoods` called with `["te", "leche"]`
   - Add test: "returns error when keywords is null and no date provided" — pass `{ keywords: null, date: null, from_date: null, to_date: null }`, expect the "at least one of" error
   - Run: `npm test -- chat-tools`
   - Verify: Tests fail because `executeSearchFoodLog` still reads `query`

2. **GREEN** — Update `executeSearchFoodLog` in `chat-tools.ts`:
   - Read `keywords` instead of `query` from params
   - Validate that `keywords` is a non-empty array (instead of checking for a truthy `query` string)
   - In Case 1 (keyword-only search): pass the `keywords` array to `searchFoods()` instead of the query string
   - Update the "no results" message to reference keywords instead of the query string
   - Run: `npm test -- chat-tools`
   - Verify: Tests pass

3. **REFACTOR** — Ensure the error message for missing parameters still makes sense with the new keyword approach.

### Task 4: Bump Anthropic SDK and update Claude model constant

**Issue:** FOO-582
**Files:**
- `package.json` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**

1. Run `npm install @anthropic-ai/sdk@^0.75.0` to bump the SDK
2. Change `CLAUDE_MODEL` in `src/lib/claude.ts:11` from `"claude-sonnet-4-5-20250929"` to `"claude-sonnet-4-6"`
3. Run `npm run typecheck` — verify no new type errors from the SDK bump
4. Run `npm test` — tests will fail due to model string mismatches (expected, fixed in Task 5)

**Notes:**
- The SDK bump is needed because semver 0.x treats minor as breaking: `^0.74.0` only resolves to `0.74.x`
- If `npm install @anthropic-ai/sdk@^0.75.0` fails (version not published), try `@anthropic-ai/sdk@latest` and pin whatever version installs

### Task 5: Add Sonnet 4.6 pricing entry and update all test references

**Issue:** FOO-582
**Files:**
- `src/lib/claude-usage.ts` (modify)
- `src/lib/__tests__/claude-usage.test.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/app/api/health/__tests__/route.test.ts` (modify)
- `src/components/__tests__/about-section.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test in `claude-usage.test.ts` for the new pricing entry:
   - Test that `MODEL_PRICING["claude-sonnet-4-6"]` exists with `inputPricePerMToken: 3` and `outputPricePerMToken: 15`
   - Run: `npm test -- claude-usage`
   - Verify: Test fails because the entry doesn't exist yet

2. **GREEN** — Add the pricing entry in `claude-usage.ts`:
   - Add `"claude-sonnet-4-6": { inputPricePerMToken: 3, outputPricePerMToken: 15 }` to `MODEL_PRICING`
   - Keep existing entries for `claude-sonnet-4-5-20250929` and others (historical usage records reference them)
   - Run: `npm test -- claude-usage`
   - Verify: Test passes

3. **Update test references** — Find-and-replace `claude-sonnet-4-5-20250929` → `claude-sonnet-4-6` in:
   - `src/lib/__tests__/claude.test.ts` (~27 occurrences)
   - `src/app/api/health/__tests__/route.test.ts` (2 occurrences)
   - `src/components/__tests__/about-section.test.tsx` (2 occurrences)
   - Do NOT change `e2e/fixtures/db.ts` (historical usage records)
   - Run: `npm test`
   - Verify: All tests pass

### Task 6: Upgrade web search tool to v2 with beta header

**Issue:** FOO-583
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update web search tool tests in `claude.test.ts`:
   - Change all `web_search_20250305` assertions to `web_search_20260209` (3 occurrences)
   - Remove `name: "web_search"` from assertions (v2 doesn't require a name field)
   - Add assertions that the API calls include the beta header `anthropic-beta: code-execution-web-tools-2026-02-09`
   - Run: `npm test -- claude`
   - Verify: Tests fail because the tool still uses the old type

2. **GREEN** — Update `WEB_SEARCH_TOOL` and API calls in `claude.ts`:
   - Change `WEB_SEARCH_TOOL` type from `"web_search_20250305"` to `"web_search_20260209"`, remove `name` property
   - Update the TypeScript type annotations: the `buildToolsWithCache` function signature and `tools` option type need to reference the new web search tool type. If the SDK (0.75.0+) exports `WebSearchTool20260209`, use it. If not, define a local type and cast.
   - Add the beta header to API calls: in `getClient().messages.stream()` calls (there are 4: in `runToolLoop`, `analyzeFood` initial call, and `conversationalRefine` initial call, plus the one in `analyzeFood`'s slow path which goes through `runToolLoop`), include `headers: { 'anthropic-beta': 'code-execution-web-tools-2026-02-09' }` in the options object alongside `signal`
   - Run: `npm test -- claude`
   - Verify: Tests pass

3. **REFACTOR** — Extract the beta header string into a constant (e.g., `WEB_SEARCH_BETA_HEADER`) for DRY. Ensure the request options merge correctly when `signal` is also present.

**Notes:**
- The SDK's `messages.stream()` second parameter is `RequestOptions` which accepts `headers`
- Currently the code passes `{ signal: options?.signal }` — merge with `{ signal: options?.signal, headers: { 'anthropic-beta': 'code-execution-web-tools-2026-02-09' } }`
- If SDK 0.75.0 doesn't export the new web search type, use `as const` assertion on the tool object and cast appropriately in the `buildToolsWithCache` type signature

### Task 7: Integration & Verification

**Issue:** FOO-581, FOO-582, FOO-583
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Verify no warnings in any of the above (zero warnings policy)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Empty keywords array passed to search | Return error message | Unit test (Task 3) |
| No keywords match (ratio < 0.5) | Return "No foods found" | Unit test (Task 2) |
| Unknown model string in pricing lookup | Log warning, use zero pricing | Existing test |
| SDK bump breaks types | TypeScript compilation error | typecheck (Task 7) |
| Beta header not recognized by API | API should ignore unknown betas gracefully | Manual verification |

## Risks & Open Questions

- [ ] SDK 0.75.0 may not be published yet — fallback to `@latest` and pin
- [ ] SDK 0.75.0 may not export `WebSearchTool20260209` type — use local type + cast
- [ ] Web search v2 beta header behavior needs manual verification with real API calls

## Scope Boundaries

**In Scope:**
- Replace substring search with keyword matching in search_food_log
- Upgrade Claude model to Sonnet 4.6
- Bump Anthropic SDK to 0.75.0+
- Add Sonnet 4.6 pricing entry
- Upgrade web search tool to v2 with beta header
- Update all affected tests

**Out of Scope:**
- Adaptive thinking or effort level configuration
- Changing Haiku model version
- Modifying E2E fixtures (historical usage data)
- Any changes to the find-matches endpoint (already uses correct matching)
- Service worker or PWA changes

---

## Iteration 1

**Implemented:** 2026-02-17
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Task 1: Replace query parameter with keywords in search_food_log tool definition (FOO-581)
- Task 2: Update searchFoods to use keyword matching via computeMatchRatio (FOO-581)
- Task 3: Update executeSearchFoodLog to pass keywords to searchFoods (FOO-581)
- Task 4: Bump Anthropic SDK and update Claude model constant (FOO-582)
- Task 5: Add Sonnet 4.6 pricing entry and update all test references (FOO-582)
- Task 6: Upgrade web search tool to v2 (FOO-583) — SDK 0.75.0 includes WebSearchTool20260209 in main ToolUnion, no beta header needed
- Task 7: Integration & Verification

### Files Modified
- `src/lib/chat-tools.ts` — Replaced `query` property with `keywords` array in SEARCH_FOOD_LOG_TOOL schema; updated executeSearchFoodLog to read keywords; added mutual exclusivity note to tool description
- `src/lib/food-log.ts` — Changed searchFoods signature from `query: string` to `keywords: string[]`; replaced `.includes()` with `computeMatchRatio() >= 0.5`; added case-insensitive normalization of existing keywords
- `src/lib/claude.ts` — Changed CLAUDE_MODEL to `claude-sonnet-4-6`; changed WEB_SEARCH_TOOL type to `web_search_20260209`; updated function signatures to use `Anthropic.Messages.ToolUnion`
- `src/lib/claude-usage.ts` — Added `claude-sonnet-4-6` pricing entry ($3/$15 per MTok)
- `src/app/api/search-foods/route.ts` — Converted free-text query to keywords array; added whitespace-only query validation
- `src/lib/__tests__/chat-tools.test.ts` — Updated schema and execution tests for keywords
- `src/lib/__tests__/food-log.test.ts` — Rewrote searchFoods tests for keyword-based matching; added case-insensitivity test
- `src/lib/__tests__/claude.test.ts` — Replaced model and web search tool references (~30 occurrences)
- `src/lib/__tests__/claude-usage.test.ts` — Added Sonnet 4.6 pricing test
- `src/app/api/health/__tests__/route.test.ts` — Updated model references
- `src/components/__tests__/about-section.test.tsx` — Updated model references
- `src/app/api/search-foods/__tests__/route.test.ts` — Updated assertions for keyword arrays; added whitespace-only test
- `package.json` — Bumped `@anthropic-ai/sdk` to 0.75.0

### Linear Updates
- FOO-581: Todo → In Progress → Review
- FOO-582: Todo → In Progress → Review
- FOO-583: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (3 fixed: case-sensitive keyword matching, whitespace-only query edge case, mutual exclusivity documentation; 1 skipped as false positive: non-nullable schema in non-strict mode)
- verifier: All 1919 tests pass, zero warnings, build clean

### Review Findings

Files reviewed: 13
Reviewers: security, reliability, quality (single-agent, fly solo)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-581: Review → Merge
- FOO-582: Review → Merge
- FOO-583: Review → Merge

<!-- REVIEW COMPLETE -->

### E2E Test Results

1 failure out of 115 E2E tests:
- `quick-select.spec.ts:84` "search input filters results" — `searchFoods` returns empty because seed data has no `keywords` field

### Linear Updates (E2E findings)
- FOO-584: Created in Todo (Fix: E2E seed data missing keywords)

### Continuation Status
E2E tests revealed missing seed data. Fix Plan below.

---

## Fix Plan

**Source:** E2E test failure from Iteration 1 review
**Linear Issues:** [FOO-584](https://linear.app/lw-claude/issue/FOO-584/e2e-seed-data-missing-keywords-field-for-custom-foods)

### Fix 1: Add keywords to E2E seed custom foods
**Linear Issue:** [FOO-584](https://linear.app/lw-claude/issue/FOO-584/e2e-seed-data-missing-keywords-field-for-custom-foods)

1. Update `e2e/fixtures/db.ts` — add `keywords` arrays to each seeded custom food insert:
   - "Grilled Chicken Breast" → `["grilled", "chicken", "breast"]`
   - "Brown Rice" → `["brown", "rice"]`
   - "Steamed Broccoli" → `["steamed", "broccoli"]`
2. Run E2E tests to verify the fix: `npm run e2e`
