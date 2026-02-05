# Fix Plan: logFood logs 1 gram instead of full serving size

**Issue:** FOO-59
**Date:** 2026-02-05
**Status:** Planning
**Branch:** fix/FOO-59-log-food-amount

## Investigation

### Bug Report
Food uploaded to Fitbit shows 0 calories and no nutrient information. The Fitbit app displays "Serving size: 1 gr... 0 cal" with all nutrition facts showing "-" (null/zero).

### Classification
- **Type:** Integration / Data Issue
- **Severity:** Critical (core functionality broken - all logged food has no nutritional value)
- **Affected Area:** `src/lib/fitbit.ts` - `logFood` function

### Root Cause Analysis

The `logFood` function logs 1 gram instead of the full serving size, causing all nutritional values to be scaled down to effectively zero.

#### Evidence

**File:** `src/lib/fitbit.ts:129-135`
```typescript
const params = new URLSearchParams({
  foodId: foodId.toString(),
  mealTypeId: mealTypeId.toString(),
  unitId: "147", // gram
  amount: "1", // 1 serving  <-- WRONG: comment says "serving" but value is 1 gram
});
```

**File:** `src/lib/fitbit.ts:75-85` (createFood - correctly stores nutrients per full serving)
```typescript
const params = new URLSearchParams({
  name: food.food_name,
  defaultFoodMeasurementUnitId: "147", // gram
  defaultServingSize: food.portion_size_g.toString(),  // e.g., 250g
  calories: food.calories.toString(),  // calories for 250g
  protein: food.protein_g.toString(),  // protein for 250g
  // ... other nutrients for 250g
});
```

**Railway Logs (2026-02-05T14:12):**
```
[INFO] created new food action="fitbit_food_created" foodId=828510280
[INFO] food logged successfully action="log_food_success" foodId=828510280 logId=38034767823
```

The API calls succeed, but Fitbit scales nutritional values proportionally:
- Food created with 250g serving = 40 calories
- Food logged with 1g amount = 40 * (1/250) = 0.16 calories → rounds to **0**

**Fitbit API Documentation:** Per https://dev.fitbit.com/build/reference/web-api/nutrition/create-food-log/, the `amount` parameter represents "the amount consumed in the format X.XX in the specified unitId". Since `unitId: "147"` is gram, `amount: "1"` means 1 gram.

### Impact
- All food logged to Fitbit has 0 calories and no nutritional values
- Users see "0 cal" for everything they log
- Core app functionality is completely broken
- Food is created correctly but logged incorrectly

## Fix Plan (TDD Approach)

### Step 1: Write Failing Test

**File:** `src/lib/__tests__/fitbit.test.ts`

Add a test that verifies `logFood` is called with the correct `amount` parameter matching the portion size:

```typescript
it("should log food with correct amount matching portion size", async () => {
  // Setup mock for createFood and logFood
  const mockFood: FoodAnalysis = {
    food_name: "Test Food",
    portion_size_g: 250,
    calories: 100,
    protein_g: 5,
    carbs_g: 20,
    fat_g: 3,
    fiber_g: 2,
    sodium_mg: 100,
    confidence: "high",
    notes: "",
  };

  // ... mock responses

  // Verify logFood is called with amount: "250" (the portion size)
  expect(fetch).toHaveBeenCalledWith(
    "https://api.fitbit.com/1/user/-/foods/log.json",
    expect.objectContaining({
      body: expect.stringContaining("amount=250"),
    })
  );
});
```

### Step 2: Update logFood Function Signature

**File:** `src/lib/fitbit.ts`

Add `amount` parameter to `logFood`:

```typescript
// Change from:
export async function logFood(
  accessToken: string,
  foodId: number,
  mealTypeId: number,
  date: string,
  time?: string,
): Promise<LogFoodResponse>

// To:
export async function logFood(
  accessToken: string,
  foodId: number,
  mealTypeId: number,
  amount: number,  // NEW: portion size in grams
  date: string,
  time?: string,
): Promise<LogFoodResponse>
```

### Step 3: Update logFood Implementation

**File:** `src/lib/fitbit.ts:129-135`

