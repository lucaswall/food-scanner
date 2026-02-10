# Implementation Plan: Lumen Macro Goals via Screenshot

**Created:** 2026-02-10
**Source:** Inline request: Add Lumen metabolic tracking integration — parse Lumen app screenshots to extract daily macro targets, display on dashboard with goal-aware macro bars.
**Linear Issues:** [FOO-317](https://linear.app/lw-claude/issue/FOO-317/add-lumen-goals-db-table-and-types), [FOO-318](https://linear.app/lw-claude/issue/FOO-318/implement-lumen-screenshot-parsing-and-db-crud), [FOO-319](https://linear.app/lw-claude/issue/FOO-319/add-lumen-goals-api-route), [FOO-320](https://linear.app/lw-claude/issue/FOO-320/enhance-macrobars-with-goal-support), [FOO-321](https://linear.app/lw-claude/issue/FOO-321/create-lumenbanner-component-with-upload-flow), [FOO-322](https://linear.app/lw-claude/issue/FOO-322/integrate-lumen-goals-into-dailydashboard-and-app-page)

## Context Gathered

### Codebase Analysis
- **Dashboard page:** `src/app/app/page.tsx` — server component rendering FitbitStatusBanner, 2-button grid, DailyDashboard, DashboardPrefetch
- **DailyDashboard:** `src/components/daily-dashboard.tsx` — client component, 3 SWR calls (nutrition-summary, nutrition-goals, activity-summary)
- **MacroBars:** `src/components/macro-bars.tsx` — shows consumed grams with relative % bars (no goal support)
- **CalorieRing:** `src/components/calorie-ring.tsx` — SVG ring with Fitbit calorie goal + budget marker
- **NutritionGoals type:** `{ calories: number | null }` from Fitbit API only
- **Anthropic pattern:** `src/lib/claude.ts` — singleton client, tool_use forced extraction, `ImageInput` type `{ base64, mimeType }`
- **Upsert pattern:** `src/lib/users.ts`, `src/lib/fitbit-tokens.ts` — `onConflictDoUpdate` with `.unique()` columns
- **Image validation:** `src/lib/image-validation.ts` — `isFileLike`, `ALLOWED_TYPES`, `MAX_IMAGE_SIZE`
- **Rate limiting:** `src/lib/rate-limit.ts` — `checkRateLimit(key, max, windowMs)`
- **API pattern:** `getSession()` → `validateSession()` → business logic → `successResponse()`/`errorResponse()`
- **DB schema:** `src/db/schema.ts` — 6 tables, composite unique via Drizzle 0.45 `unique().on()` syntax
- **Error codes:** `src/types/index.ts:106-120` — union type `ErrorCode`

### Design Decisions (from discussion)
- **CalorieRing stays on Fitbit calorie goal** — Fitbit knows total energy budget (activity + weight goal). Lumen only provides macro distribution.
- **MacroBars show consumed/goal** — "XX / YYg" text, bars fill to 100% of goal. No "remaining" text.
- **Keep them independent** — gap between Lumen-implied calories and Fitbit covers alcohol, fiber rounding, different models.
- **Haiku for parsing** — simple structured text extraction, no reasoning needed.

## Original Plan

### Task 1: Add lumen_goals DB table and types
**Linear Issue:** [FOO-317](https://linear.app/lw-claude/issue/FOO-317/add-lumen-goals-db-table-and-types)

**Migration note:** New table, no existing data to transform. DDL-only migration.

1. Write test in `src/db/__tests__/schema.test.ts` (or verify schema compiles) — validate `lumenGoals` table export exists with expected columns (userId, date, dayType, proteinGoal, carbsGoal, fatGoal)
2. Add `lumenGoals` table to `src/db/schema.ts`:
   - Columns: id (serial PK), userId (UUID FK → users), date (date), dayType (text), proteinGoal (integer), carbsGoal (integer), fatGoal (integer), createdAt, updatedAt (timestamps)
   - Composite unique constraint on (userId, date) — use Drizzle `unique("lumen_goals_user_date_uniq").on(table.userId, table.date)` pattern
3. Run `npx drizzle-kit generate` to create migration SQL
4. Add types to `src/types/index.ts`:
   - `LumenGoals` interface: `{ date: string; dayType: string; proteinGoal: number; carbsGoal: number; fatGoal: number }`
   - `LumenGoalsResponse` interface: `{ goals: LumenGoals | null }`
   - Add `"LUMEN_PARSE_ERROR"` to `ErrorCode` union
5. Run verifier

### Task 2: Implement Lumen screenshot parsing and DB CRUD
**Linear Issue:** [FOO-318](https://linear.app/lw-claude/issue/FOO-318/implement-lumen-screenshot-parsing-and-db-crud)

1. Write tests in `src/lib/__tests__/lumen.test.ts` following `src/lib/__tests__/claude.test.ts` patterns:
   - **Parsing tests** (mock `@anthropic-ai/sdk`):
     - Valid tool_use response returns parsed goals (dayType, proteinGoal, carbsGoal, fatGoal)
     - Uses `claude-haiku-4-5-20251001` model
     - Uses `max_tokens: 256`
     - Forces `tool_choice: { type: "tool", name: "report_lumen_goals" }`
     - Throws `LUMEN_PARSE_ERROR` on API failure
     - Throws `LUMEN_PARSE_ERROR` when no tool_use content block
     - Throws `LUMEN_PARSE_ERROR` when goals are negative or zero
     - Throws `LUMEN_PARSE_ERROR` when day_type is empty
   - **DB CRUD tests** (mock `@/db/index`):
     - `upsertLumenGoals` calls insert with onConflictDoUpdate
     - `getLumenGoalsByDate` returns goals when row exists
     - `getLumenGoalsByDate` returns null when no row
2. Run verifier (expect fail)
3. Implement `src/lib/lumen.ts`:
   - Own Anthropic client singleton (separate from claude.ts — different model, simpler config)
   - `parseLumenScreenshot(image: ImageInput)` — system prompt tells model to extract target values only (numbers after the slash), not consumed values. Tool schema: `report_lumen_goals` with `day_type` (string), `protein_goal`, `carbs_goal`, `fat_goal` (numbers). Validate non-negative integers.
   - Custom `LumenParseError` class with `name: "LUMEN_PARSE_ERROR"`
   - `upsertLumenGoals(userId, date, data)` — insert + onConflictDoUpdate targeting composite unique on (userId, date)
   - `getLumenGoalsByDate(userId, date)` — select where userId AND date, return `LumenGoals | null`
   - Reuse `ImageInput` type from `src/lib/claude.ts`
4. Run verifier (expect pass)

### Task 3: Add Lumen goals API route
**Linear Issue:** [FOO-319](https://linear.app/lw-claude/issue/FOO-319/add-lumen-goals-api-route)

1. Write tests in `src/app/api/lumen-goals/__tests__/route.test.ts` following `src/app/api/analyze-food/__tests__/route.test.ts` patterns:
   - **GET tests:**
     - Returns 401 without session
     - Returns 400 for missing date param
     - Returns 400 for invalid date format
     - Returns `{ goals: null }` when no goals exist
     - Returns goals when they exist
     - Sets `Cache-Control: private, no-cache`
     - Does NOT require Fitbit connection (Lumen is independent)
   - **POST tests:**
     - Returns 401 without session
     - Returns 429 when rate limited
     - Returns 400 for invalid/missing FormData
     - Returns 400 for missing image
     - Returns 400 for invalid image type
     - Returns 400 for oversized image
     - Returns parsed+saved goals on success
     - Returns error with LUMEN_PARSE_ERROR when parsing fails
     - Does NOT require Fitbit connection
     - Accepts optional `date` field in FormData (defaults to today)
2. Run verifier (expect fail)
3. Implement `src/app/api/lumen-goals/route.ts`:
   - **GET:** `getSession()` → `validateSession(session)` (no `requireFitbit`) → validate date param → `getLumenGoalsByDate()` → `successResponse({ goals })` + Cache-Control header
   - **POST:** `getSession()` → `validateSession(session)` → rate limit (20 req / 15 min) → parse FormData → validate single image (reuse `isFileLike`, `ALLOWED_TYPES`, `MAX_IMAGE_SIZE`) → convert to base64 → `parseLumenScreenshot()` → `upsertLumenGoals()` → `successResponse(goals)`. Catch `LUMEN_PARSE_ERROR` → `errorResponse("LUMEN_PARSE_ERROR", ..., 422)`
4. Run verifier (expect pass)

### Task 4: Enhance MacroBars with goal support
**Linear Issue:** [FOO-320](https://linear.app/lw-claude/issue/FOO-320/enhance-macrobars-with-goal-support)

1. Update tests in `src/components/__tests__/macro-bars.test.tsx`:
   - Existing tests must still pass (backward compat — no goals = current behavior)
   - New: when all three goals provided, shows "XX / YYg" format for each macro
   - New: bar width = `consumed / goal * 100%` capped at 100% (not relative to total consumed)
   - New: when consumed exceeds goal, bar is at 100% (visually full)
   - New: when only some goals provided, only those macros show goal format (partial goals)
2. Run verifier (expect fail)
3. Modify `src/components/macro-bars.tsx`:
   - Add optional `proteinGoal`, `carbsGoal`, `fatGoal` props to interface
   - When a macro's goal is provided: bar width = `min(consumed / goal, 1) * 100%`, text shows `"XX / YYg"`
   - When no goal: keep current behavior (relative % of total consumed), text shows `"XXg"`
   - Colors stay the same (blue/green/amber)
4. Run verifier (expect pass)

### Task 5: Create LumenBanner component with upload flow
**Linear Issue:** [FOO-321](https://linear.app/lw-claude/issue/FOO-321/create-lumenbanner-component-with-upload-flow)

1. Write tests in `src/components/__tests__/lumen-banner.test.tsx`:
   - Shows banner with upload prompt when no Lumen goals for today (SWR returns `{ goals: null }`)
   - Hides banner (returns null) when goals exist for today
   - Returns null while loading (non-blocking)
   - Hidden file input is triggered by tapping the banner
   - File input accepts `image/*`
   - Shows loading spinner during upload
   - Shows error message on upload failure
   - After successful upload, SWR cache is mutated (banner hides)
2. Run verifier (expect fail)
3. Implement `src/components/lumen-banner.tsx`:
   - `'use client'` component
   - Fetches `/api/lumen-goals?date=${today}` via useSWR
   - When no goals: render tappable card/alert (primary color scheme, distinct from amber Fitbit banner) with upload icon + "Set today's macro goals" text + "Upload Lumen screenshot" subtitle
   - Hidden `<input type="file" accept="image/*">` triggered by card tap
   - On file select: POST FormData to `/api/lumen-goals` → on success, `mutate` SWR key
   - Loading state: spinner replacing icon during upload
   - Error state: inline error text below the banner
   - Touch target >= 44px
4. Run verifier (expect pass)

### Task 6: Integrate Lumen goals into DailyDashboard and app page
**Linear Issue:** [FOO-322](https://linear.app/lw-claude/issue/FOO-322/integrate-lumen-goals-into-dailydashboard-and-app-page)

1. Update tests in `src/components/__tests__/daily-dashboard.test.tsx`:
   - Mock fetch for `/api/lumen-goals?date=YYYY-MM-DD` in addition to existing mocks
   - When Lumen goals exist: MacroBars receives goal props
   - When Lumen goals exist: shows day type text (e.g., "Low carb day") above the calorie display
   - When Lumen goals fetch fails: dashboard renders normally (graceful degradation, no goals passed)
   - When Lumen goals are null: MacroBars receives no goal props (current behavior)
   - Shows "Update Lumen goals" button below MealBreakdown
   - "Update Lumen goals" button triggers file picker
2. Update tests in `src/app/app/__tests__/page.test.tsx`:
   - LumenBanner component renders between button grid and DailyDashboard
3. Run verifier (expect fail)
4. Modify `src/components/daily-dashboard.tsx`:
   - Add SWR call for `/api/lumen-goals?date=${today}` → `LumenGoalsResponse`
   - Do NOT block loading on lumen goals (dashboard renders as soon as summary + nutrition goals load; Lumen data enhances asynchronously)
   - When `lumenGoals?.goals` exists: pass `proteinGoal`, `carbsGoal`, `fatGoal` to MacroBars
   - When `lumenGoals?.goals` exists: show day type badge/text (e.g., "Low carb day" in muted text) above the calorie ring/plain display
   - Add "Update Lumen goals" button below MealBreakdown — subtle secondary style with RefreshCw icon, hidden file input pattern, POST to `/api/lumen-goals` on select, mutate SWR cache on success
5. Modify `src/app/app/page.tsx`:
   - Import and render `<LumenBanner />` between the button grid and `<DailyDashboard />`
6. Update `src/app/app/loading.tsx` — add a small skeleton placeholder between button grid and dashboard skeleton (for the banner area)
7. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add Lumen metabolic tracking integration via screenshot parsing

**Request:** Parse Lumen app screenshots to extract daily macro targets (protein, carbs, fat), store per-user per-date, and display goal-aware macro bars on the dashboard. Fitbit calorie goal stays independent.

**Linear Issues:** FOO-317, FOO-318, FOO-319, FOO-320, FOO-321, FOO-322

**Approach:** New `lumen_goals` DB table stores daily macro targets. A POST API endpoint accepts a screenshot image, parses it with Claude Haiku (tool_use for structured extraction), and upserts goals. The dashboard banner prompts screenshot upload when no goals exist for today. MacroBars enhanced to show "XX / YYg" format with progress-to-goal bars when Lumen data is available.

**Scope:**
- Tasks: 6
- Files affected: ~15 (6 new, 9 modified)
- New tests: yes

**Key Decisions:**
- Fitbit calorie goal and Lumen macro goals are independent — CalorieRing uses Fitbit, MacroBars use Lumen
- Claude Haiku 4.5 for screenshot parsing (simple extraction, cheap)
- Single image per upload (not multi-image like food analysis)
- Composite unique (userId, date) with upsert for re-uploads same day

**Risks/Considerations:**
- Lumen app UI changes could affect parsing — mitigated by generic prompt + tool_use schema
- Lumen banner adds a 4th SWR call to dashboard — non-blocking, graceful degradation on failure

---

## Iteration 1

**Implemented:** 2026-02-10
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Add lumen_goals DB table and types (FOO-317) - Added lumenGoals table with composite unique, LumenGoals/LumenGoalsResponse types, LUMEN_PARSE_ERROR error code (worker-1)
- Task 2: Implement Lumen screenshot parsing and DB CRUD (FOO-318) - Created src/lib/lumen.ts with parseLumenScreenshot() using Haiku, upsertLumenGoals(), getLumenGoalsByDate(), LumenParseError class (worker-1)
- Task 3: Add Lumen goals API route (FOO-319) - Created GET/POST endpoints with session auth, rate limiting, image validation, Haiku parsing (worker-1)
- Task 4: Enhance MacroBars with goal support (FOO-320) - Added optional goal props, "XX / YYg" format, progress-to-goal bars capped at 100% (worker-2)
- Task 5: Create LumenBanner component with upload flow (FOO-321) - Client component with SWR, file upload, loading/error states, blue color scheme (worker-3)
- Task 6: Integrate Lumen goals into DailyDashboard and app page (FOO-322) - Day type badge, MacroBars goal props, Update button, LumenBanner in app page, loading skeleton (worker-3)

### Files Modified
- `src/db/schema.ts` - Added lumenGoals table with composite unique constraint
- `src/db/__tests__/schema.test.ts` - Created with lumenGoals table validation tests
- `src/types/index.ts` - Added LumenGoals, LumenGoalsResponse interfaces, LUMEN_PARSE_ERROR error code
- `src/lib/lumen.ts` - Created: Lumen parsing with separate Anthropic client, DB CRUD
- `src/lib/__tests__/lumen.test.ts` - Created: 12 tests for parsing and DB operations
- `src/app/api/lumen-goals/route.ts` - Created: GET and POST route handlers
- `src/app/api/lumen-goals/__tests__/route.test.ts` - Created: 17 tests for API endpoints
- `src/components/macro-bars.tsx` - Added optional goal props, dual-mode bar calculation
- `src/components/__tests__/macro-bars.test.tsx` - Added 6 goal-related test cases
- `src/components/lumen-banner.tsx` - Created: Upload banner component
- `src/components/__tests__/lumen-banner.test.tsx` - Created: 8 tests for banner
- `src/components/daily-dashboard.tsx` - Added lumen-goals SWR call, day type badge, goal props, update button
- `src/components/__tests__/daily-dashboard.test.tsx` - Added 8 lumen-related test cases
- `src/app/app/page.tsx` - Added LumenBanner between button grid and DailyDashboard
- `src/app/app/__tests__/page.test.tsx` - Added LumenBanner render test
- `src/app/app/loading.tsx` - Added banner skeleton placeholder
- `drizzle/0010_elite_shiva.sql` - Generated migration for lumen_goals table
- `MIGRATIONS.md` - Logged new table migration

### Linear Updates
- FOO-317: Todo → In Progress → Review
- FOO-318: Todo → In Progress → Review
- FOO-319: Todo → In Progress → Review
- FOO-320: Todo → In Progress → Review
- FOO-321: Todo → In Progress → Review
- FOO-322: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 issues (type duplication), fixed before proceeding. Also fixed wrong DB import (`db` → `getDb()`).
- verifier: All 1,250 tests pass, zero warnings, build succeeds

### Work Partition
- Worker 1: Tasks 1, 2, 3 (backend: schema, types, lumen lib, API route)
- Worker 2: Task 4 (MacroBars goal support)
- Worker 3: Tasks 5, 6 (LumenBanner, dashboard integration)
- Lead: drizzle-kit generate, integration fixes (db import, type dedup)

### Continuation Status
All tasks completed.

## Status: COMPLETE
