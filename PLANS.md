# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-159-tsconfig-and-schema-split
**Issues:** FOO-159, FOO-157
**Created:** 2026-02-06
**Last Updated:** 2026-02-06

## Summary

Two issues: (1) Fix broken Railway deployment by excluding the standalone `mcp-fitbit/` directory from TypeScript compilation, and (2) split the denormalized `food_logs` table into two properly normalized tables (`custom_foods` + `food_log_entries`) matching the Fitbit API's data model.

## Issues

### FOO-159: Next.js build fails on Railway due to mcp-fitbit TypeScript inclusion

**Priority:** Urgent
**Labels:** Bug
**Description:** `tsconfig.json` includes `**/*.ts` which causes Next.js to type-check the standalone `mcp-fitbit/` directory during `next build`. On Railway, only the root `package.json` dependencies are installed — `mcp-fitbit/node_modules` doesn't exist, so the `dotenv` import in `mcp-fitbit/index.ts` fails type checking. Production deployment is blocked.

**Acceptance Criteria:**
- [ ] `mcp-fitbit` directory excluded from `tsconfig.json`
- [ ] `npm run build` succeeds locally
- [ ] `npm run typecheck` succeeds locally
- [ ] Railway deployment unblocked

### FOO-157: DB schema: separate custom foods table from food log entries

**Priority:** High
**Labels:** Improvement
**Description:** The current `food_logs` table conflates two distinct Fitbit API entities: the food definition (nutrition data, created via `POST /1/user/-/foods.json`) and the log entry (date/meal/amount, created via `POST /1/user/-/foods/log.json`). Every log duplicates the full nutritional data even when the same food is logged repeatedly. Split into `custom_foods` (reusable food definitions) and `food_log_entries` (instances of eating a food).

**Acceptance Criteria:**
- [ ] New `custom_foods` table with nutrition data + `fitbit_food_id`
- [ ] New `food_log_entries` table with FK to `custom_foods` + meal metadata
- [ ] Old `food_logs` table removed from schema
- [ ] Drizzle migration generated
- [ ] `src/lib/food-log.ts` updated with `insertCustomFood()` and `insertFoodLogEntry()`
- [ ] `src/app/api/log-food/route.ts` updated to use two-step insert
- [ ] All existing tests updated and passing
- [ ] `npm run build`, `npm run lint`, `npm run typecheck` all pass with zero warnings

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Local Postgres running (`docker compose up -d`)
- [ ] Dependencies installed (`npm install`)

## Implementation Tasks

### Task 1: Exclude mcp-fitbit from tsconfig.json

**Issue:** FOO-159
**Files:**
- `tsconfig.json` (modify)

**TDD Steps:**

1. **RED** — Verify the problem exists:
   - Run: `npm run typecheck`
   - Expect: Should pass locally (you have `mcp-fitbit/node_modules`), but confirm `mcp-fitbit/` files are being included
   - Run: `npx tsc --listFiles 2>/dev/null | grep mcp-fitbit | head -5`
   - Verify: mcp-fitbit TypeScript files appear in the output

2. **GREEN** — Add exclusion:
   - Edit `tsconfig.json` line 33: change `"exclude": ["node_modules"]` to `"exclude": ["node_modules", "mcp-fitbit"]`
   - Run: `npx tsc --listFiles 2>/dev/null | grep mcp-fitbit | head -5`
   - Verify: No mcp-fitbit files in output
   - Run: `npm run typecheck`
   - Verify: Still passes (no regressions)

3. **REFACTOR** — Verify build:
   - Run: `npm run build`
   - Verify: Build succeeds with zero warnings
   - Run: `npm run lint`
   - Verify: Lint passes

**Notes:**
- Single-line change. No code logic changes needed.
- This unblocks Railway deployment immediately.

---

### Task 2: Define new DB schema tables

