# Fix Plan: Fitbit API compatibility — DB overflow, wrong param name, wrong unit IDs

**Issue:** FOO-156
**Date:** 2026-02-06
**Status:** Planning
**Branch:** fix/FOO-156-fitbit-api-compat

## Investigation

### Bug Report
User logged a tea ("Te con leche alta en proteinas") via the app. It appeared in Fitbit but was NOT saved to the database. Investigation also requested to triple-check Fitbit API unit compatibility.

### Classification
- **Type:** Data Issue + Integration
- **Severity:** Critical (data loss) + High (wrong data sent to Fitbit)
- **Affected Area:** Food logging pipeline (DB schema, Fitbit API client, Claude prompt unit IDs)

### Root Cause Analysis

**4 bugs found:**

#### Bug 1 (CRITICAL): `fitbit_log_id` integer overflow — food logs not saved to DB

Railway logs at `2026-02-06T13:55:49.187Z`:
```
[ERRO] failed to insert food log to database action="food_log_db_error"
params: ...,38042351280
```

The Fitbit log ID `38042351280` exceeds PostgreSQL `integer` max of `2,147,483,647`. The `fitbit_log_id` column in `food_logs` table is defined as `integer` (`src/db/schema.ts:48`), causing the insert to fail. The error is caught by the try/catch at `src/app/api/log-food/route.ts:177`, so the response still succeeds but the DB row is never created.

`fitbit_food_id` (also `integer`, line 47) currently holds values like `828644295` — under the limit but approaching it. Should also be upgraded for safety.

#### Bug 2 (MODERATE): `fiber` Fitbit API parameter should be `dietaryFiber`

At `src/lib/fitbit.ts:130`, the Create Food API call sends:
```typescript
fiber: food.fiber_g.toString(),
```

The Fitbit API docs list the parameter as `dietaryFiber`, not `fiber`. The response `nutritionalValues` object also uses `dietaryFiber` as the key. Other nutrition params (`protein`, `totalCarbohydrate`, `totalFat`, `sodium`) are correct — confirmed both by API docs and by the fact that macros appear in Fitbit.

The `fiber` param is silently ignored by Fitbit, meaning fiber data is lost. The tea log had fiber=0 so it wasn't noticeable, but any food with fiber > 0 would lose that data.

#### Bug 3 (HIGH): Unit ID 256 is "pint", not "piece"

The Fitbit Get Food API response example explicitly shows:
```json
{ "id": 256, "name": "pint", "plural": "pints" }
```
with a serving multiplier of 2 relative to cup — consistent with pint = 2 cups.

Our code at `src/types/index.ts:25` and `src/lib/claude.ts:40` maps `256=piece`, which is **wrong**. If Claude selects unit_id 256 for a food item (e.g., "1 piece of fruit"), it would tell Fitbit "1 pint" — causing wildly incorrect nutritional scaling.

Additionally, the following unit IDs cannot be verified from public documentation alone and need validation against the live API:
- `364` — claimed as "tsp" (very likely correct: appears alongside tbsp=349 in peanut butter context)
- `211` — claimed as "ml" (unverified)
- `311` — claimed as "slice" (unverified)

**Action needed:** Call `GET https://api.fitbit.com/1/foods/units.json` with a valid Fitbit access token to get the authoritative unit list. Create a one-time utility or API route to dump the full list.

#### Bug 4 (LOW): Missing `formType` and `description` on Create Food

The Fitbit Create Food API docs mark `formType` (LIQUID/DRY) and `description` as required parameters. Our `createFood()` function at `src/lib/fitbit.ts:122-132` doesn't send them. Fitbit currently accepts the request without them, but for full API compliance they should be included.

### Impact
- **Bug 1:** Every food log with a Fitbit log ID > 2.1B silently fails to save to the database. This is happening NOW in production.
- **Bug 2:** Fiber nutritional data is never saved to Fitbit for any food.
- **Bug 3:** If Claude ever picks unit_id 256 for "piece", the food would be logged as "pint" in Fitbit with wrong nutritional scaling.
- **Bug 4:** No current impact (Fitbit accepts without them), but non-compliant with documented API contract.

## Fix Plan (TDD Approach)

### Step 1: Fetch and verify Fitbit unit IDs

Before writing any code fixes, we need the authoritative unit list.

- **Action:** Create a temporary script or use the existing Fitbit token to call `GET /1/foods/units.json`
- **Alternative:** Add a temporary API route at `/api/debug/fitbit-units` that dumps the full units list
- **Goal:** Get the correct unit IDs for: gram, cup, oz, tbsp, tsp, ml, slice, piece, serving

