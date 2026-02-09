# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-284-cleanup-and-food-details
**Issues:** FOO-284, FOO-285, FOO-286, FOO-287
**Created:** 2026-02-09
**Last Updated:** 2026-02-09

## Summary

This plan covers four backlog issues: removing redundant retry logic from Claude API calls (FOO-285), cleaning up orphaned custom_foods rows on delete (FOO-284), adding an AI-generated visual description field to food analysis (FOO-286), and adding a full detail page for food history entries (FOO-287).

## Issues

### FOO-285: Remove redundant manual retry logic from Claude API calls

**Priority:** Low
**Labels:** Technical Debt
**Description:** `analyzeFood` and `refineAnalysis` have manual retry loops (maxRetries=1) that stack with the Anthropic SDK's built-in retries (default maxRetries=2), causing up to 6 total attempts per request.

**Acceptance Criteria:**
- [ ] Remove manual retry loops from `analyzeFood` and `refineAnalysis`
- [ ] Remove `isTimeoutError`, `isRateLimitError`, `is5xxError` helper functions
- [ ] Keep `ClaudeApiError` re-throw and final catch wrapping
- [ ] Make SDK `maxRetries` explicit on constructor
- [ ] Update/remove retry-related tests in `claude.test.ts`

### FOO-284: Delete unreferenced custom_foods rows when last food log entry is removed

**Priority:** Low
**Labels:** Technical Debt
**Description:** `deleteFoodLogEntry` only deletes the `food_log_entries` row but never cleans up the associated `custom_foods` row. When the last entry referencing a custom food is deleted, the row becomes orphaned.

**Acceptance Criteria:**
- [ ] After deleting a `food_log_entries` row, if no other entries reference the same `custom_food_id`, the `custom_foods` row is also deleted
- [ ] Reference check and delete run in the same transaction
- [ ] A `custom_foods` row is NEVER deleted while other entries still reference it
- [ ] Tests cover: delete last reference (removed), delete non-last reference (kept)
- [ ] One-time orphan cleanup documented in MIGRATIONS.md

### FOO-286: Add AI-generated visual description field to food analysis

**Priority:** Medium
**Labels:** Feature
**Description:** Add a `description` field to Claude's `report_nutrition` tool so users see what the AI identified on the plate before confirming the log. Follows the exact same pattern as `notes`.

**Acceptance Criteria:**
- [ ] `custom_foods` table has a nullable `description` text column
- [ ] Claude's `report_nutrition` tool includes a `description` field
- [ ] Description is validated in `validateFoodAnalysis()`
- [ ] Description is saved to DB when logging food
- [ ] Description is preserved through the refinement flow
- [ ] Description is displayed on the analysis result screen before submit
- [ ] Existing foods without description continue to work (nullable column)

### FOO-287: Add full detail page for food history entries

**Priority:** Medium
**Labels:** Feature
**Description:** Food history entries currently show only nutrition facts in a dialog. Notes (and description from FOO-286) are invisible after logging. Add a dedicated detail page to surface all data.

**Acceptance Criteria:**
- [ ] History entry dialog has a "View Details" link/button
- [ ] Link opens a dedicated full detail page (`/app/food-detail/[id]`)
- [ ] Detail page displays: food name, description, notes, full nutrition facts, meal type, date/time, portion size, confidence
- [ ] Page has a `loading.tsx` with skeleton placeholders
- [ ] Works for entries that predate the description field
- [ ] Mobile-friendly layout with proper touch targets (44px minimum)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Dependencies up to date (`npm install`)

## Implementation Tasks

### Task 1: Remove retry logic from Claude API calls

