# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-03-28
**Reviewed:** 2026-03-28
**Source:** Inline request: Nutritional Label Library — store scanned label data for instant reuse by keyword, with chat-based CRUD, intelligent duplicate prevention, robust matching, and management UI
**Linear Issues:** [FOO-877](https://linear.app/lw-claude/issue/FOO-877/nutrition-labels-db-table-types-and-data-access-module), [FOO-878](https://linear.app/lw-claude/issue/FOO-878/claude-tools-for-label-operations-system-prompt-integration), [FOO-879](https://linear.app/lw-claude/issue/FOO-879/api-routes-for-nutrition-label-management), [FOO-880](https://linear.app/lw-claude/issue/FOO-880/label-management-page-bottom-nav-settings-link), [FOO-881](https://linear.app/lw-claude/issue/FOO-881/bottom-nav-test-and-snapshot-updates-for-5-item-layout)
**Branch:** feat/FOO-877-nutrition-label-library

## Context Gathered

### Codebase Analysis

- **Database schema** (`src/db/schema.ts`): 10 tables. `customFoods` stores food definitions with `numeric` type for nutrition values (stored as strings), `integer` for calories, `text[]` for keywords, `bigint` for fitbitFoodId. `foodLogEntries` references customFoods via FK. New table follows same patterns.
- **Food matching** (`src/lib/food-matching.ts`): `computeMatchRatio()` compares keyword arrays (0–1 ratio), `checkNutrientTolerance()` validates similarity (±20% cal, ±25% macros with absolute minimums), `findMatchingFoods()` uses 0.5 ratio threshold + nutrient check. Keywords explicitly exclude brand names — label matching needs a different approach.
- **Claude tools** (`src/lib/chat-tools.ts`): Three data tools (`search_food_log`, `get_nutrition_summary`, `get_fasting_info`) defined as `Anthropic.Tool` objects with `strict: true` JSON schemas. Router in `executeTool()` dispatches by name. `DATA_TOOLS` array at `claude.ts:644` collects all data tools.
- **Tool loop** (`src/lib/claude.ts:863`): `runToolLoop()` separates `report_nutrition` blocks from data tool blocks. Data tools execute in parallel via `executeDataTools()`. New label tools are data tools — they follow this exact pattern.
- **Analysis flow** (`src/lib/claude.ts:1197`): `analyzeFood()` builds tools as `[WEB_SEARCH_TOOL, REPORT_NUTRITION_TOOL, ...DATA_TOOLS]`. New label tools go in `DATA_TOOLS` → automatically available in analysis.
- **Chat flow** (`src/lib/claude.ts:1537`): `conversationalRefine()` uses `runToolLoop()` with default `[WEB_SEARCH_TOOL, ...DATA_TOOLS]`. Label tools automatically available.
- **System prompts**: `ANALYSIS_SYSTEM_PROMPT` (line 583) and `CHAT_SYSTEM_PROMPT` (line 42) both have web search guidelines for branded products. Label search instructions go alongside these.
- **Bottom nav** (`src/components/bottom-nav.tsx`): 4 items (Home, Analyze, Quick Select, Chat). Active indicator width = `100/navItems.length`%. Adding a 5th item between Home and Analyze changes width to 20%.
- **Settings** (`src/components/settings-content.tsx`): Card-based layout with sections. Uses `useSWR` for data. New "Nutrition Labels" section links to `/app/labels`.
- **SWR** (`src/lib/swr.ts`): `apiFetcher` + `invalidateFoodCaches()` with prefix matching. Need new `invalidateLabelCaches()` for `/api/nutrition-labels`.
- **API patterns**: Auth via `getSession()` + `validateSession()`. Responses via `successResponse()`/`errorResponse()`. GET routes set `Cache-Control: private, no-cache`. Tests colocated in `__tests__/` subdirectories.
- **No auto-save during analysis**: `/api/analyze-food` only streams analysis events. Saving happens only when user taps "Log to Fitbit" via `/api/log-food`. Label auto-save is different — it happens during the Claude tool loop, not via a separate API call.

### MCP Context

- **MCPs used:** Linear (issue creation)
- **Findings:** No existing Backlog/Todo issues related to nutrition labels. Created FOO-877 through FOO-881 in Todo state.

## Design Decisions

### Matching Architecture

Claude is the matching intelligence — no embeddings or vector search needed for a personal database of <200 labels. The `search_nutrition_labels` tool returns candidates via broad ILIKE search; Claude evaluates semantic match.

**Three-tier confidence model:**

| Tier | Condition | Behavior |
|------|-----------|----------|
| **Exact match** | Brand + product + variant clearly align | Use silently. Set confidence "high". Mention in notes: "Used label: X" |
| **Probable match** | Brand + product match, variant ambiguous | Mention briefly: "Using your label for X" — no confirmation dialog |
| **Category only** | Generic food, specific brand label exists | Do NOT use. Estimate as usual. "Cheese" ≠ "Dambo cheese" label |

**Critical prompt rule:** "A nutrition label represents a specific branded product. Only use it when the user's description clearly refers to that exact product. Never apply a label to a generic food category."

### Auto-Save Behavior

When Claude detects a nutrition label in photos during analysis, it extracts data and calls `save_nutrition_label` automatically. No confirmation needed. Claude mentions: "Saved label for Ser Firme Vainilla — I'll use it next time you log this product." The save tool handles dedup internally.

### Duplicate Detection

The `save_nutrition_label` execute function checks for duplicates before inserting:
1. Search existing labels: `brand ILIKE` + `productName ILIKE`
2. **No match** → insert new label
3. **Same brand + product + variant, nutrients within 10%** → update existing silently (refresh timestamp)
4. **Same brand + product + variant, nutrients differ >10%** → update existing, return "updated_changed" so Claude mentions it
5. **Same brand + product, different variant** → insert new label (different flavor/size)

Nutrient comparison normalizes to per-100g using `servingSizeG` before comparing.

### Portion Handling

Labels store a canonical serving size. When the user logs food that matches a label, Claude uses photo context and description to estimate the portion. It does NOT ask "How many grams did you have?" unless genuinely unsure. If the portion looks close to the label's serving size, use it as-is. If clearly different (e.g., half a package), scale proportionally.

### Chat Minimalism

The chat is not the happy path. Claude should:
- Auto-save labels without asking
- Auto-use exact matches without confirming
- Only mention label usage briefly in the analysis notes
- Never pop up questions about portion size unless truly ambiguous
- Chat-based CRUD (create/edit/delete) is for explicit user requests, not part of the normal flow

## Tasks

### Task 1: `nutrition_labels` table, types, and data access module
**Linear Issue:** [FOO-877](https://linear.app/lw-claude/issue/FOO-877/nutrition-labels-db-table-types-and-data-access-module)
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)
- `src/lib/nutrition-labels.ts` (create)
- `src/lib/__tests__/nutrition-labels.test.ts` (create)

**Steps:**

1. Add types to `src/types/index.ts`:
   - `NutritionLabel` interface: `id` (number), `userId` (string), `brand` (string), `productName` (string), `variant` (string | null), `servingSizeG` (number), `servingSizeLabel` (string), `calories` (number), `proteinG`/`carbsG`/`fatG`/`fiberG`/`sodiumMg` (number), `saturatedFatG`/`transFatG`/`sugarsG` (number | null), `extraNutrients` (Record<string, number> | null), `source` (string), `notes` (string | null), `createdAt` (Date), `updatedAt` (Date)
   - `NutritionLabelInput` interface: same fields minus `id`, `userId`, `createdAt`, `updatedAt`
   - `NutritionLabelSearchResult` interface: extends `NutritionLabel`, no extra fields (type alias for clarity in tool return types)

2. Add `nutritionLabels` table to `src/db/schema.ts`:
   - Follow `customFoods` column patterns: `numeric` for nutritional values, `integer` for calories
   - Columns: `id` (serial PK), `userId` (uuid FK → users, not null), `brand` (text, not null), `productName` (text, not null), `variant` (text, nullable), `servingSizeG` (numeric, not null), `servingSizeLabel` (text, not null), `calories` (integer, not null), `proteinG`/`carbsG`/`fatG`/`fiberG`/`sodiumMg` (numeric, not null), `saturatedFatG`/`transFatG`/`sugarsG` (numeric, nullable), `extraNutrients` (jsonb, nullable), `source` (text, not null — values: "photo_scan", "manual_entry", "chat_entry"), `notes` (text, nullable), `createdAt` (timestamp with tz, defaultNow, not null), `updatedAt` (timestamp with tz, defaultNow, not null)
   - **Migration note:** New empty table, no production data migration needed. Run `npx drizzle-kit generate` to create migration.

3. Write tests in `src/lib/__tests__/nutrition-labels.test.ts` for each data access function:
   - `searchLabels(userId, searchTerms[])`: returns labels where ALL search terms appear in brand, productName, or variant (ILIKE). Returns empty array when no matches. Sorted by updatedAt DESC. Limit 10.
   - `insertLabel(userId, data)`: creates label, returns `{ id, createdAt }`. Validates required fields.
   - `updateLabel(userId, labelId, data)`: updates specified fields + sets updatedAt to now. Returns updated label. Throws if not found or wrong userId.
   - `deleteLabel(userId, labelId)`: deletes label. Returns boolean (true if deleted). Returns false if not found or wrong userId.
   - `getLabelById(userId, labelId)`: returns full label or null. Validates ownership.
   - `getAllLabels(userId, query?)`: returns all labels for user. Optional text query filters across brand/productName/variant. Sorted by updatedAt DESC.
   - `findDuplicateLabel(userId, brand, productName, variant?)`: searches for existing labels with matching brand + productName (ILIKE). Returns matches with variant info for caller to evaluate. Returns empty array when no duplicates.
   - Test ownership isolation: user A cannot read/update/delete user B's labels.
   - Mock DB following patterns in `src/lib/__tests__/food-log.test.ts`.

4. Run verifier with pattern `"nutrition-labels"` (expect fail)

5. Implement `src/lib/nutrition-labels.ts`:
   - Import `db` from `@/db`, schema from `@/db/schema`, types from `@/types`
   - All functions take `userId` as first parameter (ownership enforcement)
   - `searchLabels`: Build WHERE clause with `and(eq(userId), ...searchTerms.map(term => or(ilike(brand, %term%), ilike(productName, %term%), ilike(variant, %term%))))`. The AND of ORs ensures all terms match somewhere.
   - `insertLabel`: Simple `db.insert(nutritionLabels).values({...}).returning({id, createdAt})`
   - `updateLabel`: `db.update(nutritionLabels).set({...data, updatedAt: new Date()}).where(and(eq(id), eq(userId))).returning()`
   - `deleteLabel`: `db.delete(nutritionLabels).where(and(eq(id), eq(userId))).returning({id})`
   - `getLabelById`: `db.select().from(nutritionLabels).where(and(eq(id), eq(userId))).limit(1)`
   - `getAllLabels`: `db.select().from(nutritionLabels).where(eq(userId))` + optional ILIKE filter on query
   - `findDuplicateLabel`: `db.select().from(nutritionLabels).where(and(eq(userId), ilike(brand, brand), ilike(productName, productName)))`
   - Use pino logger following `food-log.ts` patterns

6. Run verifier with pattern `"nutrition-labels"` (expect pass)

### Task 2: Claude tools for label operations + system prompt integration
**Linear Issue:** [FOO-878](https://linear.app/lw-claude/issue/FOO-878/claude-tools-for-label-operations-system-prompt-integration)
**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**

1. Write tests in `src/lib/__tests__/chat-tools.test.ts` for the three new execute functions:
   - **`executeSearchNutritionLabels`**: Test with keywords → returns formatted label candidates. Test with no results → returns "No matching labels found." Test result format includes brand, productName, variant, servingSizeLabel, calories, macros.
   - **`executeSaveNutritionLabel`**: Test new label (no duplicate) → returns "created" status with label id. Test duplicate with same nutrients (within 10%) → returns "updated" status. Test duplicate with different nutrients (>10% diff) ��� returns "updated_changed" status with diff summary. Test same brand different variant → returns "created" (new label). Dedup logic normalizes nutrients to per-100g using servingSizeG before comparing.
   - **`executeManageNutritionLabel`**: Test update action → returns updated label summary. Test delete action → returns confirmation. Test delete non-existent → returns "Label not found." Test update non-existent → returns "Label not found."
   - **`executeTool` router**: Test that all three new tool names dispatch correctly.
   - Mock `nutrition-labels.ts` functions (not the DB directly).

2. Run verifier with pattern `"chat-tools"` (expect fail)

3. Add tool definitions to `src/lib/chat-tools.ts`:

   **`SEARCH_NUTRITION_LABELS_TOOL`:**
   - `name`: "search_nutrition_labels"
   - `description`: "Search the user's saved nutrition label library for branded/packaged products. Returns matching labels with full nutrition data. Use this BEFORE estimating nutrition for any branded, packaged, or commercial food product."
   - `input_schema`: `{ keywords: string[] }` — 1-5 lowercase search terms (brand name, product name, variant). Required.
   - `strict: true`

   **`SAVE_NUTRITION_LABEL_TOOL`:**
   - `name`: "save_nutrition_label"
   - `description`: "Save nutrition data extracted from a product label photo. Automatically detects and handles duplicates. Call this when you detect a nutrition facts label in the user's photos."
   - `input_schema`: `{ brand: string, product_name: string, variant: string|null, serving_size_g: number, serving_size_label: string, calories: number, protein_g: number, carbs_g: number, fat_g: number, fiber_g: number, sodium_mg: number, saturated_fat_g: number|null, trans_fat_g: number|null, sugars_g: number|null, extra_nutrients: object|null, notes: string|null }`
   - `strict: true`

   **`MANAGE_NUTRITION_LABEL_TOOL`:**
   - `name`: "manage_nutrition_label"
   - `description`: "Update or delete a nutrition label entry. Use when the user explicitly asks to modify or remove a saved label."
   - `input_schema`: `{ action: "update"|"delete", label_id: number, update_fields: object|null }` — `update_fields` contains the fields to update (same shape as save, all optional). Required when action is "update", null when "delete".
   - `strict: true`

4. Implement execute functions:

   **`executeSearchNutritionLabels(params, userId)`:**
   - Call `searchLabels(userId, params.keywords)`
   - Format results as readable text: for each label, show `[label:N] Brand - Product Name (Variant) | Serving: X | Cal: N | P: Ng C: Ng F: Ng | Saved: date`
   - If no results: return "No matching nutrition labels found in your library."
   - The `[label:N]` prefix mirrors `[id:N]` pattern from search_food_log — gives Claude a stable reference for manage operations.

   **`executeSaveNutritionLabel(params, userId)`:**
   - Call `findDuplicateLabel(userId, params.brand, params.product_name, params.variant)`
   - If duplicates found with matching variant (or both null):
     - Normalize both old and new nutrients to per-100g: `value * 100 / servingSizeG`
     - Compare calories, protein, carbs, fat. If all within 10% OR absolute diff ≤ threshold (25 cal, 3g macro): update existing, return `{ status: "updated", labelId }`
     - If any differ beyond tolerance: update existing, return `{ status: "updated_changed", labelId, changes: [...] }` with specific diffs
   - If duplicates found with different variant: insert new, return `{ status: "created", labelId }`
   - If no duplicates: insert new, return `{ status: "created", labelId }`
   - Format return as human-readable text for Claude's response.

   **`executeManageNutritionLabel(params, userId)`:**
   - If action "delete": call `deleteLabel(userId, params.label_id)`. Return "Deleted label [label:N]." or "Label not found."
   - If action "update": call `updateLabel(userId, params.label_id, params.update_fields)`. Return updated label summary or "Label not found."

5. Update `executeTool()` router (line 343) to add cases for all three new tool names.

6. Register tools in `DATA_TOOLS` array (`src/lib/claude.ts:644`):
   - Add `SEARCH_NUTRITION_LABELS_TOOL`, `SAVE_NUTRITION_LABEL_TOOL`, `MANAGE_NUTRITION_LABEL_TOOL` to imports from `@/lib/chat-tools`
   - Add all three to the `DATA_TOOLS` array

7. Update system prompts in `src/lib/claude.ts`:

   **Add to `CHAT_SYSTEM_PROMPT` (after web search guidelines, before closing backtick):**
   ```
   Nutrition label library:
   - You have access to the user's personal nutrition label library via search_nutrition_labels, save_nutrition_label, and manage_nutrition_label.
   - BEFORE estimating nutrition for any branded, packaged, or commercial food product, ALWAYS call search_nutrition_labels with the brand and product name as keywords.
   - A nutrition label represents a SPECIFIC branded product. Only use a label when the user's description clearly refers to that exact product. "Cheese" does NOT match a "Dambo cheese" label. "La Serenisima whole milk" DOES match a "La Serenisima Entera" label.
   - Matching tiers: (1) Exact match (brand + product + variant align) → use silently, set confidence "high", include "Used label: [product]" in notes. (2) Probable match (brand + product match, variant ambiguous) → mention briefly "Using your label for X". (3) Category only (generic food, specific brand label exists) → do NOT use, estimate as usual.
   - When you detect a nutrition facts label in the user's photos, extract the data and call save_nutrition_label immediately. Do NOT ask for confirmation — auto-save is the default. Mention what you saved: "Saved label for [product]."
   - For portion estimation when using a label: use photo context, description, and common sense. Do NOT ask the user for exact grams unless truly ambiguous. If the portion looks close to the label's serving size, use it. If clearly different (half a package, double serving), scale proportionally.
   - Argentine labels: read the "por porcion" column (not per 100g). Watch for comma as decimal separator. Both kcal and kJ may be present — use kcal.
   - Users can manage labels via chat: "update my yogurt label", "delete the cheese label", "save a label for X". Use manage_nutrition_label for updates/deletes and save_nutrition_label for manual additions.
   ```

   **Add the same block to `ANALYSIS_SYSTEM_PROMPT`** (after web search guidelines).

   **Add to `EDIT_SYSTEM_PROMPT`** — only the search capability, not the save/manage instructions (editing existing entries doesn't involve label management).

8. Run verifier with pattern `"chat-tools"` (expect pass)

9. Run full verifier (no pattern) to catch any type errors from tool registration changes.

**Notes:**
- The `save_nutrition_label` execute function imports from `@/lib/nutrition-labels` (Task 1). Task dependency is strict.
- Tool names use underscores to match existing convention (`search_food_log`, `get_nutrition_summary`).
- The `[label:N]` prefix in search results gives Claude a stable ID reference, same pattern as `[id:N]` for custom foods.
- Per-100g normalization for dedup: `normalizedValue = value * 100 / servingSizeG`. This handles the case where the same product has different packaging sizes (190g vs 500g pot → different per-serving values but same per-100g).

### Task 3: API routes for nutrition label management
**Linear Issue:** [FOO-879](https://linear.app/lw-claude/issue/FOO-879/api-routes-for-nutrition-label-management)
**Files:**
- `src/app/api/nutrition-labels/route.ts` (create)
- `src/app/api/nutrition-labels/__tests__/route.test.ts` (create)
- `src/app/api/nutrition-labels/[id]/route.ts` (create)
- `src/app/api/nutrition-labels/[id]/__tests__/route.test.ts` (create)

**Steps:**

1. Write tests in `src/app/api/nutrition-labels/__tests__/route.test.ts`:
   - **GET /api/nutrition-labels**: Returns 200 with list of labels. Returns 200 with empty array when no labels. Supports `?q=search_term` filtering. Returns 401 when no session. Sets `Cache-Control: private, no-cache`. Response follows `ApiSuccessResponse<NutritionLabel[]>` format.
   - Follow test patterns from `src/app/api/food-history/__tests__/route.test.ts` — mock session, mock DB functions.

2. Write tests in `src/app/api/nutrition-labels/[id]/__tests__/route.test.ts`:
   - **DELETE /api/nutrition-labels/[id]**: Returns 200 on successful delete. Returns 404 when label not found or wrong user. Returns 401 when no session. Response follows `ApiSuccessResponse<{ deleted: true }>` format.
   - Follow test patterns from `src/app/api/food-history/[id]/__tests__/route.test.ts`.

3. Run verifier with pattern `"nutrition-labels"` (expect fail — route files don't exist yet)

4. Implement `src/app/api/nutrition-labels/route.ts`:
   - Auth: `getSession()` + `validateSession()` pattern from `@/lib/session`
   - Extract optional `q` from URL searchParams
   - Call `getAllLabels(session.userId, q || undefined)` from `@/lib/nutrition-labels`
   - Return `successResponse(labels)` with `Cache-Control: private, no-cache`
   - Error handling: 401 for missing/invalid session, 500 with `INTERNAL_ERROR` for unexpected errors

5. Implement `src/app/api/nutrition-labels/[id]/route.ts`:
   - Auth: `getSession()` + `validateSession()`
   - Extract `id` from route params, validate as integer
   - Call `deleteLabel(session.userId, id)` from `@/lib/nutrition-labels`
   - If deleted: return `successResponse({ deleted: true })`
   - If not found: return `errorResponse("Label not found", 404, "VALIDATION_ERROR")`
   - Error handling: 401 for auth, 400 for invalid id format, 500 for unexpected

6. Run verifier with pattern `"nutrition-labels"` (expect pass)

**Notes:**
- No POST or PUT routes — label creation/updates happen via Claude tools during analysis/chat, not via REST API. The management UI only needs list + delete.
- Route structure follows `src/app/api/food-history/` pattern exactly.

### Task 4: Label management page, bottom nav, and settings link
**Linear Issue:** [FOO-880](https://linear.app/lw-claude/issue/FOO-880/label-management-page-bottom-nav-settings-link), [FOO-881](https://linear.app/lw-claude/issue/FOO-881/bottom-nav-test-and-snapshot-updates-for-5-item-layout)
**Files:**
- `src/components/bottom-nav.tsx` (modify)
- `src/components/__tests__/bottom-nav.test.tsx` (modify — if exists, else note for verifier)
- `src/app/app/labels/page.tsx` (create)
- `src/app/app/labels/loading.tsx` (create)
- `src/components/nutrition-labels.tsx` (create)
- `src/components/__tests__/nutrition-labels.test.tsx` (create)
- `src/components/nutrition-label-detail-sheet.tsx` (create)
- `src/components/settings-content.tsx` (modify)
- `src/lib/swr.ts` (modify)

**Steps:**

1. Write tests in `src/components/__tests__/nutrition-labels.test.tsx`:
   - Renders search input with placeholder "Search labels..."
   - Renders list of label cards when data is available — each card shows brand, product name, variant (if present), calories, serving size
   - Renders empty state message "No nutrition labels yet" with explanation text when no labels exist
   - Renders "No results" when search returns empty
   - Calls DELETE API and invalidates cache when delete is confirmed
   - Shows AlertDialog confirmation before delete
   - Opens detail bottom sheet when card is tapped
   - Detail sheet shows full nutrition breakdown (reuse NutritionFactsCard pattern or similar)
   - Mock `useSWR` and `fetch` following patterns in `src/components/__tests__/food-history.test.tsx`

2. Run verifier with pattern `"nutrition-labels"` (expect fail)

3. **Bottom nav update** (`src/components/bottom-nav.tsx`):
   - Import `Tag` icon from lucide-react
   - Add new nav item at index 1 (between Home and Analyze): `{ label: "Labels", href: "/app/labels", icon: Tag, isActive: (pathname) => pathname === "/app/labels" }`
   - The indicator width auto-adjusts via `100 / navItems.length` (becomes 20%)
   - Update any existing bottom-nav tests to expect 5 items and verify new Labels item

4. **SWR cache invalidation** (`src/lib/swr.ts`):
   - Add `LABEL_CACHE_PREFIXES = ["/api/nutrition-labels"]`
   - Add `invalidateLabelCaches()` function following `invalidateFoodCaches()` pattern
   - Export the new function

5. **Management page** (`src/app/app/labels/page.tsx`):
   - Server component with session check + redirect (follow `/app/app/quick-select/page.tsx` pattern)
   - Render `<NutritionLabels />` client component inside standard layout: `div.min-h-screen.px-4.py-6 > main.mx-auto.w-full.max-w-md`

6. **Loading skeleton** (`src/app/app/labels/loading.tsx`):
   - Match page layout: heading skeleton (h-8 w-40) + search input skeleton (h-10 w-full) + 3 card skeletons (h-20 each with space-y-3)
   - Follow patterns in `src/app/app/quick-select/loading.tsx`

7. **NutritionLabels component** (`src/components/nutrition-labels.tsx`):
   - `"use client"` component
   - Data fetching: `useSWR<NutritionLabel[]>("/api/nutrition-labels", apiFetcher)` for full list. When search query is active: `useSWR<NutritionLabel[]>("/api/nutrition-labels?q=" + encodeURIComponent(query), apiFetcher)`
   - Search: debounced text input (300ms, min 2 chars) following `quick-select.tsx` pattern with `useDebounce` hook
   - Label card layout:
     - Left side: brand (text-xs text-muted-foreground), product name + variant (text-sm font-medium), calories + serving size (text-xs)
     - Right side: delete icon button (Trash2, min-h-[44px] min-w-[44px])
   - Delete: AlertDialog confirmation ("Delete this label? This cannot be undone."). On confirm: `fetch(DELETE /api/nutrition-labels/${id})` → `invalidateLabelCaches()`
   - Tap card body → open `NutritionLabelDetailSheet`
   - Empty state: centered text "No nutrition labels yet" with sub-text "Labels are automatically saved when you scan packaged products during food analysis."
   - Loading state: skeleton cards
   - Error state: error message with retry

8. **Detail bottom sheet** (`src/components/nutrition-label-detail-sheet.tsx`):
   - Uses Dialog with `variant="bottom-sheet"` (follow `food-entry-detail-sheet.tsx` pattern)
   - Shows: brand, product name, variant, serving size label
   - Full nutrition grid: calories, protein, carbs, fat, fiber, sodium, saturated fat, trans fat, sugars
   - Extra nutrients section if `extraNutrients` is not null (render as key-value pairs)
   - Source badge ("Photo scan" / "Manual entry" / "Chat entry")
   - Date saved (formatted)
   - Notes (if present)
   - Delete button at bottom (triggers same AlertDialog flow)

9. **Settings link** (`src/components/settings-content.tsx`):
   - Add a new card section between Fitbit credentials and Appearance
   - Section title: "Nutrition Labels"
   - Fetch label count: `useSWR<NutritionLabel[]>("/api/nutrition-labels", apiFetcher)` → show count
   - Display: "N saved labels" with a "Manage" button (Link to `/app/labels`)
   - If no labels: "No labels saved yet" with brief explanation

10. Run verifier with pattern `"nutrition-labels|bottom-nav"` (expect pass)

11. Run full verifier (no pattern) to catch any test breakage from bottom nav changes.

**Notes:**
- No pagination needed for management page — personal label library is expected to be <200 entries. Simple list with search is sufficient.
- No edit capability in the UI — editing is done via chat ("update my yogurt label"). The management page is view + delete only.
- The detail sheet doesn't need edit/log actions — it's purely informational. Delete is the only destructive action.
- Touch targets: all interactive elements must be min 44px × 44px.

## Post-Implementation Checklist

- [ ] All unit tests pass (`npm test`)
- [ ] Build succeeds with zero warnings (`npm run build`)
- [ ] Lint passes (`npm run lint`)
- [ ] Type check passes (`npm run typecheck`)
- [ ] New `loading.tsx` exists for `/app/labels` route
- [ ] Bottom nav has 5 items with correct order: Home, Labels, Analyze, Quick Select, Chat
- [ ] Migration generated via `npx drizzle-kit generate` (not hand-written)
- [ ] No security issues: auth on all API routes, ownership validation on all DB operations
- [ ] Mobile-friendly: 44px touch targets, responsive layout, bottom sheet for details
- [ ] SWR cache invalidation works for label deletion

---

## Plan Summary

**Objective:** Implement a Nutritional Label Library that stores scanned nutrition label data for instant reuse. Claude auto-saves labels during analysis, uses them for exact matches on branded products, and supports chat-based CRUD. A management page (new bottom nav item) provides browse, search, and delete functionality.

**Linear Issues:** FOO-877, FOO-878, FOO-879, FOO-880, FOO-881

**Approach:** Four tasks ordered by dependency:
1. **Foundation** (FOO-877): DB table, types, data access module with CRUD + search + dedup logic
2. **AI Integration** (FOO-878): Three Claude tools (search, save, manage) + system prompt updates with matching rules — Claude is the matching intelligence, not keyword search
3. **API Layer** (FOO-879): GET + DELETE routes for management UI (independent of Task 2)
4. **Frontend** (FOO-880, FOO-881): Labels management page with search/list/delete, bottom nav (5 items), settings link, detail bottom sheet

**Key Decisions:**
- Claude as matching engine: broad DB search returns candidates, Claude evaluates semantic match using three-tier confidence (exact/probable/category-only)
- Auto-save with no confirmation: labels saved silently during analysis, mentioned briefly in notes
- No portion questions: Claude estimates from photo/context, only asks when truly ambiguous
- Dedup normalizes to per-100g for comparison (handles different packaging sizes)
- Management UI is view + delete only; edit/create happen in chat
- `Tag` icon for bottom nav, positioned between Home and Analyze

**Scope:** 5 tasks (4 implementation + 1 nav test update folded into Task 4), ~15 files, ~40 new tests

**Risks:** Matching accuracy depends on prompt quality — may need iteration on the three-tier rules after real-world testing. The 5-item bottom nav may feel crowded on small screens (user will test and decide).

---

## Iteration 1

**Implemented:** 2026-03-28
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: nutrition_labels DB table, types, and data access module (worker-1)
- Task 2: Claude tools for label operations + system prompt integration (worker-1)
- Task 3: API routes for nutrition label management (worker-2)
- Task 4: Label management page, bottom nav, and settings link (worker-2)

### Files Modified
- `src/db/schema.ts` — Added nutritionLabels table (21 columns)
- `src/types/index.ts` — Added NutritionLabel, NutritionLabelInput, NutritionLabelSearchResult types
- `src/lib/nutrition-labels.ts` — Created data access module (searchLabels, insertLabel, updateLabel, deleteLabel, getLabelById, getAllLabels, findDuplicateLabel)
- `src/lib/__tests__/nutrition-labels.test.ts` — 19 unit tests
- `src/lib/chat-tools.ts` — Added SEARCH_NUTRITION_LABELS_TOOL, SAVE_NUTRITION_LABEL_TOOL, MANAGE_NUTRITION_LABEL_TOOL with execute functions
- `src/lib/__tests__/chat-tools.test.ts` — 17 new tests (49 total)
- `src/lib/claude.ts` — Registered tools in DATA_TOOLS, updated CHAT/ANALYSIS/EDIT system prompts
- `src/lib/__tests__/claude.test.ts` — Updated mock to include new tool exports, updated tool count assertion
- `src/app/api/nutrition-labels/route.ts` — GET endpoint (list + search)
- `src/app/api/nutrition-labels/__tests__/route.test.ts` — 7 tests
- `src/app/api/nutrition-labels/[id]/route.ts` — DELETE endpoint
- `src/app/api/nutrition-labels/[id]/__tests__/route.test.ts` — 5 tests
- `src/app/app/labels/page.tsx` — Labels management page (server component)
- `src/app/app/labels/loading.tsx` — Loading skeleton
- `src/components/nutrition-labels.tsx` — Label list with search, delete, detail sheet
- `src/components/__tests__/nutrition-labels.test.tsx` — 10 tests
- `src/components/nutrition-label-detail-sheet.tsx` — Bottom sheet with full nutrition breakdown
- `src/components/bottom-nav.tsx` — Added Labels nav item (Tag icon, index 1, 5 items)
- `src/components/__tests__/bottom-nav.test.tsx` — Updated for 5 items, 20% width, Chat at index 4 (23 tests)
- `src/components/settings-content.tsx` — Added NutritionLabelsSection with label count + manage link
- `src/lib/swr.ts` — Added invalidateLabelCaches()
- `drizzle/0015_bored_songbird.sql` — Migration for nutrition_labels table

### Linear Updates
- FOO-877: Todo → In Progress → Review
- FOO-878: Todo → In Progress → Review
- FOO-879: Todo → In Progress → Review
- FOO-880: Todo → In Progress → Review
- FOO-881: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 bugs (1 critical, 2 high, 2 medium), all fixed before proceeding
  - Duplicate NutritionLabel interface (merge conflict artifact)
  - MANAGE_NUTRITION_LABEL_TOOL strict mode schema violation
  - Debounce timer memory leak (useState → useRef)
  - Raw error.message exposed in UI
  - Silent delete failure with no user feedback
- verifier: 2,819 tests pass, zero lint warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 2 (backend/AI domain — schema, types, data access, Claude tools, system prompts)
- Worker 2: Tasks 3, 4 (API/UI domain — routes, labels page, bottom nav, settings, SWR)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged, conflicts in src/types/index.ts and src/lib/nutrition-labels.ts (duplicate type + stub vs full implementation — resolved by keeping Worker 1's full code)

### Review Findings

Summary: 4 issue(s) found, fixed inline (Team: security, reliability, quality reviewers)
- FIXED INLINE: 4 issue(s) — verified via TDD + bug-hunter

**Issues fixed inline:**
- [HIGH] BUG: Missing response.ok check in handleDeleteConfirm (`src/components/nutrition-labels.tsx:59`) — added error check + error path test (FOO-882)
- [MEDIUM] ERROR: executeManageNutritionLabel catches all errors as "Label not found" (`src/lib/chat-tools.ts:587`) — now distinguishes not-found from DB errors (FOO-883)
- [HIGH] BUG: extra_nutrients silently dropped in manage_nutrition_label update path (`src/lib/chat-tools.ts:581`) — added missing field mapping + test (FOO-884)
- [MEDIUM] BUG: Stale deleteError banner persists across unrelated delete attempts (`src/components/nutrition-labels.tsx:77,159`) — clear error state on new delete target (FOO-885)

**Discarded findings (not bugs):**
- [DISCARDED] TYPE: NutritionLabel.createdAt/updatedAt typed as Date but string after JSON deserialization — code handles correctly with `new Date()` wrappers; type reflects server-side Drizzle shape
- [DISCARDED] TYPE: extra_nutrients cast without runtime validation in chat-tools — `strict: true` on tool definition guarantees schema conformance; truncation/refusal produce different stop_reasons handled before execution
- [DISCARDED] TYPE: extraNutrients from DB cast without validation — data only enters via validated tool execution path; self-stored data doesn't need re-validation on read

### Linear Updates
- FOO-877: Review → Merge
- FOO-878: Review → Merge
- FOO-879: Review → Merge
- FOO-880: Review → Merge
- FOO-881: Review → Merge
- FOO-882: Created in Merge (Fix: missing response.ok check — fixed inline)
- FOO-883: Created in Merge (Fix: error handling catches all as not-found — fixed inline)
- FOO-884: Created in Merge (Fix: extra_nutrients dropped in update — fixed inline)
- FOO-885: Created in Merge (Fix: stale deleteError banner — fixed inline)

### Inline Fix Verification
- Unit tests: 2,822 pass (3 new tests added)
- Bug-hunter: found 2 additional issues (FOO-884, FOO-885), both fixed and verified

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