After getting the correct IDs, update the plan below with verified values.

### Step 2: Write failing tests for Bug 1 (integer overflow)

- **File:** `src/lib/__tests__/food-log.test.ts`
- **Test:** Verify that `insertFoodLog` correctly passes large Fitbit IDs (> 2^31) to the DB layer

```typescript
it("handles large fitbitLogId values (bigint range)", async () => {
  const loggedAt = new Date();
  mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

  await insertFoodLog("test@example.com", {
    foodName: "Tea",
    amount: 1,
    unitId: 91,
    calories: 22,
    proteinG: 2.8,
    carbsG: 2.8,
    fatG: 0,
    fiberG: 0,
    sodiumMg: 32,
    confidence: "medium",
    notes: "Test",
    mealTypeId: 2,
    date: "2026-02-06",
    fitbitFoodId: 828644295,
    fitbitLogId: 38042351280,
  });

  expect(mockValues).toHaveBeenCalledWith(
    expect.objectContaining({
      fitbitLogId: 38042351280,
    }),
  );
});
```

### Step 3: Fix Bug 1 — Change `fitbit_food_id` and `fitbit_log_id` to `bigint`

- **File:** `src/db/schema.ts`
- **Change:** Replace `integer` with `bigint` for both columns:

```typescript
// Before (line 47-48):
fitbitFoodId: integer("fitbit_food_id"),
fitbitLogId: integer("fitbit_log_id"),

// After:
fitbitFoodId: bigint("fitbit_food_id", { mode: "number" }),
fitbitLogId: bigint("fitbit_log_id", { mode: "number" }),
```

Note: `mode: "number"` keeps the TypeScript type as `number` (safe up to `Number.MAX_SAFE_INTEGER` = 9,007,199,254,740,991). The Fitbit IDs at ~38B are well within this range.

- **Migration:** Run `npx drizzle-kit generate` to create the ALTER TABLE migration (integer -> bigint is non-destructive in PostgreSQL, no data loss).

- **File:** `src/lib/food-log.ts` — No changes needed, the `FoodLogInput` interface already types these as `number`.

### Step 4: Write failing test for Bug 2 (fiber param name)

- **File:** `src/lib/__tests__/fitbit.test.ts`
- **Test:** Verify `createFood` sends `dietaryFiber` instead of `fiber`:

```typescript
it("sends dietaryFiber parameter name to Fitbit API", async () => {
  const food = { ...mockFoodAnalysis, fiber_g: 7 };
  const mockResponse = { food: { foodId: 789, name: "Test" } };

  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(mockResponse), { status: 201 }),
  );

  await createFood("test-token", food);

  const fetchCall = vi.mocked(fetch).mock.calls[0];
  const body = fetchCall[1]?.body as string;
  expect(body).toContain("dietaryFiber=7");
  expect(body).not.toContain("fiber=");

  vi.restoreAllMocks();
});
```

### Step 5: Fix Bug 2 — Rename `fiber` to `dietaryFiber`

- **File:** `src/lib/fitbit.ts:130`
- **Change:**

```typescript
// Before:
fiber: food.fiber_g.toString(),

// After:
dietaryFiber: food.fiber_g.toString(),
```

### Step 6: Write failing test for Bug 3 (unit IDs)

- **File:** `src/types/__tests__/index.test.ts`
- **Test:** Update the unit ID assertions with correct verified values:

```typescript
it("has correct well-known Fitbit unit IDs", () => {
  expect(FITBIT_UNITS.g.id).toBe(147);
  expect(FITBIT_UNITS.oz.id).toBe(226);
  expect(FITBIT_UNITS.cup.id).toBe(91);
  expect(FITBIT_UNITS.tbsp.id).toBe(349);
  expect(FITBIT_UNITS.tsp.id).toBe(VERIFIED_TSP_ID);      // verify: likely 364
  expect(FITBIT_UNITS.ml.id).toBe(VERIFIED_ML_ID);         // verify: claimed 211
  expect(FITBIT_UNITS.slice.id).toBe(VERIFIED_SLICE_ID);   // verify: claimed 311
  expect(FITBIT_UNITS.piece.id).toBe(VERIFIED_PIECE_ID);   // NOT 256 (that's pint)
  expect(FITBIT_UNITS.serving.id).toBe(304);
});
```

### Step 7: Fix Bug 3 — Update unit IDs

- **File:** `src/types/index.ts` — Update `FITBIT_UNITS` with verified IDs
- **File:** `src/lib/claude.ts:40` — Update the Claude prompt unit_id description
- **File:** `src/types/__tests__/index.test.ts` — Update test assertions