**Issue:** FOO-285
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** - Update tests first:
   - In `src/lib/__tests__/claude.test.ts`, **remove** these retry-related tests:
     - `"retries once on timeout error"` (line 245)
     - `"throws after retry exhausted on timeout"` (line 271)
     - `"retries on rate limit (429) error"` (line 351)
     - `"throws after retry exhausted on persistent rate limit"` (line 378)
     - `"isRateLimitError returns false for non-Error objects"` (line 487)
     - `"rate limited request retries with delay"` (line 504)
     - `"retries on 5xx server error"` (line 798)
     - `"throws after retry exhausted on persistent 5xx error"` (line 824)
     - `"retries on 502 Bad Gateway error"` (line 841)
     - `"5xx retry uses exponential backoff delay"` (line 867)
     - `"retries on timeout error"` in refineAnalysis (line 1036)
     - `"retries on rate limit error"` in refineAnalysis (line 1064)
     - `"retries on 5xx server error during refinement"` (line 1213)
     - `"throws after retry exhausted on persistent 5xx during refinement"` (line 1241)
   - Update `"throws CLAUDE_API_ERROR on API failure"` test: expect `mockCreate` called exactly **once** (no retry)
   - Update `"throws CLAUDE_API_ERROR on failure"` in refineAnalysis: expect called once
   - Add new test: `"configures SDK with explicit maxRetries"` — verify `new Anthropic({ maxRetries: 2 })` is called
   - Run: `npm test -- claude`
   - Verify: Retry tests are gone, remaining tests fail (code still has retry loops)

2. **GREEN** - Simplify the production code:
   - In `src/lib/claude.ts`:
     - Update `getClient()` to pass `maxRetries: 2` explicitly: `new Anthropic({ apiKey, timeout: 30000, maxRetries: 2 })`
     - **Delete** `isTimeoutError`, `isRateLimitError`, `is5xxError` functions (lines 170-193)
     - **Rewrite** `analyzeFood` to remove the for-loop, `maxRetries`, `lastError`, and retry conditionals. Keep the single `getClient().messages.create()` call, the `toolUseBlock` extraction, `validateFoodAnalysis`, and the catch block that re-throws `ClaudeApiError` or wraps unknown errors
     - **Rewrite** `refineAnalysis` identically — single API call, no loop, same error handling
   - Run: `npm test -- claude`
   - Verify: All remaining tests pass

3. **REFACTOR** - Review that both functions have consistent error handling structure

**Notes:**
- The SDK's built-in retry handles timeout, 429, and 5xx with exponential backoff + jitter + Retry-After header support
- `maxRetries: 2` means 3 total attempts (1 initial + 2 retries) — same as the SDK default, but now explicit

---

### Task 2: Add orphan cleanup to deleteFoodLogEntry

**Issue:** FOO-284
**Files:**
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - In `src/lib/__tests__/food-log.test.ts`, in the `deleteFoodLogEntry` describe block:
   - Add mock for `db.transaction` — the mock `getDb()` needs to return a `transaction` method that calls its callback with the same mock tx (reusing existing mockInsert/mockDelete/etc.)
   - Add test: `"deletes orphaned custom food when last entry is removed"` — mock delete returning `{ fitbitLogId: 789, customFoodId: 10 }`, mock select count returning `[]` (no remaining refs), expect `mockDelete` called twice (once for entry, once for custom food)
   - Add test: `"keeps custom food when other entries still reference it"` — mock delete returning same, mock select count returning `[{ id: 99 }]` (another entry exists), expect `mockDelete` called once (entry only)
   - Add test: `"returns same shape { fitbitLogId } as before"` — verify return value unchanged
   - Run: `npm test -- food-log`
   - Verify: New tests fail

2. **GREEN** - Implement orphan cleanup:
   - In `src/lib/food-log.ts`, rewrite `deleteFoodLogEntry`:
   ```
   export async function deleteFoodLogEntry(userId, entryId) {
     const db = getDb();
     return db.transaction(async (tx) => {
       const rows = await tx.delete(foodLogEntries)
         .where(and(eq(foodLogEntries.id, entryId), eq(foodLogEntries.userId, userId)))
         .returning({ fitbitLogId: foodLogEntries.fitbitLogId, customFoodId: foodLogEntries.customFoodId });
       const row = rows[0];
       if (!row) return null;
       // Check if custom food is still referenced
       const refs = await tx.select({ id: foodLogEntries.id })
         .from(foodLogEntries)
         .where(eq(foodLogEntries.customFoodId, row.customFoodId))
         .limit(1);
       if (refs.length === 0) {
         await tx.delete(customFoods)
           .where(and(eq(customFoods.id, row.customFoodId), eq(customFoods.userId, userId)));
       }
       return { fitbitLogId: row.fitbitLogId };
     });
   }
   ```
   - Import `customFoods` from `@/db/schema` (already imported)
   - Run: `npm test -- food-log`
   - Verify: All tests pass