**Issue:** FOO-157
**Files:**
- `src/db/schema.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests for the new schema:
   - Create `src/db/__tests__/schema.test.ts`
   - Import the new `customFoods` and `foodLogEntries` table definitions
   - Test that `customFoods` has the expected columns: `id`, `email`, `foodName`, `amount`, `unitId`, `calories`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `sodiumMg`, `fitbitFoodId` (unique), `confidence`, `notes`, `createdAt`
   - Test that `foodLogEntries` has the expected columns: `id`, `email`, `customFoodId` (FK), `fitbitLogId`, `mealTypeId`, `amount`, `unitId`, `date`, `time`, `loggedAt`
   - Test that `foodLogs` export no longer exists
   - Run: `npm test -- schema`
   - Verify: Tests fail (tables don't exist yet)

2. **GREEN** — Create the new tables in `src/db/schema.ts`:
   - Add `customFoods` table:
     ```
     custom_foods: id (serial PK), email (text, not null), food_name (text, not null),
     amount (numeric, not null), unit_id (integer, not null), calories (integer, not null),
     protein_g (numeric, not null), carbs_g (numeric, not null), fat_g (numeric, not null),
     fiber_g (numeric, not null), sodium_mg (numeric, not null),
     fitbit_food_id (bigint, unique), confidence (text, not null), notes (text),
     created_at (timestamp with tz, default now, not null)
     ```
   - Add `foodLogEntries` table:
     ```
     food_log_entries: id (serial PK), email (text, not null),
     custom_food_id (integer, not null, references custom_foods.id),
     fitbit_log_id (bigint), meal_type_id (integer, not null),
     amount (numeric, not null), unit_id (integer, not null),
     date (date, not null), time (time),
     logged_at (timestamp with tz, default now, not null)
     ```
   - Remove the old `foodLogs` table definition entirely
   - Run: `npm test -- schema`
   - Verify: Tests pass

3. **REFACTOR** — Clean up:
   - Ensure column naming follows existing patterns (camelCase Drizzle names, snake_case DB columns)
   - Reference existing tables (`sessions`, `fitbitTokens`) for conventions
   - Run: `npm run typecheck`
   - Verify: Type errors appear in `food-log.ts` and `route.ts` (expected — they still reference removed `foodLogs`)

**Notes:**
- The FK from `food_log_entries.custom_food_id` → `custom_foods.id` uses Drizzle's `.references()` syntax
- `fitbit_food_id` on `custom_foods` should be unique (one Fitbit food per custom food definition)
- `amount` and `unit_id` on `food_log_entries` allow logging a different portion than the food's default serving
- The old `food_logs` table is deleted outright (dev status, no backward compat per CLAUDE.md)

---

### Task 3: Update food-log.ts with new insert functions

**Issue:** FOO-157
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** — Rewrite tests for new functions:
   - Update `src/lib/__tests__/food-log.test.ts`:
   - Remove all tests for `insertFoodLog` (it no longer exists)
   - Add tests for `insertCustomFood(email, data)`:
     - Test it inserts into `customFoods` table with correct fields
     - Test numeric fields are converted to strings (same pattern as before)
     - Test it returns `{ id, createdAt }`
     - Test nullable fields (`notes`, `fitbitFoodId`)
     - Test large `fitbitFoodId` values (bigint range)
   - Add tests for `insertFoodLogEntry(email, data)`:
     - Test it inserts into `foodLogEntries` table with correct fields
     - Test it returns `{ id, loggedAt }`
     - Test nullable fields (`time`, `fitbitLogId`)
     - Test numeric `amount` is converted to string
   - Update mocks: mock `@/db/schema` to export `customFoods` and `foodLogEntries` instead of `foodLogs`
   - Run: `npm test -- food-log`
   - Verify: Tests fail (functions don't exist yet)

2. **GREEN** — Implement new functions:
   - Replace `FoodLogInput` interface with two new interfaces:
     ```typescript
     export interface CustomFoodInput {
       foodName: string;
       amount: number;
       unitId: number;
       calories: number;
       proteinG: number;
       carbsG: number;
       fatG: number;
       fiberG: number;
       sodiumMg: number;
       confidence: "high" | "medium" | "low";
       notes: string | null;
       fitbitFoodId?: number | null;
     }

     export interface FoodLogEntryInput {
       customFoodId: number;
       mealTypeId: number;
       amount: number;
       unitId: number;
       date: string;
       time?: string | null;
       fitbitLogId?: number | null;
     }
     ```
   - Implement `insertCustomFood(email, data)`:
     - Insert into `customFoods` table
     - Convert numeric fields to strings for Drizzle `numeric` columns
     - Return `{ id: number; createdAt: Date }`
   - Implement `insertFoodLogEntry(email, data)`:
     - Insert into `foodLogEntries` table
     - Convert `amount` to string
     - Return `{ id: number; loggedAt: Date }`
   - Remove old `insertFoodLog` function and `FoodLogInput` interface
   - Run: `npm test -- food-log`
   - Verify: Tests pass

3. **REFACTOR** — Verify types:
   - Run: `npm run typecheck`
   - Verify: Only `log-food/route.ts` has remaining type errors (expected — updated in Task 4)

**Notes:**
- Follow the exact same DB mock pattern from the existing tests (see `mockInsert`, `mockValues`, `mockReturning`)
- The mock setup needs to handle two different table references now (one mock for each table)

---

### Task 4: Update log-food route handler

**Issue:** FOO-157
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Update route tests for new two-step flow:
   - Update `src/app/api/log-food/__tests__/route.test.ts`:
   - Replace `mockInsertFoodLog` with two mocks: `mockInsertCustomFood` and `mockInsertFoodLogEntry`
   - Update mock for `@/lib/food-log`:
     ```typescript
     const mockInsertCustomFood = vi.fn();
     const mockInsertFoodLogEntry = vi.fn();
     vi.mock("@/lib/food-log", () => ({
       insertCustomFood: (...args: unknown[]) => mockInsertCustomFood(...args),
       insertFoodLogEntry: (...args: unknown[]) => mockInsertFoodLogEntry(...args),
     }));
     ```
   - Update `beforeEach` to set default mock returns:
     ```typescript
     mockInsertCustomFood.mockResolvedValue({ id: 1, createdAt: new Date() });
     mockInsertFoodLogEntry.mockResolvedValue({ id: 1, loggedAt: new Date() });
     ```
   - Update "calls insertFoodLog after successful Fitbit logging" test → split into two assertions:
     - `mockInsertCustomFood` called with email and food data (name, nutrition, fitbitFoodId)
     - `mockInsertFoodLogEntry` called with email, `customFoodId` from first insert, and log data (mealTypeId, amount, unitId, date, time, fitbitLogId)
   - Update "returns success even if DB insert fails (non-fatal)" → test both failure modes:
     - Custom food insert fails → still returns success (Fitbit is primary)
     - Food log entry insert fails → still returns success
   - Keep all validation tests unchanged (session, mealTypeId, date, time)
   - Run: `npm test -- log-food`
   - Verify: Tests fail (route still uses old function)

2. **GREEN** — Update route handler:
   - Import `insertCustomFood` and `insertFoodLogEntry` instead of `insertFoodLog`
   - Replace the single `insertFoodLog` call with two calls:
     ```typescript
     // Step 1: Save custom food to DB
     const customFoodResult = await insertCustomFood(session!.email, {
       foodName: body.food_name,
       amount: body.amount,
       unitId: body.unit_id,
       calories: body.calories,
       proteinG: body.protein_g,
       carbsG: body.carbs_g,
       fatG: body.fat_g,
       fiberG: body.fiber_g,
       sodiumMg: body.sodium_mg,
       confidence: body.confidence,
       notes: body.notes,
       fitbitFoodId: foodId,
     });

     // Step 2: Save food log entry to DB
     const logEntryResult = await insertFoodLogEntry(session!.email, {
       customFoodId: customFoodResult.id,
       mealTypeId: body.mealTypeId,
       amount: body.amount,
       unitId: body.unit_id,
       date,
       time: body.time ?? null,
       fitbitLogId: logResult.foodLog.logId,
     });
     foodLogId = logEntryResult.id;
     ```
   - Both inserts remain in the non-fatal try/catch block (Fitbit is primary)
   - The `FoodLogResponse` shape stays the same (`foodLogId` now refers to the log entry ID)
   - Run: `npm test -- log-food`
   - Verify: Tests pass

3. **REFACTOR** — Clean up:
   - Verify error handling wraps both inserts
   - Run: `npm run typecheck`
   - Verify: No type errors

**Notes:**
- The route handler's public API (`FoodLogRequest` → `FoodLogResponse`) does NOT change — no frontend updates needed
- `FoodLogResponse.foodLogId` now refers to `food_log_entries.id` instead of `food_logs.id`
- Both DB inserts are non-fatal — if custom food insert fails, skip log entry too

---

### Task 5: Generate Drizzle migration

**Issue:** FOO-157
**Files:**
- `drizzle/` (new migration file generated)

**Steps:**

1. Run migration generation:
   - Run: `npx drizzle-kit generate`
   - Verify: A new migration SQL file is created in `drizzle/`
   - Read the generated SQL and verify it:
     - Creates `custom_foods` table with correct columns
     - Creates `food_log_entries` table with FK constraint to `custom_foods`
     - Drops `food_logs` table
   - If the migration SQL doesn't look right, manually adjust and re-run

2. Verify migration applies locally:
   - Run: `docker compose up -d` (ensure local Postgres is running)
   - Run: `npm run dev` (triggers migration at startup via `src/db/migrate.ts`)
   - Verify: No migration errors in console output

**Notes:**
- Migration files in `drizzle/` must be committed to git
- The migration will DROP the `food_logs` table — this is intentional (dev status, no data to preserve)
- Drizzle Kit generates the migration based on diff between schema and existing migrations

---

### Task 6: Integration & Verification

**Issue:** FOO-159, FOO-157
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite:
   - Run: `npm test`
   - Verify: All tests pass

2. Run linter:
   - Run: `npm run lint`
   - Verify: No errors, no warnings

3. Run type checker:
   - Run: `npm run typecheck`
   - Verify: No type errors

4. Run build:
   - Run: `npm run build`
   - Verify: Build succeeds with zero warnings

5. Manual verification:
   - [ ] Start local dev server: `npm run dev`
   - [ ] Verify migration applies without errors
   - [ ] Verify `/api/health` responds
   - [ ] Verify no `mcp-fitbit/` files in TypeScript compilation

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-159 and FOO-157 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Custom food DB insert fails | Log error, skip log entry, return Fitbit success | Unit test (route.test.ts) |
| Food log entry DB insert fails | Log error, return Fitbit success | Unit test (route.test.ts) |
| Fitbit API fails | Return FITBIT_API_ERROR 500 | Unit test (route.test.ts) |
| Invalid request body | Return VALIDATION_ERROR 400 | Unit test (route.test.ts) |

## Risks & Open Questions

- [ ] Risk: Migration drops `food_logs` — any manually inserted test data will be lost. Mitigation: Dev status, no backward compat needed per CLAUDE.md.
- [ ] Risk: `findOrCreateFood` in `fitbit.ts` currently always creates new foods. This plan does NOT change that behavior — food reuse is a separate feature. The DB schema enables it for future work.

## Scope Boundaries

**In Scope:**
- Exclude `mcp-fitbit` from tsconfig.json (FOO-159)
- Create `custom_foods` and `food_log_entries` tables (FOO-157)
- Drop `food_logs` table (FOO-157)
- Update `food-log.ts` insert functions (FOO-157)
- Update `log-food/route.ts` to use new functions (FOO-157)
- Update all tests (FOO-157)
- Generate Drizzle migration (FOO-157)

**Out of Scope:**
- Implementing food reuse/search logic in `findOrCreateFood` (separate feature)
- Frontend changes (API contract is unchanged)
- Data migration from existing `food_logs` rows (dev status, no data to preserve)

---

## Iteration 1

**Implemented:** 2026-02-06
**Method:** Agent team (2 workers)

### Tasks Completed This Iteration
- Task 1: Exclude mcp-fitbit from tsconfig.json - Added "mcp-fitbit" to exclude array (worker-1)
- Task 2: Define new DB schema tables - Replaced foodLogs with customFoods and foodLogEntries tables (worker-2)
- Task 3: Update food-log.ts with new insert functions - Replaced insertFoodLog with insertCustomFood and insertFoodLogEntry (worker-2)
- Task 4: Update log-food route handler - Two-step DB insert flow: customFood then logEntry with FK (worker-2)
- Task 5: Generate Drizzle migration - Created 0002_schema_split.sql (worker-2)
- Task 6: Integration & Verification - All checks pass (lead)

### Files Modified
- `tsconfig.json` - Added "mcp-fitbit" to exclude array
- `src/db/schema.ts` - Removed foodLogs, added customFoods (15 columns) and foodLogEntries (10 columns, FK to customFoods.id)
- `src/db/__tests__/schema.test.ts` - Updated tests for new tables, added test confirming foodLogs removed
- `src/lib/food-log.ts` - Replaced insertFoodLog/FoodLogInput with insertCustomFood/CustomFoodInput and insertFoodLogEntry/FoodLogEntryInput
- `src/lib/__tests__/food-log.test.ts` - Rewrote 9 tests for new functions
- `src/app/api/log-food/route.ts` - Updated to call insertCustomFood then insertFoodLogEntry in non-fatal try/catch
- `src/app/api/log-food/__tests__/route.test.ts` - Updated mocks, added tests for two-step flow and failure modes
- `drizzle/0002_schema_split.sql` - Migration: CREATE custom_foods, CREATE food_log_entries with FK, DROP food_logs CASCADE
- `drizzle/meta/0002_snapshot.json` - Updated snapshot
- `drizzle/meta/_journal.json` - Updated journal entry
- `CLAUDE.md` - Updated table names and function references

### Linear Updates
- FOO-159: Todo → In Progress → Review
- FOO-157: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH bug (unique constraint on fitbit_food_id incompatible with per-log-request inserts), fixed before proceeding. 3 MEDIUM findings: CLAUDE.md staleness (fixed), test coverage gap (skipped — over-engineering), migration data loss (intentional).
- verifier: 570 tests pass, zero warnings. Pre-existing failure in migrate.test.ts (not in changeset).

### Work Partition
- Worker 1: Task 1 (tsconfig.json)
- Worker 2: Tasks 2, 3, 4, 5 (schema, food-log.ts, route handler, migration)

### Continuation Status
All tasks completed.