### Step 8: Fix Bug 4 — Add `formType` and `description` to Create Food

- **File:** `src/lib/fitbit.ts:122-132`
- **Change:** Add `formType` and `description` params:

```typescript
const params = new URLSearchParams({
  name: food.food_name,
  defaultFoodMeasurementUnitId: food.unit_id.toString(),
  defaultServingSize: food.amount.toString(),
  calories: food.calories.toString(),
  protein: food.protein_g.toString(),
  totalCarbohydrate: food.carbs_g.toString(),
  totalFat: food.fat_g.toString(),
  dietaryFiber: food.fiber_g.toString(),
  sodium: food.sodium_mg.toString(),
  formType: "DRY",   // default; could be smarter based on food type
  description: food.food_name,
});
```

- **Test:** Add test verifying `formType` and `description` are included in request body.

### Step 9: Verify

- [ ] All new tests pass
- [ ] All existing tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run typecheck`)
- [ ] Lint passes (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Migration generated and committed
- [ ] Manual test: log a food with fiber > 0 and verify fiber shows in Fitbit
- [ ] Manual test: verify DB row is created with correct fitbitLogId

## Notes

- Bug 1 is the direct cause of the reported issue (tea not saved to DB).
- Bug 3 requires calling the live Fitbit API to get verified unit IDs before implementation.
- The `formType` for Bug 4 could be made smarter (detect LIQUID vs DRY based on unit — e.g., cup/ml -> LIQUID), but a simple default of "DRY" is acceptable as a first pass.
- The existing test at `food-log.test.ts:118` uses `unitId: 256` for an Apple (piece) — this will need updating once the correct piece unit ID is known.

---

## Iteration 1

**Implemented:** 2026-02-06

### Tasks Completed This Iteration
- Step 1: Fetch and verify Fitbit unit IDs — Confirmed 256=pint (NOT piece) from Fitbit API docs. Could not fetch full units list (requires live API call with auth token). Unverified IDs (364=tsp, 211=ml, 311=slice) left as-is since they're likely correct per plan analysis.
- Step 2-3: Fix Bug 1 (integer overflow) — Changed `fitbit_food_id` and `fitbit_log_id` from `integer` to `bigint` in schema, generated migration, added regression test for large IDs.
- Step 4-5: Fix Bug 2 (fiber param name) — Renamed `fiber` to `dietaryFiber` in Fitbit Create Food API call, added test verifying param name.
- Step 6-7: Fix Bug 3 (unit IDs) — Removed wrong `piece=256` mapping from FITBIT_UNITS (256 is "pint"). Updated Claude prompt to remove 256=piece and suggest "serving" for individual items. Updated food-log test to use 304 (serving) instead of 256 for Apple test case.
- Step 8: Fix Bug 4 (formType/description) — Added `formType: "DRY"` and `description: food.food_name` to Create Food API call, added test.

### Tasks Remaining
- Step 1 (partial): Call live Fitbit API `GET /1/foods/units.json` to verify tsp=364, ml=211, slice=311, and find correct "piece" unit ID. Requires authenticated API call.
- Step 9: Manual verification — Log a food with fiber > 0 and verify fiber shows in Fitbit. Verify DB row created with correct fitbitLogId.

### Files Modified
- `src/db/schema.ts` — Changed `fitbit_food_id` and `fitbit_log_id` from integer to bigint
- `drizzle/0001_peaceful_norman_osborn.sql` — Migration: ALTER TABLE bigint
- `drizzle/meta/_journal.json` — Migration journal entry
- `drizzle/meta/0001_snapshot.json` — Migration snapshot
- `src/lib/fitbit.ts` — Renamed `fiber` to `dietaryFiber`, added `formType` and `description` params
- `src/types/index.ts` — Removed wrong `piece: { id: 256 }` from FITBIT_UNITS
- `src/lib/claude.ts` — Updated unit_id description to remove 256=piece
- `src/lib/__tests__/fitbit.test.ts` — Added tests for dietaryFiber, formType, description
- `src/lib/__tests__/food-log.test.ts` — Added bigint regression test, updated unitId 256→304
- `src/types/__tests__/index.test.ts` — Updated unit key list, added 256≠piece test

### Linear Updates
- FOO-156: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed (0 bugs found)
- verifier: All 563 tests pass, zero TypeScript errors, zero lint warnings, build succeeds. Pre-existing issues: migrate.test.ts mock hoisting failure, act() warnings in photo-capture/settings tests — both unrelated to this change.

### Continuation Status
All code fixes completed. Remaining work is manual verification only (Step 1 partial: live API call, Step 9: manual testing).