3. **REFACTOR** - Ensure the transaction mock is clean and all existing delete tests still pass

**Notes:**
- Return type stays `Promise<{ fitbitLogId: number | null } | null>` — no caller changes needed
- The `userId` check on customFoods.delete is a safety measure
- **Migration note:** Existing orphaned `custom_foods` rows need one-time cleanup. Log in MIGRATIONS.md.

---

### Task 3: Log orphan cleanup migration

**Issue:** FOO-284
**Files:**
- `MIGRATIONS.md` (modify)

**Steps:**
1. Append to `MIGRATIONS.md`:
   ```
   ## Orphan custom_foods cleanup (FOO-284)
   After deploying the orphan-cleanup code, run a one-time query to clean up existing orphaned rows:
   DELETE FROM custom_foods WHERE id NOT IN (SELECT DISTINCT custom_food_id FROM food_log_entries);
   ```
2. No tests needed — documentation only

---

### Task 4: Add description column to schema and types

**Issue:** FOO-286
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)
- `src/lib/food-log.ts` (modify — `CustomFoodInput` interface)
- `drizzle/` (generated by drizzle-kit)

**TDD Steps:**

1. **RED** - Update types and write a test:
   - In `src/types/index.ts`, add `description: string` to `FoodAnalysis` interface (after `notes`)
   - In `src/lib/food-log.ts`, add `description?: string | null` to `CustomFoodInput` interface
   - In `src/lib/__tests__/food-log.test.ts`, add test in `insertCustomFood`:
     - `"stores description field in customFoods table"` — pass `description: "A bowl of oatmeal with berries"`, verify `mockValues` called with `description: "A bowl of oatmeal with berries"`
     - `"stores null description when not provided"` — omit description, verify stored as null
   - In `src/lib/__tests__/claude.test.ts`, update `validAnalysis` to include `description: "Standard Argentine beef empanada, baked style"`
   - Run: `npm test`
   - Verify: Tests fail (schema and implementation don't have description yet)

2. **GREEN** - Add the column and update code:
   - In `src/db/schema.ts`, add to `customFoods` table: `description: text("description"),` (after `notes`)
   - In `src/lib/food-log.ts`, update `insertCustomFood` to include `description: data.description ?? null` in the values
   - Run: `npx drizzle-kit generate` to create the migration file
   - Run: `npm test`
   - Verify: Tests pass

3. **REFACTOR** - Verify the generated migration SQL adds a nullable text column

**Notes:**
- Column is nullable — no DEFAULT needed, no backfill needed
- Existing rows get NULL description automatically
- **Migration note:** Safe schema change — nullable column addition. No data migration needed.

---

### Task 5: Add description to Claude tool and validation

**Issue:** FOO-286
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - Add test: `"includes description in tool schema"` — verify `mockCreate` called with tool schema containing `description` property
   - Add test: `"validates description as optional string"` — test that a response with `description: 123` (number) fails validation
   - Add test: `"accepts response without description (defaults to empty string)"` — test that missing description defaults to empty string
   - Update existing `validAnalysis` fixture if not done in Task 4
   - Run: `npm test -- claude`
   - Verify: New tests fail

2. **GREEN** - Update tool schema and validation:
   - In `REPORT_NUTRITION_TOOL.input_schema.properties`, add:
     ```
     description: {
       type: "string",
       description: "A rich visual description of what you identified in the image (e.g., 'A white plate with two scrambled eggs, three strips of bacon, and a slice of whole wheat toast with butter')",
     },
     ```
   - Add `"description"` to the `required` array
   - In `validateFoodAnalysis`, add validation for `description`:
     ```
     if (typeof data.description !== "string") {
       throw new ClaudeApiError("Invalid food analysis: missing description");
     }
     ```
   - Add `description: data.description as string` to the return object
   - Run: `npm test -- claude`
   - Verify: All tests pass

3. **REFACTOR** - Ensure description appears in the return type consistently

**Notes:**
- Description is required in the tool schema (Claude must always provide it)
- Pattern follows `notes` exactly
- The `SYSTEM_PROMPT` does not need changes — the tool description is sufficient to guide Claude

---

### Task 6: Pass description through API routes

**Issue:** FOO-286
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/refine-food/route.ts` (modify)
- `src/lib/claude.ts` (modify — refinement prompt text)

**TDD Steps:**

1. **RED** - The existing route tests (if any) should already work since `FoodAnalysis` now includes `description` and flows through. Check manually:
   - The `isValidFoodLogRequest` function validates `FoodAnalysis` fields — needs `description` validation added (optional for reuse flow, present for new food flow)
   - The `isValidPreviousAnalysis` in refine-food needs `description` check
   - The `refineAnalysis` prompt text in `claude.ts` should include the previous description

2. **GREEN** - Update validation and flow:
   - In `src/app/api/log-food/route.ts`:
     - In `isValidFoodLogRequest`, the new food flow check: after `notes` validation, no need to validate `description` separately since it comes from `FoodAnalysis` which is already validated by Claude. But for safety, add: `if (typeof req.description !== "string") return false;` in the new food validation block
     - In the new food flow `insertCustomFood` call, add `description: body.description`
   - In `src/app/api/refine-food/route.ts`:
     - In `isValidPreviousAnalysis`, add: `typeof obj.description === "string"` to the check
   - In `src/lib/claude.ts` `refineAnalysis`:
     - Add `Description: ${previousAnalysis.description}` to the refinement prompt text (after the Notes line)
   - Run: `npm test`
   - Verify: All tests pass

3. **REFACTOR** - Verify the full flow: Claude returns description → validation → API → DB

**Notes:**
- The reuse flow (`reuseCustomFoodId`) doesn't send description — it reuses an existing custom food
- The refinement flow passes description through as part of `FoodAnalysis`

---

### Task 7: Display description in analysis result UI

**Issue:** FOO-286
**Files:**
- `src/components/analysis-result.tsx` (modify)

**TDD Steps:**

1. **RED** - No component tests currently exist for this component. This is a UI-only change.
   - Manual verification will confirm the description appears

2. **GREEN** - Add description display:
   - In `src/components/analysis-result.tsx`, add a description section above the notes section:
     ```tsx
     {/* Description */}
     {analysis.description && (
       <div className="pt-2 border-t">
         <p className="text-sm text-foreground">{analysis.description}</p>
       </div>
     )}
     ```
   - Place it after the portion size line and before the nutrition grid
   - Run: `npm run build`
   - Verify: Build succeeds

3. **REFACTOR** - Ensure description has distinct visual styling from notes (notes are italic + muted, description is normal weight)

**Notes:**
- Description should be visually prominent since it tells the user what was identified
- Notes remain italic/muted as they explain assumptions

---

### Task 8: Add food entry detail query and type

**Issue:** FOO-287
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)

**TDD Steps:**

1. **RED** - Write failing tests:
   - In `src/types/index.ts`, add new interface:
     ```ts
     export interface FoodLogEntryDetail {
       id: number;
       foodName: string;
       description: string | null;
       notes: string | null;
       calories: number;
       proteinG: number;
       carbsG: number;
       fatG: number;
       fiberG: number;
       sodiumMg: number;
       amount: number;
       unitId: number;
       mealTypeId: number;
       date: string;
       time: string | null;
       fitbitLogId: number | null;
       confidence: string;
     }
     ```
   - In `src/lib/__tests__/food-log.test.ts`, add `describe("getFoodLogEntryDetail")`:
     - `"returns full entry with notes and description"` — mock join query returning row with notes and description, verify all fields mapped correctly
     - `"returns null for non-existent entry"` — mock empty result, expect null
     - `"handles null description and notes"` — mock row with null description/notes, verify nulls
   - Run: `npm test -- food-log`
   - Verify: Tests fail (function doesn't exist)

2. **GREEN** - Implement the detail query:
   - In `src/lib/food-log.ts`, add:
     ```ts
     export async function getFoodLogEntryDetail(
       userId: string,
       id: number,
     ): Promise<FoodLogEntryDetail | null> {
       const db = getDb();
       const rows = await db
         .select()
         .from(foodLogEntries)
         .innerJoin(customFoods, eq(foodLogEntries.customFoodId, customFoods.id))
         .where(and(eq(foodLogEntries.id, id), eq(foodLogEntries.userId, userId)));
       const row = rows[0];
       if (!row) return null;
       return {
         id: row.food_log_entries.id,
         foodName: row.custom_foods.foodName,
         description: row.custom_foods.description ?? null,
         notes: row.custom_foods.notes ?? null,
         calories: row.custom_foods.calories,
         proteinG: Number(row.custom_foods.proteinG),
         carbsG: Number(row.custom_foods.carbsG),
         fatG: Number(row.custom_foods.fatG),
         fiberG: Number(row.custom_foods.fiberG),
         sodiumMg: Number(row.custom_foods.sodiumMg),
         amount: Number(row.food_log_entries.amount),
         unitId: row.food_log_entries.unitId,
         mealTypeId: row.food_log_entries.mealTypeId,
         date: row.food_log_entries.date,
         time: row.food_log_entries.time,
         fitbitLogId: row.food_log_entries.fitbitLogId,
         confidence: row.custom_foods.confidence,
       };
     }
     ```
   - Import `FoodLogEntryDetail` from `@/types`
   - Run: `npm test -- food-log`
   - Verify: All tests pass

3. **REFACTOR** - Ensure the mock setup for join queries works with the new function

---

### Task 9: Add GET endpoint for food entry detail

**Issue:** FOO-287
**Files:**
- `src/app/api/food-history/[id]/route.ts` (modify)

**TDD Steps:**

1. **RED** - No API route tests for this endpoint currently. Write the handler directly.

2. **GREEN** - Add GET handler:
   - In `src/app/api/food-history/[id]/route.ts`, add:
     ```ts
     import { getFoodLogEntryDetail } from "@/lib/food-log";
     ```
     (Add to existing imports)
   - Add GET handler:
     ```ts
     export async function GET(
       _request: Request,
       { params }: { params: Promise<{ id: string }> },
     ) {
       const session = await getSession();
       const validationError = validateSession(session);
       if (validationError) return validationError;

       const { id: idParam } = await params;
       const id = parseInt(idParam, 10);
       if (Number.isNaN(id)) {
         return errorResponse("VALIDATION_ERROR", "Invalid entry ID", 400);
       }

       try {
         const entry = await getFoodLogEntryDetail(session!.userId, id);
         if (!entry) {
           return errorResponse("VALIDATION_ERROR", "Food log entry not found", 404);
         }
         const response = successResponse(entry);
         response.headers.set("Cache-Control", "private, no-cache");
         return response;
       } catch (error) {
         logger.error(
           { action: "get_food_entry_detail_error", error: error instanceof Error ? error.message : String(error) },
           "failed to get food entry detail",
         );
         return errorResponse("INTERNAL_ERROR", "Failed to get food entry detail", 500);
       }
     }
     ```
   - Run: `npm run build`
   - Verify: Build succeeds

3. **REFACTOR** - Ensure consistent error handling with the existing DELETE handler in the same file

**Notes:**
- Follows same pattern as `src/app/api/food-history/route.ts` GET handler
- Cache-Control: private, no-cache per CLAUDE.md convention

---

### Task 10: Create food detail page and loading skeleton

**Issue:** FOO-287
**Files:**
- `src/app/app/food-detail/[id]/page.tsx` (create)
- `src/app/app/food-detail/[id]/loading.tsx` (create)
- `src/components/food-detail.tsx` (create)

**TDD Steps:**

1. **RED** - No component tests. Build verification.

2. **GREEN** - Create the pages:
   - Create `src/app/app/food-detail/[id]/loading.tsx`:
     ```tsx
     import { Skeleton } from "@/components/ui/skeleton";

     export default function Loading() {
       return (
         <div className="min-h-screen px-4 py-6">
           <div className="mx-auto w-full max-w-md flex flex-col gap-6">
             <Skeleton className="w-8 h-8" />
             <Skeleton className="w-48 h-8" />
             <Skeleton className="w-full h-20" />
             <Skeleton className="w-full h-64 rounded-lg" />
             <Skeleton className="w-full h-16" />
           </div>
         </div>
       );
     }
     ```
   - Create `src/app/app/food-detail/[id]/page.tsx`:
     ```tsx
     import { redirect } from "next/navigation";
     import { getSession } from "@/lib/session";
     import { FoodDetail } from "@/components/food-detail";
     import { SkipLink } from "@/components/skip-link";

     interface Props {
       params: Promise<{ id: string }>;
     }

     export default async function FoodDetailPage({ params }: Props) {
       const session = await getSession();
       if (!session) {
         redirect("/");
       }
       const { id } = await params;
       return (
         <div className="min-h-screen px-4 py-6">
           <SkipLink />
           <main id="main-content" className="mx-auto w-full max-w-md flex flex-col gap-6">
             <FoodDetail entryId={id} />
           </main>
         </div>
       );
     }
     ```
   - Create `src/components/food-detail.tsx`:
     ```tsx
     "use client";

     import useSWR from "swr";
     import { apiFetcher } from "@/lib/swr";
     import { NutritionFactsCard } from "@/components/nutrition-facts-card";
     import { ConfidenceBadge } from "@/components/confidence-badge";
     import { Button } from "@/components/ui/button";
     import { ArrowLeft } from "lucide-react";
     import { useRouter } from "next/navigation";
     import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
     import type { FoodLogEntryDetail } from "@/types";

     interface FoodDetailProps {
       entryId: string;
     }

     function formatTime(time: string | null): string {
       if (!time) return "";
       const [h, m] = time.split(":");
       const hour = parseInt(h, 10);
       const ampm = hour >= 12 ? "PM" : "AM";
       const h12 = hour % 12 || 12;
       return `${h12}:${m} ${ampm}`;
     }

     function formatDate(dateStr: string): string {
       const date = new Date(dateStr + "T00:00:00");
       return date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
     }

     export function FoodDetail({ entryId }: FoodDetailProps) {
       const router = useRouter();
       const { data, isLoading, error } = useSWR<FoodLogEntryDetail>(
         `/api/food-history/${entryId}`,
         apiFetcher,
       );

       if (isLoading) {
         return (
           <div className="space-y-4">
             <p className="text-sm text-muted-foreground text-center">Loading...</p>
           </div>
         );
       }

       if (error || !data) {
         return (
           <div className="space-y-4">
             <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => router.back()}>
               <ArrowLeft className="h-5 w-5" />
             </Button>
             <p className="text-sm text-destructive text-center">
               {error ? "Failed to load entry details." : "Entry not found."}
             </p>
           </div>
         );
       }

       return (
         <div className="space-y-6">
           {/* Back button */}
           <Button variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]" onClick={() => router.back()} aria-label="Go back">
             <ArrowLeft className="h-5 w-5" />
           </Button>

           {/* Header */}
           <div className="flex items-center justify-between">
             <h1 className="text-2xl font-bold">{data.foodName}</h1>
             <ConfidenceBadge confidence={data.confidence as "high" | "medium" | "low"} />
           </div>

           {/* Date/time/meal info */}
           <div className="text-sm text-muted-foreground space-y-1">
             <p>{formatDate(data.date)}{data.time ? ` at ${formatTime(data.time)}` : ""}</p>
             <p>{FITBIT_MEAL_TYPE_LABELS[data.mealTypeId] ?? "Unknown"} · {getUnitLabel(data.unitId, data.amount)}</p>
           </div>

           {/* Description */}
           {data.description && (
             <div className="rounded-lg bg-muted/50 p-4">
               <p className="text-sm">{data.description}</p>
             </div>
           )}

           {/* Nutrition facts card */}
           <NutritionFactsCard
             foodName={data.foodName}
             calories={data.calories}
             proteinG={data.proteinG}
             carbsG={data.carbsG}
             fatG={data.fatG}
             fiberG={data.fiberG}
             sodiumMg={data.sodiumMg}
             unitId={data.unitId}
             amount={data.amount}
             mealTypeId={data.mealTypeId}
           />

           {/* Notes */}
           {data.notes && (
             <div className="rounded-lg border p-4">
               <h3 className="text-sm font-semibold mb-2">AI Notes</h3>
               <p className="text-sm text-muted-foreground italic">{data.notes}</p>
             </div>
           )}
         </div>
       );
     }
     ```
   - Run: `npm run build`
   - Verify: Build succeeds

3. **REFACTOR** - Ensure consistent layout with other app pages (max-w-md, px-4 py-6)

**Notes:**
- `formatTime` is duplicated from `food-history.tsx` — acceptable for now, can be extracted later if needed
- `ConfidenceBadge` is reused from the analysis result flow
- The `apiFetcher` from `src/lib/swr.ts` unwraps the API response format

---

### Task 11: Add navigation from food history to detail page

**Issue:** FOO-287
**Files:**
- `src/components/food-history.tsx` (modify)

**TDD Steps:**

1. **RED** - No component tests. Build verification.

2. **GREEN** - Update food history dialog:
   - In `src/components/food-history.tsx`:
     - Import `Link` from `next/link`
     - In the `Dialog` content section (after `NutritionFactsCard`), add a "View Details" link:
       ```tsx
       <Link
         href={`/app/food-detail/${selectedEntry.id}`}
         className="block w-full text-center text-sm text-primary hover:underline min-h-[44px] flex items-center justify-center"
       >
         View Full Details
       </Link>
       ```
   - Run: `npm run build`
   - Verify: Build succeeds

3. **REFACTOR** - Ensure the link has proper touch target size (44px min height)

**Notes:**
- The dialog stays for quick nutrition view — the link is for full details with notes/description
- Mobile users can tap the link to navigate to the full detail page

---

### Task 12: Integration & Verification

**Issues:** FOO-284, FOO-285, FOO-286, FOO-287
**Files:** Various

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Verify zero warnings across all checks
6. Manual verification checklist:
   - [ ] Claude API calls have no retry loops
   - [ ] SDK maxRetries is explicitly set to 2
   - [ ] Delete food log entry cleans up orphaned custom foods
   - [ ] Description column exists in schema migration
   - [ ] Description appears in analysis result before logging
   - [ ] Description preserved through refinement flow
   - [ ] Food detail page renders at `/app/food-detail/[id]`
   - [ ] Detail page shows description, notes, confidence, nutrition facts
   - [ ] Detail page has loading skeleton
   - [ ] "View Full Details" link appears in history dialog
   - [ ] Detail page works for entries without description (nullable)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Claude API failure (after SDK retries exhausted) | Throws ClaudeApiError | Unit test |
| Delete entry with no orphan | Only entry deleted, custom food kept | Unit test |
| Delete entry creating orphan | Both entry and custom food deleted | Unit test |
| Missing description in Claude response | Validation error thrown | Unit test |
| Detail page for non-existent entry | 404 response | API handler |
| Detail page for entry without description | Shows nutrition facts, no description section | UI handling |

## Risks & Open Questions

- [ ] Risk: Test mock complexity for `db.transaction()` — Drizzle's transaction API passes a tx object that mirrors the db API. Mock needs to support this pattern.
- [ ] Risk: `drizzle-kit generate` must be run by the lead (not workers) to avoid hand-written migration files.

## Scope Boundaries

**In Scope:**
- Remove retry logic from Claude API calls
- Orphan custom_foods cleanup on delete
- Description field in schema, types, Claude tool, API, UI
- Full detail page for food history entries
- Loading skeleton for detail page

**Out of Scope:**
- Extracting shared `formatTime` utility (can be done later)
- Adding images to the detail page
- Editing food entries from the detail page
- Component-level tests for UI components
