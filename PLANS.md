# Implementation Plan

**Created:** 2026-03-09
**Source:** Inline request: Auto User Profile — build a dynamic user profile from DB data and inject into Claude's system prompt
**Linear Issues:** [FOO-856](https://linear.app/lw-claude/issue/FOO-856/create-builduserprofile-function), [FOO-857](https://linear.app/lw-claude/issue/FOO-857/refactor-system-prompt-to-accept-dynamic-profile-injection), [FOO-858](https://linear.app/lw-claude/issue/FOO-858/integrate-dynamic-profile-into-claude-api-functions), [FOO-859](https://linear.app/lw-claude/issue/FOO-859/remove-auto-user-profile-from-roadmapmd)
**Branch:** feat/auto-user-profile

## Context Gathered

### Codebase Analysis
- **Related files:** `src/lib/claude.ts` (system prompts at lines 29-33, 41-84, 573-595, 1735-1751; functions `analyzeFood` line 1150, `conversationalRefine` line 1486, `editAnalysis` line 1763, `runToolLoop` line 816), `src/lib/food-log.ts` (`getCommonFoods` line 251, `searchFoods` line 810, `getDailyNutritionSummary` line 984), `src/lib/nutrition-goals.ts` (`getCalorieGoalsByDateRange` line 32), `src/lib/lumen.ts` (`getLumenGoalsByDate` line 226), `src/lib/chat-tools.ts` (tool definitions and execution), `src/app/api/analyze-food/route.ts`, `src/app/api/chat-food/route.ts`, `src/app/api/edit-chat/route.ts`
- **Existing patterns:** All three API routes obtain `userId` from `session!.userId` and `currentDate` from client or `getTodayDate()`. System prompts are static constants derived from `SYSTEM_PROMPT`. Prompt caching uses `cache_control: { type: "ephemeral" }` on the system content block. `getCommonFoods()` already scores foods by frequency with time-decay (Gaussian kernel, recency, day-of-week). `getDailyNutritionSummary()` returns `NutritionSummary` with `.totals` (calories, macros). `getCalorieGoalsByDateRange()` and `getLumenGoalsByDate()` return goals for a date.
- **Test conventions:** Colocated `__tests__/` dirs, Vitest + Testing Library. DB mocked via `vi.mock("@/db/index")` with chained query builders. Logger mocked. Real schema types imported via `importOriginal()`.

### MCP Context
- **MCPs used:** Linear
- **Findings:** Linear backlog is empty — no overlapping issues for user profile or system prompt personalization.

## Tasks

### Task 1: Create `buildUserProfile()` function
**Linear Issue:** [FOO-856](https://linear.app/lw-claude/issue/FOO-856/create-builduserprofile-function)
**Files:**
- `src/lib/__tests__/user-profile.test.ts` (create)
- `src/lib/user-profile.ts` (create)

**Steps:**
1. Write tests for `buildUserProfile(userId, currentDate)`:
   - When user has calorie goal + lumen goals + food log entries + today's progress → returns formatted profile string containing all sections (goals, top foods, meal patterns, today's progress)
   - When user has calorie goal but no lumen goals → profile includes calorie goal, omits macro goals
   - When user has no data at all (new user) → returns `null`
   - When user has only a few entries (3 foods, no goals) → returns partial profile with available data
   - When today has no logged food yet → today's progress section shows 0/goal or is omitted
   - Profile string stays under 300 tokens (~1200 characters). Assert max length.
2. Run verifier with test pattern (expect fail)
3. Implement `buildUserProfile(userId: string, currentDate: string): Promise<string | null>` in `src/lib/user-profile.ts`:
   - Run 4 queries in parallel via `Promise.all`:
     - `getCalorieGoalsByDateRange(userId, currentDate, currentDate)` — today's calorie goal
     - `getLumenGoalsByDate(userId, currentDate)` — today's macro goals
     - `getTopFoodsByFrequency(userId, currentDate)` — new private helper (see below)
     - `getDailyNutritionSummary(userId, currentDate)` — today's totals for progress
   - `getTopFoodsByFrequency` is a new private function in user-profile.ts: query `food_log_entries` joined with `custom_foods` for last 90 days, group by `customFoodId`, count occurrences, sort by count DESC, limit 10. Return `{ foodName, calories, count }[]`. Simpler than `getCommonFoods()` — no time-of-day scoring needed, just raw frequency.
   - Build profile string in structured format. Priority order when truncating to fit 300 token budget: (1) goals, (2) today's progress, (3) top foods by frequency, (4) meal patterns.
   - Derive meal patterns from today's `NutritionSummary.meals` array: count meals per typical day, extract common meal times from `food_log_entries` (average first meal time, average last meal time over last 14 days).
   - If all queries return empty/null, return `null`.
   - Profile format example: `"User profile: Targets 2200 cal/day (P:140g C:220g F:80g). Today so far: 1450 cal (66%), P:95g C:180g F:52g. Top foods: medialunas (×32, 180cal), café con leche (×28, 90cal), milanesa con ensalada (×15, 650cal). Typically 3-4 meals/day, lunch 12:30-13:30, dinner 20:30-21:30."`
4. Run verifier with test pattern (expect pass)

**Notes:**
- Follow the pattern in `src/lib/nutrition-goals.ts` for module structure (direct function exports, optional Logger param)
- DB queries use `getDb()` singleton from `@/db/index`
- Mock DB the same way as `src/lib/__tests__/food-log.test.ts`
- For meal patterns (average meal times), query last 14 days of `food_log_entries` grouped by `mealTypeId`, compute average time per meal type. Only include meal types with 3+ occurrences.
- The top foods query is intentionally simpler than `getCommonFoods()` — we want plain frequency counts, not time-weighted scores. The profile should reflect overall eating habits, not just what's relevant right now.

### Task 2: Refactor system prompt to accept dynamic profile injection
**Linear Issue:** [FOO-857](https://linear.app/lw-claude/issue/FOO-857/refactor-system-prompt-to-accept-dynamic-profile-injection)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write tests:
   - `getSystemPrompt(userId, currentDate)` returns the base `SYSTEM_PROMPT` text plus the profile block when user has data
   - `getSystemPrompt(userId, currentDate)` returns just the base `SYSTEM_PROMPT` when `buildUserProfile` returns `null` (new user)
   - `ANALYSIS_SYSTEM_PROMPT`, `CHAT_SYSTEM_PROMPT`, `EDIT_SYSTEM_PROMPT` — verify they still contain the expected role-specific instructions when generated with a profile
   - Verify the profile block appears AFTER the base instructions (important for prompt caching — static prefix stays cacheable)
2. Run verifier with test pattern (expect fail)
3. Implement the refactor in `src/lib/claude.ts`:
   - Keep `SYSTEM_PROMPT` as the static constant (unchanged)
   - Add new async function `getSystemPrompt(userId: string, currentDate: string): Promise<string>` that calls `buildUserProfile(userId, currentDate)` and appends the result to `SYSTEM_PROMPT` if non-null
   - Add `getAnalysisSystemPrompt(userId, currentDate)`, `getChatSystemPrompt(userId, currentDate)`, `getEditSystemPrompt(userId, currentDate)` — each calls `getSystemPrompt()` then appends role-specific instructions (the text currently hardcoded in `ANALYSIS_SYSTEM_PROMPT`, `CHAT_SYSTEM_PROMPT`, `EDIT_SYSTEM_PROMPT`)
   - Keep the original static constants exported for backward compatibility in tests that reference them directly, but mark them with a comment that the dynamic versions should be used in production code
   - The profile block is appended to `SYSTEM_PROMPT` BEFORE the role-specific instructions. This way the static `SYSTEM_PROMPT` text is the cacheable prefix, the profile is the dynamic middle, and the role instructions follow.
4. Run verifier with test pattern (expect pass)

**Notes:**
- Mock `buildUserProfile` in claude.test.ts via `vi.mock("@/lib/user-profile")`
- The prompt caching breakpoint (`cache_control: { type: "ephemeral" }`) stays on the system content block. Since this is a single-user app, the profile content is stable across requests within the 5-minute cache TTL, so even the dynamic portion benefits from caching.
- Minimum cacheable prefix for Sonnet is 1,024 tokens. The tools array (cached separately via `buildToolsWithCache`) plus the static system prompt text exceed this threshold.

### Task 3: Integrate profile into API routes
**Linear Issue:** [FOO-858](https://linear.app/lw-claude/issue/FOO-858/integrate-dynamic-profile-into-claude-api-functions)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write tests:
   - `analyzeFood()` calls `getAnalysisSystemPrompt(userId, currentDate)` and uses the returned prompt (not the static constant)
   - `conversationalRefine()` calls `getChatSystemPrompt(userId, currentDate)` and uses the returned prompt
   - `editAnalysis()` calls `getEditSystemPrompt(userId, currentDate)` and uses the returned prompt
   - `runToolLoop()` when called without a custom `systemPrompt` option, calls `getChatSystemPrompt(userId, currentDate)`
   - Verify the profile is included in the system prompt passed to the Anthropic API
2. Run verifier with test pattern (expect fail)
3. Modify each function in `src/lib/claude.ts`:
   - `analyzeFood()`: replace `const systemPrompt = \`${ANALYSIS_SYSTEM_PROMPT}\n\nToday's date is: ${currentDate}\`` with `const systemPrompt = \`${await getAnalysisSystemPrompt(userId, currentDate)}\n\nToday's date is: ${currentDate}\``
   - `conversationalRefine()`: replace `let systemPrompt = CHAT_SYSTEM_PROMPT` with `let systemPrompt = await getChatSystemPrompt(userId!, currentDate!)`  (userId is already available — it's an existing param)
   - `editAnalysis()`: replace `let systemPrompt = EDIT_SYSTEM_PROMPT` with `let systemPrompt = await getEditSystemPrompt(userId, currentDate)`
   - `runToolLoop()`: when no custom `systemPrompt` is provided, call `await getChatSystemPrompt(userId, currentDate)` instead of using the static `CHAT_SYSTEM_PROMPT`
   - The date appending logic (`\n\nToday's date is: ...`) stays in each function — it's already there and works correctly
4. Run verifier with test pattern (expect pass)

**Notes:**
- `conversationalRefine()` has `userId?: string` (optional). When undefined (edge case), fall back to the static `CHAT_SYSTEM_PROMPT`. Same for `currentDate`.
- `runToolLoop()` already receives `userId` and `currentDate` as required params, so no signature changes needed.
- The API route files (`src/app/api/*/route.ts`) do NOT need changes — they already pass `userId` and `currentDate` to these functions.

### Task 4: Remove Auto User Profile from ROADMAP.md
**Linear Issue:** [FOO-859](https://linear.app/lw-claude/issue/FOO-859/remove-auto-user-profile-from-roadmapmd)
**Files:**
- `ROADMAP.md` (modify)

**Steps:**
1. Remove the entire "Auto User Profile" section (from `## Auto User Profile` heading through the `---` separator after it)
2. Remove the Auto User Profile row from the Contents table
3. Check remaining features for cross-references to the removed feature — update or remove them
4. Verify file structure is clean (no orphaned separators, no broken links)

**Notes:**
- No test needed — this is documentation cleanup

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Automatically inject a personalized user profile into Claude's system prompt so every interaction starts with context about the user's goals, top foods, meal patterns, and today's progress.
**Linear Issues:** FOO-856, FOO-857, FOO-858, FOO-859
**Approach:** Create a `buildUserProfile()` function that queries existing DB tables (calorie goals, lumen goals, food log entries, custom foods) in parallel and formats a ~200-300 token profile string. Refactor the static `SYSTEM_PROMPT` constant into dynamic `getSystemPrompt()` functions that append the profile. Wire into all three Claude API entry points (`analyzeFood`, `conversationalRefine`, `editAnalysis`). Remove the feature from ROADMAP.md.
**Scope:** 4 tasks, 5 files (2 new, 3 modified), 4 test suites
**Key Decisions:** Use plain frequency counts for top foods (not time-weighted `getCommonFoods` scores). Include today's calorie/macro progress in the profile. Profile block goes between base prompt and role-specific instructions. Return `null` for new users with no data (prompt unchanged).
**Risks:** Profile generation adds one DB round-trip per API request (~5ms) — negligible vs. Claude API latency. If profile exceeds 300 tokens, truncation priority is goals > progress > top foods > meal patterns.