```typescript
// Change from:
const params = new URLSearchParams({
  foodId: foodId.toString(),
  mealTypeId: mealTypeId.toString(),
  unitId: "147", // gram
  amount: "1", // 1 serving  <-- WRONG
  date,
});

// To:
const params = new URLSearchParams({
  foodId: foodId.toString(),
  mealTypeId: mealTypeId.toString(),
  unitId: "147", // gram
  amount: amount.toString(), // portion size in grams
  date,
});
```

### Step 4: Update Caller in log-food Route

**File:** `src/app/api/log-food/route.ts:156-162`

```typescript
// Change from:
const logResult = await logFood(
  accessToken,
  foodId,
  body.mealTypeId,
  date,
  body.time
);

// To:
const logResult = await logFood(
  accessToken,
  foodId,
  body.mealTypeId,
  body.portion_size_g,  // NEW: pass the portion size
  date,
  body.time
);
```

### Step 5: Update Existing Tests

**File:** `src/lib/__tests__/fitbit.test.ts`

Update existing `logFood` tests to:
1. Pass the new `amount` parameter
2. Verify the correct amount is sent to Fitbit API

**File:** `src/app/api/log-food/__tests__/route.test.ts`

Update route tests to verify `logFood` is called with `portion_size_g`.

### Step 6: Verify

- [ ] New test for correct amount passes
- [ ] All existing tests updated and pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Manual verification: log a food item and verify calories/nutrients appear correctly in Fitbit

## Files Affected

| File | Change |
|------|--------|
| `src/lib/fitbit.ts` | Add `amount` param to `logFood`, use it instead of hardcoded "1" |
| `src/app/api/log-food/route.ts` | Pass `body.portion_size_g` to `logFood` |
| `src/lib/__tests__/fitbit.test.ts` | Update tests for new `logFood` signature |
| `src/app/api/log-food/__tests__/route.test.ts` | Update mock to verify correct amount |

## Notes
- The `createFood` function is correct - it stores nutrients per the full serving size
- Only `logFood` needs to be fixed to log the correct amount
- The fix is backward compatible - no API changes to clients
- The comment `// 1 serving` was misleading - it's actually 1 gram

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Step 1-6: Full TDD fix for logFood amount parameter
  - Added failing test verifying `amount=250` is sent to Fitbit API
  - Added `amount: number` parameter to `logFood` function signature
  - Updated `logFood` implementation to use `amount.toString()` instead of hardcoded `"1"`
  - Updated `log-food/route.ts` to pass `body.portion_size_g` to `logFood`
  - Updated all existing tests to include the new `amount` parameter

### Files Modified
- `src/lib/fitbit.ts` - Added `amount` parameter to `logFood`, use it instead of hardcoded "1"
- `src/app/api/log-food/route.ts` - Pass `body.portion_size_g` to `logFood`
- `src/lib/__tests__/fitbit.test.ts` - Updated tests for new `logFood` signature
- `src/app/api/log-food/__tests__/route.test.ts` - Updated mock expectations to verify correct amount

### Linear Updates
- FOO-59: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 medium (defensive validation for amount), 1 low (float precision) - both acceptable since route validation already checks `portion_size_g > 0`
- verifier: All 266 tests pass, zero errors, build passes

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 4
- `src/lib/fitbit.ts` - `logFood` function with new `amount` parameter
- `src/app/api/log-food/route.ts` - Route handler passing `portion_size_g`
- `src/lib/__tests__/fitbit.test.ts` - Unit tests for `logFood`
- `src/app/api/log-food/__tests__/route.test.ts` - Route integration tests

Checks applied: Security, Logic, Async, Resources, Type Safety, Edge Cases, Error Handling, Conventions

No issues found - all implementations are correct and follow project conventions.

**Details:**
- Security: Parameters properly encoded via URLSearchParams, auth validated before API calls
- Logic: Fix correctly addresses root cause (hardcoded "1" → actual portion size)
- Edge Cases: Route validates `portion_size_g > 0` at line 25, preventing zero/negative values
- Type Safety: `amount: number` parameter type is explicit
- Tests: New test verifies `amount=250` sent to Fitbit API; route tests verify `portion_size_g` passed correctly

### Linear Updates
- FOO-59: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. FOO-59 moved to Merge.
