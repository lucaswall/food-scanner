# Implementation Plan

**Created:** 2026-02-04
**Source:** Roadmap Iteration 3: Fitbit Logging & Review UI
**Linear Issues:** [FOO-33](https://linear.app/lw-claude/issue/FOO-33), [FOO-34](https://linear.app/lw-claude/issue/FOO-34), [FOO-35](https://linear.app/lw-claude/issue/FOO-35), [FOO-36](https://linear.app/lw-claude/issue/FOO-36), [FOO-37](https://linear.app/lw-claude/issue/FOO-37), [FOO-38](https://linear.app/lw-claude/issue/FOO-38), [FOO-39](https://linear.app/lw-claude/issue/FOO-39), [FOO-40](https://linear.app/lw-claude/issue/FOO-40)

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/lib/fitbit.ts` — OAuth functions exist; missing API client for food search/create/log
  - `src/app/api/analyze-food/route.ts` — Template for new API routes (session validation, error handling)
  - `src/components/food-analyzer.tsx` — Parent component that needs to integrate meal type + logging
  - `src/components/analysis-result.tsx` — Currently read-only display; needs edit mode + log button
  - `src/types/index.ts` — `FoodAnalysis`, `FoodLogRequest`, `FoodLogResponse`, `FitbitMealType` already defined
  - `src/lib/api-response.ts` — `successResponse()`, `errorResponse()` helpers
- **Existing patterns:**
  - API routes: validate session → validate fitbit → validate input → process → return standardized response
  - Tests: mock iron-session, mock next/headers, mock external APIs, test error codes
  - Components: `'use client'`, shadcn/ui Button, controlled inputs
- **Test conventions:**
  - Colocated in `__tests__/` subdirectories
  - Mock external dependencies with `vi.mock()`
  - Use `createMockFile()` helpers for File objects
  - Test validation errors, success paths, error handling

### MCP Context
- **MCPs used:** Linear (for issue creation)
- **Findings:** Team "Food Scanner" (ID: `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`)

## Original Plan

### Task 1: Add Fitbit food API client functions
**Linear Issue:** [FOO-33](https://linear.app/lw-claude/issue/FOO-33)

1. Write tests in `src/lib/__tests__/fitbit.test.ts` for new functions:
   - `searchFoods(accessToken, query)` — searches user's custom foods
   - `createFood(accessToken, food: FoodAnalysis)` — creates custom food with nutrition data
   - `logFood(accessToken, foodId, mealTypeId, date, time?)` — logs food entry
   - `findOrCreateFood(accessToken, food)` — deduplication logic (search → match → reuse or create)
   - Test rate limiting retry logic (429 → exponential backoff)
   - Test token refresh trigger (401 → throw FITBIT_TOKEN_INVALID)
2. Run verifier (expect fail)
3. Implement functions in `src/lib/fitbit.ts`:
   - `searchFoods`: GET `/1/user/-/foods.json?query={name}`
   - `createFood`: POST `/1/user/-/foods.json` (x-www-form-urlencoded)
   - `logFood`: POST `/1/user/-/foods/log.json` (x-www-form-urlencoded)
   - `findOrCreateFood`: Search → match by name+calories (10% tolerance) → reuse or create
   - Add retry with exponential backoff for 429 errors (max 3 retries)
   - Add 10-second timeout per request
4. Run verifier (expect pass)

### Task 2: Create POST /api/log-food route
**Linear Issue:** [FOO-34](https://linear.app/lw-claude/issue/FOO-34)

1. Write tests in `src/app/api/log-food/__tests__/route.test.ts`:
   - Test 401 for missing session
   - Test 400 FITBIT_NOT_CONNECTED if no Fitbit tokens
   - Test 400 VALIDATION_ERROR for invalid mealTypeId (not 1,2,3,4,5,7)
   - Test 400 VALIDATION_ERROR for missing required FoodAnalysis fields
   - Test 200 with FoodLogResponse on success
   - Test 500 FITBIT_API_ERROR on Fitbit failure
   - Test 401 FITBIT_TOKEN_INVALID triggers reconnect prompt
   - Test session.fitbit tokens updated after refresh
   - Test reusedFood=true when existing food matched
   - Test reusedFood=false when new food created
2. Run verifier (expect fail)
3. Implement `src/app/api/log-food/route.ts`:
   - Validate session and Fitbit connection
   - Parse JSON body as FoodLogRequest
   - Validate mealTypeId is valid FitbitMealType
   - Call `ensureFreshToken()` and save session if refreshed
   - Call `findOrCreateFood()` for deduplication
   - Call `logFood()` with foodId
   - Return `FoodLogResponse` with fitbitFoodId, fitbitLogId, reusedFood
   - Handle errors with appropriate error codes
4. Run verifier (expect pass)

### Task 3: Add shadcn/ui Select component
**Linear Issue:** [FOO-35](https://linear.app/lw-claude/issue/FOO-35)

1. No tests needed (shadcn/ui component installation)
2. Install select component: `npx shadcn@latest add select`
3. Verify component exists at `src/components/ui/select.tsx`
4. Run verifier (expect pass)

### Task 4: Add shadcn/ui Input and Label components
**Linear Issue:** [FOO-36](https://linear.app/lw-claude/issue/FOO-36)

1. No tests needed (shadcn/ui component installation)
2. Install components: `npx shadcn@latest add input label`
3. Verify components exist at `src/components/ui/input.tsx` and `src/components/ui/label.tsx`
4. Run verifier (expect pass)

### Task 5: Create MealTypeSelector component
**Linear Issue:** [FOO-37](https://linear.app/lw-claude/issue/FOO-37)

1. Write tests in `src/components/__tests__/meal-type-selector.test.tsx`:
   - Test renders all meal type options (Breakfast, Morning Snack, Lunch, etc.)
   - Test default value selects option
   - Test onChange called with mealTypeId when selection changes
   - Test disabled state
   - Test each meal type maps to correct ID (1,2,3,4,5,7)
2. Run verifier (expect fail)
3. Implement `src/components/meal-type-selector.tsx`:
   - Use shadcn/ui Select component
   - Map FitbitMealType enum to dropdown options
   - Props: `value: number`, `onChange: (id: number) => void`, `disabled?: boolean`
   - Display user-friendly labels: "Breakfast", "Morning Snack", "Lunch", "Afternoon Snack", "Dinner", "Anytime"
4. Run verifier (expect pass)

### Task 6: Create NutritionEditor component for editable fields
**Linear Issue:** [FOO-38](https://linear.app/lw-claude/issue/FOO-38)

1. Write tests in `src/components/__tests__/nutrition-editor.test.tsx`:
   - Test renders all FoodAnalysis fields as editable inputs
   - Test onChange called with updated FoodAnalysis when any field changes
   - Test number inputs accept only valid numbers
   - Test confidence is read-only (not editable)
   - Test disabled state disables all inputs
   - Test validation: negative numbers rejected, portion_size_g required
2. Run verifier (expect fail)
3. Implement `src/components/nutrition-editor.tsx`:
   - Props: `value: FoodAnalysis`, `onChange: (analysis: FoodAnalysis) => void`, `disabled?: boolean`
   - Editable fields: food_name (text), portion_size_g, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg (all numbers)
   - Read-only display: confidence indicator, notes
   - Use shadcn/ui Input and Label components
   - Grid layout matching AnalysisResult style
   - Inline validation for number fields
4. Run verifier (expect pass)

### Task 7: Create FoodLogConfirmation component
**Linear Issue:** [FOO-39](https://linear.app/lw-claude/issue/FOO-39)

1. Write tests in `src/components/__tests__/food-log-confirmation.test.tsx`:
   - Test displays success message with food name
   - Test shows "Reused existing food" when reusedFood=true
   - Test shows "Created new food" when reusedFood=false
   - Test displays fitbitLogId
   - Test "Log Another" button calls onReset
   - Test hidden when response is null
2. Run verifier (expect fail)
3. Implement `src/components/food-log-confirmation.tsx`:
   - Props: `response: FoodLogResponse | null`, `foodName: string`, `onReset: () => void`
   - Success state with checkmark icon
   - Display reuse status message
   - "Log Another" button to start fresh
4. Run verifier (expect pass)

### Task 8: Refactor FoodAnalyzer to support full logging flow
**Linear Issue:** [FOO-40](https://linear.app/lw-claude/issue/FOO-40)

1. Update tests in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test shows MealTypeSelector after analysis
   - Test shows editable NutritionEditor after analysis
   - Test "Edit Manually" toggle switches between read-only and edit mode
   - Test "Regenerate Analysis" button re-calls analyze API
   - Test "Log to Fitbit" button calls /api/log-food with current values
   - Test "Log to Fitbit" disabled while logging in progress
   - Test FoodLogConfirmation shown after successful log
   - Test error state shows Fitbit reconnect prompt for FITBIT_TOKEN_INVALID
   - Test reset after successful log clears all state
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add state: `mealTypeId`, `editedAnalysis`, `editMode`, `logging`, `logResponse`
   - After analysis: show MealTypeSelector (default based on current time)
   - Add "Edit Manually" toggle to switch between AnalysisResult and NutritionEditor
   - Add "Regenerate Analysis" button (re-runs analyze with same photos/description)
   - Add "Log to Fitbit" button that POSTs to /api/log-food
   - Show FoodLogConfirmation on success
   - Handle FITBIT_TOKEN_INVALID with reconnect prompt
   - Reset all state after successful log or on "Log Another"
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Complete Iteration 3 - Fitbit food logging and review/edit UI

**Request:** Implement Roadmap Iteration 3 which covers Fitbit API client for food logging (search, create, log with deduplication), the POST /api/log-food route, and the Review & Edit UI (meal type selector, editable nutrition fields, log to Fitbit button, success confirmation).

**Linear Issues:** FOO-33, FOO-34, FOO-35, FOO-36, FOO-37, FOO-38, FOO-39, FOO-40

**Approach:** Build bottom-up starting with Fitbit API client functions, then the log-food route, then UI components (MealTypeSelector, NutritionEditor, FoodLogConfirmation), and finally integrate everything into FoodAnalyzer. Each task follows TDD with tests first. Install shadcn/ui Select, Input, Label components as dependencies.

**Scope:**
- Tasks: 8
- Files affected: ~15 (6 new, 9 modified)
- New tests: yes

**Key Decisions:**
- Food deduplication: Match by name (case-insensitive) + calories within 10% tolerance
- Edit mode: Toggle between read-only AnalysisResult and editable NutritionEditor
- Default meal type: Infer from current time (morning=Breakfast, noon=Lunch, evening=Dinner)
- Fitbit API retry: Exponential backoff for 429, max 3 retries, 10s timeout

**Risks/Considerations:**
- Fitbit API rate limits may require careful retry logic
- Token refresh during log flow needs session save after refresh
- Edit mode UX needs clear visual distinction from read-only mode
- Mobile touch targets must be 44px minimum per project requirements

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Add Fitbit food API client functions - Added searchFoods, createFood, logFood, findOrCreateFood with retry logic and timeout
- Task 2: Create POST /api/log-food route - Full validation, token refresh, food deduplication, error handling
- Task 3: Add shadcn/ui Select component - Installed via npx shadcn@latest add select
- Task 4: Add shadcn/ui Input and Label components - Installed via npx shadcn@latest add input label
- Task 5: Create MealTypeSelector component - Dropdown with all 6 meal types using shadcn/ui Select
- Task 6: Create NutritionEditor component - Editable form for all nutrition fields with validation
- Task 7: Create FoodLogConfirmation component - Success display with reuse status and Log Another button
- Task 8: Refactor FoodAnalyzer for full logging flow - Integrated all components with edit mode, meal selection, and Fitbit logging

### Files Modified
- `src/lib/fitbit.ts` - Added searchFoods, createFood, logFood, findOrCreateFood, fetchWithRetry
- `src/lib/__tests__/fitbit.test.ts` - Added tests for all new Fitbit API functions
- `src/app/api/log-food/route.ts` - Created new route with validation and error handling
- `src/app/api/log-food/__tests__/route.test.ts` - Created comprehensive tests
- `src/components/ui/select.tsx` - Added via shadcn/ui
- `src/components/ui/input.tsx` - Added via shadcn/ui
- `src/components/ui/label.tsx` - Added via shadcn/ui
- `src/components/meal-type-selector.tsx` - Created new component
- `src/components/__tests__/meal-type-selector.test.tsx` - Created tests
- `src/components/nutrition-editor.tsx` - Created new component
- `src/components/__tests__/nutrition-editor.test.tsx` - Created tests
- `src/components/food-log-confirmation.tsx` - Created new component
- `src/components/__tests__/food-log-confirmation.test.tsx` - Created tests
- `src/components/food-analyzer.tsx` - Refactored with full logging flow
- `src/components/__tests__/food-analyzer.test.tsx` - Updated with new tests
- `package.json` - Added @testing-library/user-event dependency

### Linear Updates
- FOO-33: Todo → In Progress → Review
- FOO-34: Todo → In Progress → Review
- FOO-35: Todo → In Progress → Review
- FOO-36: Todo → In Progress → Review
- FOO-37: Todo → In Progress → Review
- FOO-38: Todo → In Progress → Review
- FOO-39: Todo → In Progress → Review
- FOO-40: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 high bug (division by zero in calorie matching), 3 medium bugs - all fixed before proceeding
- verifier: All 234 tests pass, zero errors, 1 lint warning (pre-existing img tag)

### Continuation Status
All tasks completed.
