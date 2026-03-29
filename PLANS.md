# Implementation Plan

**Created:** 2026-03-29
**Source:** Inline request: Health Readings API — blood glucose and blood pressure read/write endpoints for HealthHelper Android app
**Linear Issues:** [FOO-886](https://linear.app/lw-claude/issue/FOO-886/drizzle-schema-types-for-health-readings-glucose-blood-pressure), [FOO-887](https://linear.app/lw-claude/issue/FOO-887/health-readings-lib-module-batch-upsert-date-range-queries), [FOO-888](https://linear.app/lw-claude/issue/FOO-888/post-endpoints-for-glucose-readings-and-blood-pressure-readings), [FOO-889](https://linear.app/lw-claude/issue/FOO-889/get-endpoints-for-glucose-readings-and-blood-pressure), [FOO-890](https://linear.app/lw-claude/issue/FOO-890/update-claudemd-and-remove-health-readings-api-from-roadmap)
**Branch:** feat/health-readings-api

## Context Gathered

### Codebase Analysis
- **v1 API pattern:** All routes in `src/app/api/v1/*/route.ts` follow: auth (`validateApiRequest`) → rate limit (`checkRateLimit` at 60/min for DB routes) → input validation → lib call → `conditionalResponse`/`errorResponse`. Currently all GET-only — this adds the first POST handlers.
- **Schema patterns:** `src/db/schema.ts` uses `serial("id").primaryKey()`, `uuid("user_id").references(() => users.id)`, `timestamp(..., { withTimezone: true })`, `unique()` constraints. Tables with upsert use composite unique constraints (e.g., `lumenGoals` on userId+date).
- **Upsert pattern:** `src/lib/lumen.ts:212`, `src/lib/nutrition-goals.ts:21`, `src/lib/users.ts:16` — all use `.onConflictDoUpdate({ target: [...], set: {...} })`.
- **Lib module pattern:** Input interfaces → export insert/query functions → pino logging with action tags → always filter by userId → optional Logger param.
- **Types:** `src/types/index.ts` — interfaces for all API contracts, `ErrorCode` union type, `ApiSuccessResponse<T>`/`ApiErrorResponse` format.
- **Test pattern:** `src/app/api/v1/food-log/__tests__/route.test.ts` — mock `validateApiRequest`, `checkRateLimit`, lib functions, `createRequestLogger`. Test auth/rate-limit/validation/success/error paths.
- **Date validation:** `isValidDateFormat()` in `src/lib/date-utils.ts` validates YYYY-MM-DD format.

### MCP Context
- **MCPs used:** Linear (issue tracking)
- **Findings:** No existing Linear issues related to health readings. Backlog and Todo are empty. Team: "Food Scanner", prefix: FOO-xxx.

## Tasks

### Task 1: Drizzle schema + types for health readings
**Linear Issue:** [FOO-886](https://linear.app/lw-claude/issue/FOO-886/drizzle-schema-types-for-health-readings-glucose-blood-pressure)
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)

**Steps:**
1. Write tests are not needed for schema definitions (Drizzle schema is declarative; types are compile-time checked).
2. Add two new tables to `src/db/schema.ts`:
   - `glucoseReadings` table: `id` (serial PK), `userId` (uuid FK → users), `measuredAt` (timestamptz, not null), `zoneOffset` (varchar(6), nullable), `valueMgDl` (numeric, not null), `relationToMeal` (text, nullable — values: `general`, `fasting`, `before_meal`, `after_meal`, `unknown`), `mealType` (text, nullable — values: `breakfast`, `lunch`, `dinner`, `snack`, `unknown`), `specimenSource` (text, nullable — values: `capillary_blood`, `interstitial_fluid`, `plasma`, `serum`, `tears`, `whole_blood`, `unknown`). Unique constraint on `(userId, measuredAt)`.
   - `bloodPressureReadings` table: `id` (serial PK), `userId` (uuid FK → users), `measuredAt` (timestamptz, not null), `zoneOffset` (varchar(6), nullable), `systolic` (integer, not null), `diastolic` (integer, not null), `bodyPosition` (text, nullable — values: `standing_up`, `sitting_down`, `lying_down`, `reclining`, `unknown`), `measurementLocation` (text, nullable — values: `left_upper_arm`, `right_upper_arm`, `left_wrist`, `right_wrist`, `unknown`). Unique constraint on `(userId, measuredAt)`.
   - Import `varchar` from `drizzle-orm/pg-core` (not currently imported).
3. Add types to `src/types/index.ts`:
   - `GlucoseReading` interface (API response shape): `id`, `measuredAt` (ISO string), `zoneOffset`, `valueMgDl` (number), `relationToMeal`, `mealType`, `specimenSource`.
   - `BloodPressureReading` interface (API response shape): `id`, `measuredAt` (ISO string), `zoneOffset`, `systolic`, `diastolic`, `bodyPosition`, `measurementLocation`.
   - `GlucoseReadingInput` interface (POST body item): same fields minus `id`, `measuredAt` is string.
   - `BloodPressureReadingInput` interface (POST body item): same fields minus `id`, `measuredAt` is string.
4. Run `npx drizzle-kit generate` to create the migration.
5. Run verifier (expect pass — schema + types are additive).

**Notes:**
- Follow `lumenGoals` pattern for composite unique constraint syntax.
- No `createdAt`/`updatedAt` columns — only the measurement `measuredAt` timestamp (per user decision).
- **Migration note:** Two new tables (`glucose_readings`, `blood_pressure_readings`). No existing data affected — additive DDL only.

### Task 2: Health readings lib module
**Linear Issue:** [FOO-887](https://linear.app/lw-claude/issue/FOO-887/health-readings-lib-module-batch-upsert-date-range-queries)
**Files:**
- `src/lib/health-readings.ts` (create)
- `src/lib/__tests__/health-readings.test.ts` (create)

**Steps:**
1. Write tests in `src/lib/__tests__/health-readings.test.ts`:
   - **Glucose upsert tests:**
     - Batch insert calls `db.insert(glucoseReadings).values(...).onConflictDoUpdate(...)` with correct target `[glucoseReadings.userId, glucoseReadings.measuredAt]`
     - Returns upserted count
     - Empty array input returns 0 count without DB call
   - **Blood pressure upsert tests:**
     - Same pattern as glucose, targeting `bloodPressureReadings` table
     - Returns upserted count
     - Empty array input returns 0
   - **Glucose query tests:**
     - Single date: filters by userId + measuredAt between start-of-day and end-of-day, ordered by measuredAt ascending
     - Date range: filters by userId + measuredAt between `from` and `to` (inclusive end-of-day), ordered by measuredAt ascending
   - **Blood pressure query tests:**
     - Same patterns as glucose queries
   - Follow mock patterns from `src/lib/__tests__/nutrition-goals.test.ts` (mock `getDb`, mock chain for insert + select).
2. Run verifier (expect fail).
3. Implement `src/lib/health-readings.ts`:
   - `upsertGlucoseReadings(userId: string, readings: GlucoseReadingInput[]): Promise<number>` — batch upsert using `onConflictDoUpdate` on `(userId, measuredAt)`. Update all fields on conflict. Return readings.length (or 0 for empty input, skip DB call).
   - `upsertBloodPressureReadings(userId: string, readings: BloodPressureReadingInput[]): Promise<number>` — same pattern.
   - `getGlucoseReadings(userId: string, from: string, to: string): Promise<GlucoseReading[]>` — query by date range (convert YYYY-MM-DD to timestamptz bounds: from = `{from}T00:00:00.000Z`, to = `{to}T23:59:59.999Z`). Order by measuredAt ascending.
   - `getBloodPressureReadings(userId: string, from: string, to: string): Promise<BloodPressureReading[]>` — same pattern.
   - Map DB rows to API response types (numeric → number conversions).
   - Pino logging with action tags: `upsert_glucose_readings`, `upsert_blood_pressure_readings`, `get_glucose_readings`, `get_blood_pressure_readings`.
4. Run verifier (expect pass).

**Notes:**
- Follow `src/lib/nutrition-goals.ts` as the closest pattern (upsert on composite unique + date-range queries).
- For batch upsert, Drizzle's `.values(arrayOfObjects)` accepts arrays directly.
- Date-to-timestamptz conversion: single date `?date=2026-03-28` becomes from=`2026-03-28`, to=`2026-03-28`. The lib function always takes from+to — the route handler normalizes single date to same-day range.

### Task 3: POST endpoints for health readings
**Linear Issue:** [FOO-888](https://linear.app/lw-claude/issue/FOO-888/post-endpoints-for-glucose-readings-and-blood-pressure-readings)
**Files:**
- `src/app/api/v1/glucose-readings/route.ts` (create)
- `src/app/api/v1/blood-pressure-readings/route.ts` (create)
- `src/app/api/v1/glucose-readings/__tests__/route.test.ts` (create)
- `src/app/api/v1/blood-pressure-readings/__tests__/route.test.ts` (create)

**Steps:**
1. Write tests in `src/app/api/v1/glucose-readings/__tests__/route.test.ts`:
   - Valid POST with array of readings → 200, returns `{ upserted: N }`
   - 401 for missing/invalid auth
   - 429 when rate limit exceeded
   - 400 for missing `readings` array in body
   - 400 for reading missing required fields (`measuredAt`, `valueMgDl`)
   - 400 for invalid `measuredAt` (not ISO 8601)
   - 400 for invalid enum values (e.g., `relationToMeal: "invalid"`)
   - 200 for empty readings array (returns `{ upserted: 0 }`)
   - 500 when lib function throws
   - Follow test pattern from `src/app/api/v1/food-log/__tests__/route.test.ts`.
2. Write tests in `src/app/api/v1/blood-pressure-readings/__tests__/route.test.ts`:
   - Same test cases, adapted for BP fields (`systolic`, `diastolic` required, `bodyPosition`, `measurementLocation` optional).
3. Run verifier (expect fail).
4. Implement `src/app/api/v1/glucose-readings/route.ts`:
   - Export `POST` handler following standard v1 pattern: `validateApiRequest` → rate limit (60/min, key `v1:glucose-readings:${hash}`) → parse JSON body → validate `readings` is array → validate each reading has required fields and valid enum values → call `upsertGlucoseReadings` → return `successResponse({ upserted: count })`.
   - Validation: `measuredAt` must be valid ISO 8601 string (use `!isNaN(Date.parse(value))`), `valueMgDl` must be number > 0, optional string enums must be from allowed sets.
5. Implement `src/app/api/v1/blood-pressure-readings/route.ts`:
   - Same pattern. Validation: `systolic` and `diastolic` must be positive integers.
6. Run verifier (expect pass).

**Notes:**
- These are the first POST handlers in the v1 API. The auth/rate-limit/response pattern is identical to GET routes.
- Use `successResponse` (not `conditionalResponse`) for POST responses — ETags don't apply to mutations.
- Enum validation sets:
  - `relationToMeal`: `general`, `fasting`, `before_meal`, `after_meal`, `unknown`
  - `mealType`: `breakfast`, `lunch`, `dinner`, `snack`, `unknown`
  - `specimenSource`: `capillary_blood`, `interstitial_fluid`, `plasma`, `serum`, `tears`, `whole_blood`, `unknown`
  - `bodyPosition`: `standing_up`, `sitting_down`, `lying_down`, `reclining`, `unknown`
  - `measurementLocation`: `left_upper_arm`, `right_upper_arm`, `left_wrist`, `right_wrist`, `unknown`

### Task 4: GET endpoints for health readings
**Linear Issue:** [FOO-889](https://linear.app/lw-claude/issue/FOO-889/get-endpoints-for-glucose-readings-and-blood-pressure)
**Files:**
- `src/app/api/v1/glucose-readings/route.ts` (modify — add GET export)
- `src/app/api/v1/blood-pressure-readings/route.ts` (modify — add GET export)
- `src/app/api/v1/glucose-readings/__tests__/route.test.ts` (modify — add GET tests)
- `src/app/api/v1/blood-pressure-readings/__tests__/route.test.ts` (modify — add GET tests)

**Steps:**
1. Add GET tests to `src/app/api/v1/glucose-readings/__tests__/route.test.ts`:
   - Single date: `?date=2026-03-28` → returns readings array ordered by measuredAt
   - Date range: `?from=2026-03-01&to=2026-03-28` → returns readings in range
   - 400 for missing both `date` and `from`/`to` params
   - 400 for `from` without `to` (and vice versa)
   - 400 for invalid date format
   - 401, 429, 500 cases (same as POST tests)
   - ETag support: response includes ETag header, 304 on matching If-None-Match
   - Empty result → 200 with empty array
2. Add GET tests to blood pressure test file (same patterns).
3. Run verifier (expect fail).
4. Add `GET` export to `src/app/api/v1/glucose-readings/route.ts`:
   - Standard v1 GET pattern: auth → rate limit → parse query params → validate → call `getGlucoseReadings` → `conditionalResponse`.
   - Two query modes: `?date=YYYY-MM-DD` (single date, normalized to from=date, to=date) or `?from=YYYY-MM-DD&to=YYYY-MM-DD` (range). Validate all dates with `isValidDateFormat`.
5. Add `GET` export to blood pressure route (same pattern).
6. Run verifier (expect pass).

**Notes:**
- GET uses `conditionalResponse` (ETag support), matching existing v1 GET routes.
- Date range validation: `from` must not be after `to`.

### Task 5: Update CLAUDE.md and remove roadmap item
**Linear Issue:** [FOO-890](https://linear.app/lw-claude/issue/FOO-890/update-claudemd-and-remove-health-readings-api-from-roadmap)
**Files:**
- `CLAUDE.md` (modify)
- `ROADMAP.md` (modify)

**Steps:**
1. Update `CLAUDE.md`:
   - Add `glucose_readings` and `blood_pressure_readings` to the DATABASE tables list.
   - Add the four new API routes to the SECURITY section's API route auth convention list under `src/app/api/v1/*`.
2. Remove the "Health Readings API" section from `ROADMAP.md`:
   - Delete the entire feature section (from `## Health Readings API` through the `---` separator).
   - Remove the row from the Contents table.
   - Check for broken cross-references in remaining features.
3. Run verifier (expect pass — no code changes, just docs).

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add blood glucose and blood pressure read/write API endpoints for the HealthHelper Android app to sync health data to Food Scanner's database.
**Linear Issues:** FOO-886, FOO-887, FOO-888, FOO-889, FOO-890
**Approach:** Two new Drizzle tables with composite unique constraints for idempotent upserts. Four new v1 API routes (POST + GET for each reading type) following established auth/rate-limit/response patterns. Lib module with batch upsert and date-range query functions.
**Scope:** 5 tasks, 10 files (4 create, 6 modify), ~16 test scenarios per endpoint
**Key Decisions:** String enums (not integers) for Health Connect metadata fields; only measurement timestamp (no createdAt/updatedAt); zoneOffset stored as varchar(6); mg/dL for glucose storage; numeric type for glucose values, integer for blood pressure
**Risks:** First POST handlers in v1 API — need to verify middleware.ts matcher covers POST methods (it should, as it matches on path not method)

---

## Iteration 1

**Implemented:** 2026-03-29
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Drizzle schema + types for health readings — Added `glucoseReadings` and `bloodPressureReadings` tables, 4 TypeScript interfaces (worker-1)
- Task 2: Health readings lib module — Created `src/lib/health-readings.ts` with batch upsert and date-range query functions, 10 unit tests (worker-1)
- Task 3: POST endpoints — Created POST handlers for glucose-readings and blood-pressure-readings with full validation, 28 tests (worker-2)
- Task 4: GET endpoints — Added GET handlers with single-date and date-range query modes, ETag support, 27 tests (worker-2)
- Task 5: Documentation — Updated CLAUDE.md tables list, removed Health Readings API from ROADMAP.md (lead)

### Files Modified
- `src/db/schema.ts` — Added glucoseReadings and bloodPressureReadings tables
- `src/types/index.ts` — Added GlucoseReading, BloodPressureReading, GlucoseReadingInput, BloodPressureReadingInput interfaces
- `src/lib/health-readings.ts` — Created with upsertGlucoseReadings, upsertBloodPressureReadings, getGlucoseReadings, getBloodPressureReadings
- `src/lib/__tests__/health-readings.test.ts` — 10 tests for lib module
- `src/app/api/v1/glucose-readings/route.ts` — POST + GET handlers
- `src/app/api/v1/blood-pressure-readings/route.ts` — POST + GET handlers
- `src/app/api/v1/glucose-readings/__tests__/route.test.ts` — 30 tests
- `src/app/api/v1/blood-pressure-readings/__tests__/route.test.ts` — 29 tests
- `drizzle/0016_safe_domino.sql` — Migration for new tables
- `CLAUDE.md` — Added new tables to DATABASE section
- `ROADMAP.md` — Removed Health Readings API feature section

### Linear Updates
- FOO-886: Todo → In Progress → Review
- FOO-887: Todo → In Progress → Review
- FOO-888: Todo → In Progress → Review
- FOO-889: Todo → In Progress → Review
- FOO-890: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (1 critical, 3 medium), all fixed before proceeding
  - CRITICAL: onConflictDoUpdate set clause referenced existing row values instead of incoming — fixed with `sql`excluded`` pattern
  - MEDIUM: zoneOffset not validated — added ±HH:MM regex check
  - MEDIUM: UTC date boundary behavior undocumented — added JSDoc comments
  - MEDIUM: Empty array test missing mock assertion — added expect calls
- verifier: All 2887+ tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1+2 (foundation — schema, types, lib module)
- Worker 2: Tasks 3+4 (routes — POST and GET endpoints)
- Lead: Task 1 step 4 (drizzle-kit generate), Task 5 (docs), bug fixes

### Merge Summary
- Worker 1: fast-forward (first merge, no conflicts)
- Worker 2: 2 conflicts in src/types/index.ts and src/lib/health-readings.ts (worker-2 created stubs, resolved by keeping worker-1's full implementations)

### Continuation Status
All tasks completed.
