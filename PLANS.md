# Implementation Plan

**Created:** 2026-03-29
**Source:** Inline request: Add zone_offset to food log entries so external readers can interpret bare date/time fields
**Linear Issues:** [FOO-894](https://linear.app/lw-claude/issue/FOO-894/schema-types-migration-for-food-log-zone-offset), [FOO-895](https://linear.app/lw-claude/issue/FOO-895/full-flow-getlocaldatetime-api-db-for-zone-offset), [FOO-896](https://linear.app/lw-claude/issue/FOO-896/expose-zone-offset-in-v1-food-log-get-response)
**Branch:** feat/food-log-zone-offset

## Context Gathered

### Codebase Analysis
- **Schema pattern:** `zoneOffset` already exists on `glucoseReadings` and `bloodPressureReadings` as `varchar("zone_offset", { length: 6 })`, nullable. Validated server-side with regex `/^[+-]\d{2}:\d{2}$/`.
- **Client date/time source:** `getLocalDateTime()` in `src/lib/meal-type.ts` reads from `new Date()` (browser local clock), returns `{ date: string; time: string }`. Called by 6 components: `food-analyzer.tsx`, `food-chat.tsx`, `quick-select.tsx`, `log-shared-content.tsx`, `pending-submission-handler.tsx`, and the `/api/analyze` route (clientDate/clientTime).
- **Component patterns:** `quick-select.tsx` uses spread `...getLocalDateTime()`, others destructure or assign individual fields. All pass `date` and `time` in POST body to `/api/log-food`.
- **API route:** `/api/log-food/route.ts` validates `date` (YYYY-MM-DD) and `time` (HH:mm or HH:mm:ss), passes through to `insertFoodLogEntry` or `insertCustomFoodWithLogEntry`.
- **Lib layer:** `FoodLogEntryInput` interface in `src/lib/food-log.ts` defines the insert shape. `insertFoodLogEntry` and `insertCustomFoodWithLogEntry` both write to `foodLogEntries` table.
- **v1 GET response:** `getDailyNutritionSummary` uses `.select()` (all columns) and manually maps to `MealEntry` interface in `src/types/index.ts`. `zoneOffset` would need to be added to `MealEntry` and the mapping at `src/lib/food-log.ts:1049-1068`.
- **Type contract:** `FoodLogRequest` in `src/types/index.ts` defines the POST body shape. Needs `zoneOffset?: string`.
- **Test files:** `src/lib/__tests__/meal-type.test.ts` (getLocalDateTime tests), `src/app/api/log-food/__tests__/` (doesn't exist as dir — tests may be inline), `src/app/api/v1/food-log/__tests__/route.test.ts` (v1 GET tests), `src/lib/__tests__/food-log.test.ts` (lib tests).

### MCP Context
- **MCPs used:** Linear (issue tracking)
- **Findings:** Team "Food Scanner", prefix FOO-xxx. Related prior work: FOO-886 through FOO-890 (health readings API, which established the zoneOffset pattern).

## Tasks

### Task 1: Schema + types + migration
**Linear Issue:** [FOO-894](https://linear.app/lw-claude/issue/FOO-894/schema-types-migration-for-food-log-zone-offset)
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)
- `src/lib/food-log.ts` (modify — `FoodLogEntryInput` interface)

**Steps:**
1. No tests needed (declarative schema + compile-time types).
2. Add `zoneOffset: varchar("zone_offset", { length: 6 })` to `foodLogEntries` table in `src/db/schema.ts`. Nullable (existing rows won't have it). Same pattern as `glucoseReadings.zoneOffset`.
3. Add `zoneOffset?: string | null` to `FoodLogEntryInput` in `src/lib/food-log.ts`.
4. Add `zoneOffset?: string` to `FoodLogRequest` in `src/types/index.ts` (optional — client may not send it during transition).
5. Add `zoneOffset: string | null` to `MealEntry` in `src/types/index.ts` (response shape for v1 GET).
6. Run `npx drizzle-kit generate` to create the migration.
7. Run verifier (expect pass — additive changes only).

**Notes:**
- **Migration note:** New nullable column `zone_offset` on `food_log_entries`. No backfill needed — existing rows will have NULL, new rows populated going forward.

### Task 2: Full flow — getLocalDateTime through to DB storage
**Linear Issue:** [FOO-895](https://linear.app/lw-claude/issue/FOO-895/full-flow-getlocaldatetime-api-db-for-zone-offset)
**Files:**
- `src/lib/meal-type.ts` (modify)
- `src/lib/__tests__/meal-type.test.ts` (modify)
- `src/lib/food-log.ts` (modify — `insertFoodLogEntry`, `insertCustomFoodWithLogEntry`)
- `src/lib/__tests__/food-log.test.ts` (modify — if exists, or check relevant test file)
- `src/app/api/log-food/route.ts` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/food-chat.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/app/app/log-shared/[token]/log-shared-content.tsx` (modify)
- `src/components/pending-submission-handler.tsx` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/meal-type.test.ts`:
   - `getLocalDateTime` returns `zoneOffset` in `±HH:MM` format
   - Test positive offset (e.g., UTC+5:30 → "+05:30")
   - Test negative offset (e.g., UTC-3 → "-03:00")
   - Test UTC (offset 0 → "+00:00")
2. Run verifier with pattern `meal-type` (expect fail).
3. Update `getLocalDateTime()` in `src/lib/meal-type.ts` to compute and return `zoneOffset`. Use `new Date().getTimezoneOffset()` (returns minutes, negative for east-of-UTC) and format as `±HH:MM` string. Return type becomes `{ date: string; time: string; zoneOffset: string }`.
4. Run verifier with pattern `meal-type` (expect pass).
5. Write tests for `insertFoodLogEntry` storing `zoneOffset`:
   - When `zoneOffset` is provided, it appears in the `.values()` call
   - When `zoneOffset` is undefined/null, it stores null
   - Follow existing mock patterns in food-log tests
6. Run verifier with pattern `food-log` (expect fail).
7. Update `insertFoodLogEntry` in `src/lib/food-log.ts` to include `zoneOffset: data.zoneOffset ?? null` in the `.values()` object.
8. Update `insertCustomFoodWithLogEntry` in `src/lib/food-log.ts` — the `logEntryData` parameter type is `Omit<FoodLogEntryInput, "customFoodId">`, so it already includes `zoneOffset` from Task 1. Just ensure the `.values()` call passes it through.
9. Run verifier with pattern `food-log` (expect pass).
10. Update `/api/log-food/route.ts`:
    - Add `zoneOffset` validation after existing `time` validation: if present, must match `/^[+-]\d{2}:\d{2}$/` (same regex as health readings routes). If invalid format, return 400.
    - Pass `zoneOffset` through to `insertFoodLogEntry` and `insertCustomFoodWithLogEntry` calls (extract from `body.zoneOffset`).
11. Update client components to pass `zoneOffset` from `getLocalDateTime()`:
    - `food-analyzer.tsx`: include `zoneOffset` in the `logBody` object alongside `date` and `time`
    - `food-chat.tsx`: same pattern — include `zoneOffset` in log body
    - `quick-select.tsx`: already uses `...getLocalDateTime()` spread in two places — `zoneOffset` included automatically. Verify the third usage (line 63, `useState(getLocalDateTime)`) — this captures for search ranking, not logging, so no change needed there.
    - `log-shared-content.tsx`: add `zoneOffset` to destructuring and include in POST body
    - `pending-submission-handler.tsx`: `getLocalDateTime()` is used as fallback — `zoneOffset` will be in the returned object. Verify the fallback object structure includes it when spreading into body.
12. Run verifier (expect pass — full suite).

**Notes:**
- `getTimezoneOffset()` returns minutes with inverted sign: UTC+3 returns -180. Formula: `sign = offset <= 0 ? "+" : "-"`, `absMinutes = Math.abs(offset)`, `hours = Math.floor(absMinutes / 60)`, `minutes = absMinutes % 60`.
- `isValidFoodLogRequest` in the route file validates the POST body shape. `zoneOffset` is optional, so no change needed there — it's passthrough validation (format check only if present).

### Task 3: v1 food-log GET exposes zoneOffset + documentation
**Linear Issue:** [FOO-896](https://linear.app/lw-claude/issue/FOO-896/expose-zone-offset-in-v1-food-log-get-response)
**Files:**
- `src/lib/food-log.ts` (modify — `getDailyNutritionSummary` mapping)
- `src/app/api/v1/food-log/__tests__/route.test.ts` (modify)
- `CLAUDE.md` (modify)

**Steps:**
1. Write test in `src/app/api/v1/food-log/__tests__/route.test.ts`:
   - v1 food-log GET response entries include `zoneOffset` field (string or null)
   - Follow existing test patterns in the file
2. Run verifier with pattern `v1/food-log` (expect fail).
3. Update `getDailyNutritionSummary` in `src/lib/food-log.ts` at the `entries.push()` block (~line 1049): add `zoneOffset: row.food_log_entries.zoneOffset ?? null` to the mapped object.
4. Run verifier with pattern `v1/food-log` (expect pass).
5. Run verifier (full suite — no args).

**Notes:**
- The `.select()` call at line 993 already fetches all columns, so `zoneOffset` is available in `row.food_log_entries` once the schema column exists. Only the manual mapping needs updating.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add `zone_offset` to food log entries so external processes can correctly interpret the timezone of bare `date` and `time` fields.
**Linear Issues:** FOO-894, FOO-895, FOO-896
**Approach:** Add nullable `zone_offset` varchar(6) column to `foodLogEntries` (same pattern as health readings). Extend `getLocalDateTime()` to compute the browser's UTC offset as `±HH:MM`. Thread it through all 5 client components → API route validation → lib insert functions → v1 GET response.
**Scope:** 3 tasks, ~12 files modified, ~6 new test cases
**Key Decisions:** Nullable column (no backfill of existing rows); optional in POST body (backward compatible); same `±HH:MM` format and validation regex as health readings
**Risks:** Low — proven pattern from health readings, no breaking changes. Only risk is missing a client component call site (6 identified, all traced).
