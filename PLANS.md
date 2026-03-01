# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-703-favorites-sharing-time-editing
**Issues:** FOO-703, FOO-704, FOO-705, FOO-706, FOO-707, FOO-708, FOO-709, FOO-710, FOO-711, FOO-712, FOO-713, FOO-714, FOO-715, FOO-716, FOO-717, FOO-718, FOO-719
**Created:** 2026-02-28
**Last Updated:** 2026-02-28

## Summary

Four interconnected features that enhance the food logging experience:

1. **Favorite Foods** (FOO-703–706): Star/unstar custom foods, pin favorites at top of quick select's Suggested tab
2. **Share Food Log** (FOO-707–711): Generate shareable links for food entries, allow other users to view and log shared foods
3. **Time Selector** (FOO-712–715): Let users specify when they ate (instead of always using current time), with Claude able to suggest time/meal type via tool output
4. **Conversational Food Editing** (FOO-716–719): Edit already-logged food entries via a conversational chat interface with Fitbit delete-and-relog

## Issues

### FOO-703: Add isFavorite column to custom_foods table

**Priority:** Medium | **Labels:** Feature

Add `isFavorite` boolean column (default false, NOT NULL) to `custom_foods`. Foundation for the entire Favorite Foods feature.

**Acceptance Criteria:**
- [ ] `isFavorite` column exists on `custom_foods` with default `false`
- [ ] Migration generated via `drizzle-kit generate`
- [ ] `CommonFood` type in `src/types/index.ts` includes `isFavorite: boolean`

### FOO-704: Toggle favorite API endpoint for custom foods

**Priority:** Medium | **Labels:** Feature

New `PATCH /api/custom-foods/[id]/favorite` to toggle `isFavorite` on a custom food.

**Acceptance Criteria:**
- [ ] Endpoint toggles `isFavorite` and returns new state
- [ ] Session auth via `getSession()` + `validateSession()`
- [ ] 404 for non-existent or other-user foods
- [ ] `Cache-Control: private, no-cache` header

### FOO-705: Star UI on quick select cards and food detail screen

**Priority:** Medium | **Labels:** Feature

Show filled star on favorite foods in quick-select cards (display-only, no outline on non-favorites). Toggleable star on food-detail screen (both states visible).

**Acceptance Criteria:**
- [ ] Quick-select cards: filled star on favorites only (no empty star on non-favorites)
- [ ] Star tap target independent from card selection (`stopPropagation`), 44px
- [ ] Food detail: always show star (filled/outline), toggleable
- [ ] Optimistic update: toggle immediately, revalidate on response, revert on failure

### FOO-706: Pin favorite foods at top of Suggested tab in quick select

**Priority:** Medium | **Labels:** Feature

Partition Suggested tab: favorites first (ordered by most recently logged), then normal scored list excluding already-shown favorites. Only affects Suggested tab — Recent and search unchanged.

**Acceptance Criteria:**
- [ ] Favorites appear first in Suggested tab (page 1)
- [ ] "Favorites" section header/divider when favorites exist
- [ ] No header/change when user has no favorites
- [ ] `isFavorite` field included in `CommonFood` API response
- [ ] Within favorites section, ordered by most recently logged

### FOO-707: Add share_token column to custom_foods table

**Priority:** Medium | **Labels:** Feature

Add nullable `shareToken` text column with unique index to `custom_foods`. Generated lazily via `nanoid(12)` only when a food is first shared.

**Acceptance Criteria:**
- [ ] `shareToken` column exists (nullable, unique, indexed)
- [ ] Migration generated via `drizzle-kit generate`
- [ ] `nanoid` installed as dependency

### FOO-708: Share API endpoint to generate share token and URL

**Priority:** Medium | **Labels:** Feature

New `POST /api/share` accepting `customFoodId`. Generates token on first share, returns existing token on subsequent shares. Returns full share URL.

**Acceptance Criteria:**
- [ ] Generates `nanoid(12)` token on first share
- [ ] Returns existing token if food already has one
- [ ] Returns `{shareUrl, shareToken}` — full URL including host
- [ ] Session auth, validates food ownership
- [ ] 404 for non-existent or other-user foods

### FOO-709: Log-shared page to view and log a shared food

**Priority:** Medium | **Labels:** Feature

New route `/app/log-shared/[token]` — looks up `custom_food` by `share_token` (cross-user read), shows nutrition + MealTypeSelector + "Log to Fitbit" button. On confirm, creates a NEW `custom_food` owned by the current user (duplicates nutrition data), then uses the standard `findOrCreateFood()` + `logFood()` Fitbit flow.

**Acceptance Criteria:**
- [ ] Displays shared food name and `NutritionFactsCard`
- [ ] `MealTypeSelector` + "Log to Fitbit" button
- [ ] Creates new `custom_food` for current user (never references sharer's row)
- [ ] 404 for invalid tokens
- [ ] `loading.tsx` with skeleton
- [ ] Post-log: shows `FoodLogConfirmation`

### FOO-710: Share button on food detail screen

**Priority:** Medium | **Labels:** Feature

Share icon (lucide `Share2`) on food-detail screen next to food title, right-justified. Calls `POST /api/share`, then uses `navigator.share()` with clipboard fallback.

**Acceptance Criteria:**
- [ ] Share icon on food title line, right-justified
- [ ] Calls `POST /api/share` on tap
- [ ] Uses `navigator.share()` if available, `navigator.clipboard.writeText()` fallback
- [ ] Silently handles `AbortError` from share sheet cancellation
- [ ] Toast confirmation on clipboard copy
- [ ] 44px touch target, brief loading state

### FOO-711: Preserve return URL through OAuth login flow

**Priority:** Medium | **Labels:** Improvement

When middleware redirects unauthenticated users to `/`, preserve the original URL as `returnTo`. Pass through OAuth state parameter. Redirect to `returnTo` after successful auth.

**Acceptance Criteria:**
- [ ] Middleware adds `?returnTo={originalPath}` when redirecting from protected routes
- [ ] `returnTo` passed through Google OAuth `state` parameter
- [ ] Callback redirects to `returnTo` after auth (instead of hardcoded `/app`)
- [ ] Validates `returnTo` is relative path starting with `/` (open redirect prevention)
- [ ] Falls back to `/app` if no `returnTo` or invalid value

### FOO-712: Time selector component for food logging

**Priority:** Medium | **Labels:** Feature

New reusable `TimeSelector` component. Default "Now" (resolved at log time, not render time). Toggle to time picker for specific HH:mm. Similar pattern to `MealTypeSelector`.

**Acceptance Criteria:**
- [ ] Default "Now" state — resolved by caller at log time via `getLocalDateTime()`
- [ ] Toggle to native `<input type="time">` or equivalent (mobile-friendly)
- [ ] Returns `null` (now) or `HH:mm` string
- [ ] 24-hour format (matches app preference)
- [ ] 44px touch targets, mobile-first
- [ ] Controlled component interface: `{ value: string | null; onChange: (time: string | null) => void }`

### FOO-713: Add time selector to chat log bar (second row)

**Priority:** Medium | **Labels:** Feature

Add `TimeSelector` to `food-chat.tsx` header as a second row below existing controls. Only appears when `latestAnalysis` exists.

**Acceptance Criteria:**
- [ ] TimeSelector in second row below `[← Back] [MealType ▼] [Log to Fitbit]`
- [ ] Only visible when `latestAnalysis` is truthy
- [ ] Time value wired into `handleLog()` body
- [ ] Container uses existing `space-y-2` for row stacking

### FOO-714: Add time selector to short-path analyze screen

**Priority:** Medium | **Labels:** Feature

Add `TimeSelector` to `food-analyzer.tsx` below `MealTypeSelector` in the metadata area.

**Acceptance Criteria:**
- [ ] TimeSelector below MealTypeSelector in analyze results UI
- [ ] Time value wired into log-food call
- [ ] Defaults to "Now"

### FOO-715: Add time and mealType fields to report_nutrition tool

**Priority:** Medium | **Labels:** Feature

Add optional `time` (HH:mm string) and `meal_type_id` (1–7) fields to `REPORT_NUTRITION_TOOL` schema. When Claude sets these, the UI auto-updates `TimeSelector`/`MealTypeSelector`. Both fields are suggestions — UI pickers remain manually adjustable.

**Acceptance Criteria:**
- [ ] Optional `time` field in tool schema (`["string", "null"]`)
- [ ] Optional `meal_type_id` field in tool schema (`["number", "null"]`)
- [ ] `FoodAnalysis` type updated with `time?: string | null` and `mealTypeId?: number | null`
- [ ] `validateFoodAnalysis()` validates: HH:mm format, meal_type_id 1–7
- [ ] food-chat SSE handler auto-updates TimeSelector/MealTypeSelector from analysis event
- [ ] System prompts instruct Claude to set these when user mentions time/meal context
- [ ] UI pickers remain manually adjustable after auto-update

### FOO-716: editAnalysis() function for conversational food editing

**Priority:** Medium | **Labels:** Feature

New async generator in `claude.ts` for editing logged entries. Different system prompt than `conversationalRefine()`. Text-only (no photos). Claude summarizes existing entry first, processes cumulative corrections, shows deltas.

**Acceptance Criteria:**
- [ ] `editAnalysis()` generator accepts original entry context (nutrition, food name, description, notes)
- [ ] Edit-specific `EDIT_SYSTEM_PROMPT` with rules for corrections, cumulative changes, delta display
- [ ] Claude's first message summarizes existing entry
- [ ] Uses same `report_nutrition` tool (with time/mealType fields)
- [ ] Reuses `runToolLoop()` for multi-turn processing
- [ ] New `POST /api/edit-chat` route for SSE streaming
- [ ] Same SSE event types as `conversationalRefine()`

### FOO-717: POST /api/edit-food endpoint with Fitbit replace and compensation

**Priority:** Medium | **Labels:** Feature

Replace endpoint: delete old Fitbit log, create new `custom_food` (never mutate existing — may be referenced by other entries), create new Fitbit food + log, update `food_log_entry` to point to new data, orphan-clean old `custom_food` if unreferenced.

**Acceptance Criteria:**
- [ ] Accepts `foodLogEntryId` + updated `FoodAnalysis` + optional `time`/`mealTypeId`
- [ ] Deletes old Fitbit log (`deleteFoodLog`)
- [ ] Creates new `custom_food` (immutability — never mutate existing row)
- [ ] Creates new Fitbit food + logs at original date (`findOrCreateFood` + `logFood`)
- [ ] Updates `food_log_entry`: new `customFoodId`, new `fitbitLogId`, updated time/mealTypeId
- [ ] Orphan-cleans old `custom_food` if no entries reference it
- [ ] Compensation: if new Fitbit log fails after old deleted → re-log original; if DB fails after Fitbit → delete new Fitbit log
- [ ] Handles dry-run (skip Fitbit ops)
- [ ] Handles entries without `fitbitLogId` (skip Fitbit delete)
- [ ] Session auth with `requireFitbit`

### FOO-718: Edit chat view component (FoodChat in edit mode)

**Priority:** Medium | **Labels:** Feature

Add edit mode to `FoodChat` via mode prop. Differences from analyze mode: context header (food name + date), "Save Changes" button, no photo upload, pre-populated TimeSelector + MealTypeSelector from original entry.

**Acceptance Criteria:**
- [ ] Mode prop: `"analyze" | "edit"` (default "analyze")
- [ ] `editEntry: FoodLogEntryDetail` prop (required when mode = "edit")
- [ ] Context header with food name and date in edit mode
- [ ] "Save Changes" button calls `POST /api/edit-food` (replaces "Log to Fitbit")
- [ ] No photo upload controls in edit mode
- [ ] Pre-populated TimeSelector and MealTypeSelector from original entry
- [ ] Claude auto-updates to time/mealType via `report_nutrition` reflected in pickers
- [ ] Post-save: navigate back, invalidate SWR caches

### FOO-719: Edit button on history list entries

**Priority:** Medium | **Labels:** Feature

Add pencil/edit icon button alongside delete on food-history entry cards. Navigates to edit chat view.

**Acceptance Criteria:**
- [ ] Pencil icon (lucide `Pencil`) next to trash icon on each entry card
- [ ] 44px touch target
- [ ] Navigates to edit view with entry ID (e.g., `/app/edit/[id]`)
- [ ] Edit view fetches `FoodLogEntryDetail` from existing `GET /api/food-history/[id]`

## Prerequisites

- [ ] Working development environment (`npm run dev`)
- [ ] PostgreSQL running with latest migrations
- [ ] Fitbit credentials configured (for integration testing)

## Implementation Tasks

### Task 1: Schema changes — isFavorite and shareToken columns

**Issues:** FOO-703, FOO-707
**Files:**
- `src/db/schema.ts` (modify)
- `src/types/index.ts` (modify)
- `drizzle/` (generated migration — lead only via `npx drizzle-kit generate`)
- `package.json` (add `nanoid` dependency)

**TDD Steps:**

1. **RED** — Add test asserting `CommonFood` includes `isFavorite` boolean field. TypeScript compilation should fail since the field doesn't exist yet.
   - Run: `npm test -- food-log`

2. **GREEN** — Update schema and types:
   - Add `isFavorite` boolean column to `customFoods` table in schema — default false, NOT NULL
   - Add `shareToken` text column to `customFoods` — nullable, no default
   - Add unique index on `shareToken` (where not null)
   - Update `CommonFood` interface to include `isFavorite: boolean`
   - Install `nanoid` package
   - Run `npx drizzle-kit generate` to produce the migration
   - Run: `npm test -- food-log`

3. **REFACTOR** — Verify migration SQL looks correct

**Notes:**
- Both columns on same table → one migration
- `isFavorite` default false → no backfill needed, safe for existing rows
- `shareToken` nullable → no backfill needed
- **Migration note:** New columns with safe defaults/nullable — no production data migration needed
- Reference: existing column definitions in `src/db/schema.ts`

---

### Task 2: Toggle favorite API endpoint

**Issues:** FOO-704
**Depends on:** Task 1
**Files:**
- `src/lib/food-log.ts` (modify — add `toggleFavorite`)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/custom-foods/[id]/favorite/route.ts` (create)

**TDD Steps:**

1. **RED** — Write tests for `toggleFavorite(userId, customFoodId)`:
   - Flips false → true, returns `{isFavorite: true}`
   - Flips true → false, returns `{isFavorite: false}`
   - Returns null for non-existent ID
   - Returns null for other user's food
   - Run: `npm test -- food-log`

2. **GREEN** — Implement `toggleFavorite` in food-log.ts:
   - UPDATE `custom_foods` SET `is_favorite = NOT is_favorite` WHERE `id = ? AND user_id = ?`, RETURNING `is_favorite`
   - Return `{isFavorite}` or null if no row updated

3. **RED** — Write route handler tests:
   - PATCH returns 200 with `{isFavorite: true/false}`
   - PATCH with invalid ID returns 404
   - PATCH without auth returns 401

4. **GREEN** — Implement PATCH handler:
   - Session auth: `getSession()` + `validateSession()`
   - Parse ID from dynamic route params
   - Call `toggleFavorite`, return standardized API response
   - Set `Cache-Control: private, no-cache`
   - Reference pattern: `src/app/api/food-history/[id]/route.ts`

---

### Task 3: Star UI on quick-select cards and food detail

**Issues:** FOO-705
**Depends on:** Task 2
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/food-detail.tsx` (modify)

**TDD Steps:**

1. **RED** — Write quick-select tests:
   - Card renders filled star icon when `isFavorite` is true
   - Card does NOT render star when `isFavorite` is false
   - Star tap calls PATCH `/api/custom-foods/[id]/favorite`
   - Star tap does NOT trigger card selection (stopPropagation)
   - Run: `npm test -- quick-select`

2. **GREEN** — Add star to quick-select cards:
   - Lucide `Star` icon with `fill="currentColor"` on favorites only
   - Separate button with `onClick` + `stopPropagation` preventing card selection
   - Optimistic SWR update: mutate cache immediately, revalidate on response, revert on failure
   - 44px touch target

3. **RED** — Write food-detail tests:
   - Always renders star icon (filled when favorite, outline when not)
   - Tap toggles favorite state
   - Run: `npm test -- food-detail`

4. **GREEN** — Add toggleable star to food-detail:
   - Lucide `Star` icon next to food name (filled = `fill="currentColor"`, outline = no fill)
   - Toggle calls PATCH API, optimistic update, SWR cache invalidation for quick-select data
   - Reference: icon button pattern from food-history delete button

---

### Task 4: Pin favorites at top of Suggested tab

**Issues:** FOO-706
**Depends on:** Task 1
**Files:**
- `src/lib/food-log.ts` (modify — `getCommonFoods`)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/app/api/common-foods/route.ts` (modify)

**TDD Steps:**

1. **RED** — Write tests for `getCommonFoods` with favorites:
   - Favorites appear before non-favorites in results
   - Favorites sorted by most recently logged
   - Non-favorites section excludes already-shown favorites
   - No favorites → results identical to current behavior
   - Run: `npm test -- food-log`

2. **GREEN** — Update `getCommonFoods`:
   - After scoring, partition into favorites and non-favorites
   - Favorites: sort by most recently logged (recency sort)
   - Non-favorites: existing Gaussian-scored order, excluding favorites
   - Ensure `isFavorite` is in the SELECT for `CommonFood` response
   - Favorites only prepended on page 1; subsequent pages are normal scored results

3. **RED** — Write UI tests for favorites section header:
   - "Favorites" divider/header appears when favorites present
   - No header when no favorites
   - Run: `npm test -- quick-select`

4. **GREEN** — Update Suggested tab in quick-select:
   - Subtle section header "Favorites" above favorites group (page 1 only)
   - No visual change when user has zero favorites

**Notes:**
- Only affects Suggested tab — Recent tab and search results unchanged
- Reference: `getCommonFoods()` Gaussian time kernel + recency decay in `src/lib/food-log.ts`
- Pagination cursor may need adjustment for page 1 prepend

---

### Task 5: TimeSelector component

**Issues:** FOO-712
**Files:**
- `src/components/time-selector.tsx` (create)
- `src/components/__tests__/time-selector.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write component tests:
   - Renders "Now" button/chip by default
   - Tapping "Now" opens time picker input
   - Selecting a time calls `onChange` with HH:mm string
   - Switching back to "Now" calls `onChange` with `null`
   - Displays passed value correctly in 24h format
   - Run: `npm test -- time-selector`

2. **GREEN** — Create `TimeSelector` component:
   - Controlled interface: `{ value: string | null; onChange: (time: string | null) => void }`
   - Default "Now" state as chip/button (shows current time as reference text)
   - Tap → reveals native `<input type="time">` (best mobile UX)
   - "Now" option to reset back to null
   - Use `formatTimeFromDate()` from `src/lib/date-utils.ts` for display
   - 24h format, 44px touch targets

3. **REFACTOR** — Match visual style with `MealTypeSelector`

**Notes:**
- Pattern reference: `src/components/meal-type-selector.tsx`
- `null` = "now" — caller resolves at log time via `getLocalDateTime()`
- Must work well on mobile — `<input type="time">` triggers native time picker on iOS/Android

---

### Task 6: TimeSelector integration in chat and analyze screen

**Issues:** FOO-713, FOO-714
**Depends on:** Task 5
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **RED** — Write food-chat test:
   - TimeSelector appears in header when `latestAnalysis` exists
   - Time value passed to log-food API call in `handleLog()`
   - Default value is `null` (Now)
   - Run: `npm test -- food-chat`

2. **GREEN** — Add TimeSelector to food-chat header:
   - New `selectedTime` state (default `null`)
   - Second row below `[← Back] [MealType ▼] [Log to Fitbit]`, visible when `latestAnalysis` exists
   - Container already has `space-y-2` for stacking
   - In `handleLog()`: if `selectedTime` is null, use `getLocalDateTime().time`; else use `selectedTime`
   - Reference: lines 544-577 in food-chat.tsx for the header area, lines 439-461 for `handleLog`

3. **RED** — Write food-analyzer test:
   - TimeSelector appears alongside MealTypeSelector in analyze results
   - Time value passed to log-food API call
   - Run: `npm test -- food-analyzer`

4. **GREEN** — Add TimeSelector to food-analyzer:
   - New `selectedTime` state (default `null`)
   - Place below MealTypeSelector in logging controls area
   - Wire into log-food call same as chat

**Notes:**
- Both screens currently call `getLocalDateTime()` for time — TimeSelector overrides when non-null
- Reference: how `MealTypeSelector` is already wired in both components

---

### Task 7: Add time and mealType fields to report_nutrition tool

**Issues:** FOO-715
**Files:**
- `src/lib/claude.ts` (modify — tool schema, system prompts, `validateFoodAnalysis`)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/types/index.ts` (modify — `FoodAnalysis`)
- `src/components/food-chat.tsx` (modify — SSE handler)

**TDD Steps:**

1. **RED** — Write validation tests:
   - `validateFoodAnalysis` accepts `time` as valid HH:mm string (e.g., "08:30")
   - Accepts `meal_type_id` as integer 1–7
   - Accepts `null` for both fields
   - Rejects invalid time format (e.g., "25:00", "abc")
   - Rejects `meal_type_id` outside 1–7
   - Omitted fields → `undefined` (backwards compatible)
   - Run: `npm test -- claude`

2. **GREEN** — Update tool schema and validation:
   - Add `time` to `REPORT_NUTRITION_TOOL.input_schema.properties`: `{ type: ["string", "null"], description: "Meal time in HH:mm format. Only set when user explicitly mentions time." }`
   - Add `meal_type_id`: `{ type: ["number", "null"], description: "Fitbit meal type 1-7. Only set when user mentions meal context." }`
   - Do NOT add to `required` array (optional fields)
   - Update `FoodAnalysis` in types: add `time?: string | null` and `mealTypeId?: number | null`
   - Update `validateFoodAnalysis()`: validate HH:mm regex, validate meal_type_id range
   - Update `CHAT_SYSTEM_PROMPT` to instruct Claude when to set these fields

3. **RED** — Write food-chat SSE auto-update test:
   - When analysis event includes `time`, `selectedTime` state updates
   - When analysis event includes `mealTypeId`, `selectedMealType` state updates
   - Manual picker changes still work after auto-update
   - Run: `npm test -- food-chat`

4. **GREEN** — Wire auto-update in food-chat SSE handler:
   - In the `analysis` event handler, check for `analysis.time` and `analysis.mealTypeId`
   - If present, update `selectedTime` / `selectedMealType` state
   - Pickers remain editable — Claude values are suggestions, not locks

**Notes:**
- Both fields optional — Claude only sets them on explicit user mention
- `time` uses HH:mm to match `TimeSelector` interface
- `meal_type_id` maps to `FitbitMealType` enum (1=Breakfast through 7=Anytime)
- This task modifies food-chat.tsx — coordinate with Task 6 (also modifies food-chat header area)

---

### Task 8: Share API endpoint

**Issues:** FOO-708
**Depends on:** Task 1
**Files:**
- `src/lib/food-log.ts` (modify — add `setShareToken`, `getCustomFoodByShareToken`)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/share/route.ts` (create)

**TDD Steps:**

1. **RED** — Write DB function tests:
   - `setShareToken(userId, customFoodId)` generates and returns token for food without one
   - Returns existing token for food that already has one (idempotent)
   - Returns null for non-existent food
   - Returns null for other user's food
   - `getCustomFoodByShareToken(shareToken)` finds food regardless of owner (cross-user)
   - Returns null for invalid token
   - Run: `npm test -- food-log`

2. **GREEN** — Implement DB functions:
   - `setShareToken`: check existing → if none, generate `nanoid(12)` and UPDATE → return token
   - `getCustomFoodByShareToken`: SELECT from `custom_foods` WHERE `share_token = ?` — NO `userId` filter (intentional cross-user read)
   - Returns full nutrition data needed for the shared food page

3. **RED** — Write route handler tests:
   - POST returns `{shareUrl, shareToken}` for valid `customFoodId`
   - POST with invalid ID returns 404
   - POST without auth returns 401

4. **GREEN** — Implement `POST /api/share`:
   - Session auth, parse `customFoodId` from body
   - Call `setShareToken`, construct full URL from request host
   - Return `{shareUrl: "https://{host}/app/log-shared/{token}", shareToken}`
   - Reference: `src/app/api/log-food/route.ts` for handler pattern

**Notes:**
- `nanoid(12)` = 72 bits entropy, URL-friendly
- Cross-user read is intentional — first cross-user data access in the app
- Same food always produces same share link (idempotent token)

---

### Task 9: Share button on food detail

**Issues:** FOO-710
**Depends on:** Task 8
**Files:**
- `src/components/food-detail.tsx` (modify)

**TDD Steps:**

1. **RED** — Write component tests:
   - Share icon renders next to food title
   - Tap calls `POST /api/share` with correct `customFoodId`
   - Shows share URL after successful API call
   - Run: `npm test -- food-detail`

2. **GREEN** — Add share button:
   - Lucide `Share2` icon, right-justified on food title line (flexbox: title left, share right)
   - On tap: call `POST /api/share`, then `navigator.share({ url, title: foodName })` if available
   - Fallback: `navigator.clipboard.writeText(url)` + toast confirmation
   - Silently handle `AbortError` from share sheet cancellation (not an error)
   - Brief loading state while API generates token
   - 44px touch target

**Notes:**
- food-detail.tsx also modified by Task 3 (star icon) — star goes near title left, share icon right-justified. No conflict.
- Reference: FOO-710 for layout details

---

### Task 10: Log-shared page

**Issues:** FOO-709
**Depends on:** Task 8
**Files:**
- `src/app/api/shared-food/[token]/route.ts` (create — GET endpoint)
- `src/app/app/log-shared/[token]/page.tsx` (create)
- `src/app/app/log-shared/[token]/loading.tsx` (create)

**TDD Steps:**

1. **RED** — Write GET API tests:
   - Returns food nutrition data for valid token
   - Returns 404 for invalid token
   - Requires auth (401 without session)
   - Run: `npm test -- shared-food`

2. **GREEN** — Implement `GET /api/shared-food/[token]`:
   - Session auth (user must be logged in, but food belongs to any user)
   - Call `getCustomFoodByShareToken(token)`
   - Return nutrition data matching `NutritionFactsCard` props
   - Reference: `GET /api/food-history/[id]` for detail endpoint pattern

3. **GREEN** — Create log-shared page:
   - Client component fetches via `useSWR` on `/api/shared-food/[token]`
   - Shows: food name, `NutritionFactsCard`, `MealTypeSelector`, "Log to Fitbit" button
   - Log action: call `POST /api/log-food` with full nutrition data (creates new `custom_food` for current user — NOT a reuse, since the shared food belongs to another user)
   - On success: show `FoodLogConfirmation`
   - Create `loading.tsx` with skeleton matching layout

4. **REFACTOR** — Error states match app patterns (404, loading, retry)

**Notes:**
- Logged food creates a NEW `custom_food` owned by the current user — never references sharer's row
- Similar to quick-select confirmation screen flow
- Reference: `src/app/app/food-detail/[id]/page.tsx` for dynamic route pattern

---

### Task 11: Preserve return URL through OAuth login flow

**Issues:** FOO-711
**Files:**
- `middleware.ts` (modify)
- `src/app/api/auth/google/route.ts` (modify)
- `src/app/api/auth/google/callback/route.ts` (modify)

**TDD Steps:**

1. **RED** — Write middleware test:
   - Unauthenticated request to `/app/log-shared/abc` redirects with `?returnTo=/app/log-shared/abc`
   - Unauthenticated request to `/app` redirects without `returnTo` (default destination)
   - Run: `npm test -- middleware`

2. **GREEN** — Update middleware:
   - When redirecting unauthenticated user from protected route to `/`, include `?returnTo={originalPath}` if path is not `/app`

3. **RED** — Write OAuth flow tests:
   - `POST /api/auth/google` reads `returnTo` and includes in OAuth state
   - Callback extracts `returnTo` from state and redirects there
   - Callback validates `returnTo` starts with `/` (relative path only)
   - Callback rejects absolute URLs / external domains
   - Run: `npm test -- auth`

4. **GREEN** — Update OAuth flow:
   - In `POST /api/auth/google`: read `returnTo` from request, include in OAuth `state` parameter (JSON-encode alongside existing state data like CSRF)
   - In `GET /api/auth/google/callback`: extract `returnTo` from state, validate it's a relative path starting with `/`, redirect there. If invalid/missing, fall back to `/app`.
   - Landing page must forward `returnTo` query param to OAuth initiation

**Notes:**
- **Security:** Open redirect prevention is critical — only allow paths starting with `/`, reject any absolute URLs or `//`-prefixed paths
- Reference: existing OAuth state parameter usage in Google auth routes

---

### Task 12: editAnalysis() function and edit-chat API route

**Issues:** FOO-716
**Depends on:** Task 7 (report_nutrition tool has time/mealType fields)
**Files:**
- `src/lib/claude.ts` (modify — add `editAnalysis`, `EDIT_SYSTEM_PROMPT`)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/app/api/edit-chat/route.ts` (create)

**TDD Steps:**

1. **RED** — Write `editAnalysis` generator tests:
   - Yields initial assistant message summarizing existing entry
   - Processes user correction and yields updated analysis via report_nutrition
   - Uses same report_nutrition tool (with time/mealType fields from Task 7)
   - Run: `npm test -- claude`

2. **GREEN** — Implement `editAnalysis`:
   - New `EDIT_SYSTEM_PROMPT` extending base prompt with edit-specific instructions: understand original entry context, process corrections (portion changes, additions, removals), show deltas (what changed + new totals), handle cumulative corrections
   - `editAnalysis(params)` async generator — takes `FoodLogEntryDetail`, conversation messages, `clientDate`
   - Inject original entry data as context (food name, nutrition, description, notes)
   - Claude's first assistant message summarizes existing entry
   - Reuse `runToolLoop()` for multi-turn processing (same as `conversationalRefine`)
   - Text-only: no image handling needed
   - Same SSE event types: `text_delta`, `analysis`, `tool_start`, `usage`, `done`
   - Reference: `conversationalRefine()` in claude.ts for generator pattern

3. **RED** — Write edit-chat route tests:
   - POST with `editEntryId` + messages returns SSE stream
   - Requires auth, validates entry ownership
   - 404 for invalid entry ID

4. **GREEN** — Implement `POST /api/edit-chat`:
   - Session auth, validate request body (entry ID + messages)
   - Fetch `FoodLogEntryDetail` for the entry (verify user ownership)
   - Call `editAnalysis()` with entry context + messages
   - Stream SSE events back to client
   - Reference: `src/app/api/chat-food/route.ts` for SSE streaming pattern

**Notes:**
- Consider whether extending `POST /api/chat-food` with an `editEntryId` param is cleaner than a new route — evaluate at implementation time
- No photo/image support in edit mode

---

### Task 13: Edit food API endpoint

**Issues:** FOO-717
**Files:**
- `src/lib/food-log.ts` (modify — add `updateFoodLogEntry`, extract orphan cleanup)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/edit-food/route.ts` (create)

**TDD Steps:**

1. **RED** — Write DB operation tests:
   - `updateFoodLogEntry` creates new custom_food and updates entry's `customFoodId`
   - Updates `time`/`mealTypeId` when provided
   - Orphan cleanup deletes old custom_food when no entries reference it
   - Orphan cleanup preserves old custom_food when other entries still reference it
   - Run: `npm test -- food-log`

2. **GREEN** — Implement DB operations:
   - Extract orphan cleanup logic from `deleteFoodLogEntry()` into shared `cleanupOrphanCustomFood(customFoodId)` function (reuse in both delete and edit flows)
   - `updateFoodLogEntry(userId, entryId, data)`: in a transaction — insert new custom_food → update food_log_entry → cleanup orphan

3. **RED** — Write route handler tests:
   - POST replaces entry (new custom_food + Fitbit relog + entry update)
   - Handles dry-run mode (skips Fitbit operations)
   - Handles entries without `fitbitLogId` (skips Fitbit delete, still creates new Fitbit food)
   - Compensation: if new Fitbit log fails, no DB changes made
   - Requires auth with Fitbit connected

4. **GREEN** — Implement `POST /api/edit-food`:
   - Session auth with `requireFitbit`
   - Validate: `foodLogEntryId`, `FoodAnalysis` fields, optional `time`/`mealTypeId`
   - Orchestration sequence:
     1. Look up existing entry → get `fitbitLogId`, `customFoodId`
     2. If not dry-run and has `fitbitLogId`: delete old Fitbit log
     3. Create new `custom_food` via `insertCustomFood`
     4. If not dry-run: `findOrCreateFood` on Fitbit + `logFood` at original date
     5. Update `food_log_entry`: new customFoodId, new fitbitLogId, updated time/mealTypeId
     6. Orphan-clean old custom_food
   - Compensation: if step 4 fails after step 2 succeeded → attempt re-log of original. If step 5 fails after step 4 → delete new Fitbit log
   - Reference: `src/app/api/log-food/route.ts` for Fitbit interaction + compensation pattern
   - Reference: `DELETE /api/food-history/[id]` for orphan cleanup

**Notes:**
- Custom food immutability is critical: a `custom_food` may be referenced by multiple `food_log_entries` (via quick-select reuse). Never mutate — always create new.
- The compensation logic is the most complex part — test thoroughly

---

### Task 14: Edit chat view and history edit button

**Issues:** FOO-718, FOO-719
**Depends on:** Tasks 5 (TimeSelector), 12 (editAnalysis), 13 (edit-food API)
**Files:**
- `src/components/food-chat.tsx` (modify — add edit mode)
- `src/components/food-history.tsx` (modify — add edit button)
- `src/app/app/edit/[id]/page.tsx` (create)
- `src/app/app/edit/[id]/loading.tsx` (create)

**TDD Steps:**

1. **RED** — Write FoodChat edit mode tests:
   - Renders context header with food name and date in edit mode
   - Shows "Save Changes" button instead of "Log to Fitbit"
   - No photo upload controls in edit mode
   - Pre-populates TimeSelector and MealTypeSelector from `editEntry` data
   - Save calls `POST /api/edit-food` with correct data
   - Run: `npm test -- food-chat`

2. **GREEN** — Add edit mode to FoodChat:
   - New props: `mode: "analyze" | "edit"` (default "analyze"), `editEntry?: FoodLogEntryDetail`
   - Conditional rendering based on mode:
     - Edit: context header (food name + date), "Save Changes" button, hidden photo inputs, pre-populated pickers
     - Analyze: existing behavior unchanged
   - Save handler: call `POST /api/edit-food` with entry ID + latest analysis + current mealTypeId/time
   - Chat API: POST to `/api/edit-chat` instead of `/api/chat-food` when in edit mode
   - Post-save: `router.back()`, invalidate SWR caches

3. **RED** — Write food-history edit button tests:
   - Each entry card shows pencil/edit icon
   - Tap navigates to edit route
   - Run: `npm test -- food-history`

4. **GREEN** — Add edit button to history:
   - Lucide `Pencil` icon alongside existing trash icon in entry card action area
   - 44px touch target
   - On tap: navigate to `/app/edit/[entryId]`

5. **GREEN** — Create edit page route:
   - `/app/edit/[id]` — fetch `FoodLogEntryDetail` via `useSWR`, render `FoodChat` in edit mode
   - `loading.tsx` with skeleton
   - Error handling for invalid/not-found entries
   - Back navigation on cancel or post-save

**Notes:**
- food-chat.tsx is the most heavily modified file (Tasks 6, 7, 14) — changes are in different areas: Task 6 (TimeSelector in header), Task 7 (SSE auto-update), Task 14 (mode prop + conditional rendering)
- Reference: `src/app/app/food-detail/[id]/page.tsx` for dynamic route pattern
- Post-save: `router.back()` returns to history (same as food-detail back button)

---

### Task 15: Integration and verification

**Issues:** All
**Depends on:** All previous tasks
**Files:** Various

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Star a food from food detail, verify it appears pinned in Suggested tab
   - [ ] Unstar from quick-select card, verify it moves back to scored position
   - [ ] Share a food, open URL in incognito, log in, verify shared food page loads
   - [ ] Log shared food, verify new custom_food created for current user
   - [ ] Select a non-Now time, log food, verify Fitbit entry has correct timestamp
   - [ ] In chat, say "I had this for breakfast at 8am", verify TimeSelector and MealTypeSelector auto-update
   - [ ] From history, tap edit on an entry, make a correction ("I only ate half"), save, verify Fitbit entry replaced
   - [ ] Verify edit preserves original date, updates time/mealType if changed
   - [ ] Test OAuth return URL: open share link while logged out, complete login, land on share page

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `save_issue` | Move issues to "In Progress" at start, "Done" on completion |
| Linear | `create_comment` | Add progress notes if needed |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Toggle favorite on non-existent food | 404 response | Unit test |
| Share non-existent food | 404 response | Unit test |
| Invalid share token | 404 page with helpful message | Unit test + UI |
| Edit food with expired Fitbit token | Token refresh via `ensureFreshToken`, retry | Integration test |
| Fitbit re-log fails during edit | Compensation: attempt re-log of original | Unit test |
| DB update fails after Fitbit edit | Compensation: delete new Fitbit log | Unit test |
| Invalid returnTo URL (external domain) | Fall back to /app | Unit test |
| Time format validation failure | Rejected by `validateFoodAnalysis` | Unit test |
| Share sheet canceled by user | Silently handle `AbortError` | Component test |
| Edit entry with no fitbitLogId (dry-run) | Skip Fitbit ops, update DB only | Unit test |

## Risks & Open Questions

- [ ] **Pagination with favorites:** Prepending favorites to page 1 of Suggested tab may cause edge cases with cursor-based pagination if a food is favorited/unfavorited between page loads. The cursor is composite `{lastDate, lastTime, lastId}` — favorites on page 1 may shift cursor boundaries.
- [ ] **Edit compensation complexity:** The delete-then-relog pattern has a failure window. If old Fitbit entry is deleted but new creation fails, the entry exists in DB but not on Fitbit. Compensation should attempt to re-log original data.
- [ ] **Cross-user share security:** Log-shared page introduces first cross-user data read. Ensure only nutrition data is exposed via share_token — no user identity, email, or private metadata. The `getCustomFoodByShareToken` function should return only nutrition-relevant fields.
- [ ] **OAuth state parameter size:** Adding `returnTo` to OAuth state increases its size. Google OAuth state param has no strict limit but keep it reasonable. Long return URLs are unlikely in practice.
- [ ] **food-chat.tsx complexity:** Modified by Tasks 6, 7, and 14. These touch different areas (header, SSE handler, mode logic) but merge conflicts are possible if implemented by separate workers. Sequence carefully or assign to same worker.

## Scope Boundaries

**In Scope:**
- Favorite foods: schema, API, UI, pinning logic in Suggested tab
- Share food log: schema, API, share page, share button, OAuth return URL preservation
- Time selector: component, integration in chat + analyze, report_nutrition tool update
- Food editing: editAnalysis backend, edit-food API, edit chat UI, history edit button

**Out of Scope:**
- Push notifications for shared foods
- Sharing via other channels (email, social media, QR code)
- Multi-food or batch editing
- Time selector for quick-select (continues using current time)
- Editing food photos (edit is text-only)
- Sharing entire meals or daily logs (individual foods only)
- Share link expiration or revocation
- Multi-user admin panel or user management

---

## Iteration 1

**Implemented:** 2026-02-28
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add isFavorite and shareToken columns (FOO-703, FOO-707) — lead-reserved for drizzle-kit generate
- Task 2: Toggle favorite API endpoint (FOO-704) — worker-1
- Task 3: Star UI on quick select cards and food detail (FOO-705) — worker-1
- Task 4: Pin favorites at top of Suggested tab (FOO-706) — worker-1
- Task 5: Time selector component (FOO-712) — worker-2
- Task 6: Time selector integration in chat + analyze (FOO-713, FOO-714) — worker-2
- Task 7: report_nutrition tool update for time/mealType (FOO-715) — worker-2
- Task 8: Share API endpoint (FOO-708) — worker-3
- Task 9: Log-shared page (FOO-709) — worker-3
- Task 10: Share button on food detail (FOO-710) — worker-3
- Task 11: OAuth return URL preservation (FOO-711) — worker-3
- Task 12: editAnalysis() and edit-chat API route (FOO-716) — worker-4
- Task 13: edit-food API route (FOO-717) — worker-4
- Task 14: Edit chat UI and history edit button (FOO-718, FOO-719) — worker-4

### Files Modified
- `src/db/schema.ts` — Added isFavorite boolean and shareToken text columns
- `drizzle/0014_tan_jasper_sitwell.sql` — Generated migration
- `src/types/index.ts` — Added customFoodId/isFavorite to FoodLogEntryDetail, time/mealTypeId to FoodAnalysis
- `src/lib/food-log.ts` — toggleFavorite, setShareToken (atomic), favorites pinning, updateFoodLogEntry, cleanupOrphanCustomFood
- `src/lib/claude.ts` — editAnalysis streaming generator, time/mealTypeId in report_nutrition tool
- `src/components/time-selector.tsx` — New TimeSelector component with Now/custom time modes
- `src/components/food-detail.tsx` — Star favorite toggle + share button
- `src/components/food-chat.tsx` — Edit mode support, TimeSelector integration, SSE auto-update for time/mealType
- `src/components/food-history.tsx` — Edit button on history entries
- `src/components/quick-select.tsx` — Star icons on cards, favorites section header
- `src/components/food-analyzer.tsx` — TimeSelector in analyze header
- `src/components/edit-food.tsx` — New edit food wrapper component
- `src/app/api/custom-foods/[id]/favorite/route.ts` — PATCH toggle favorite
- `src/app/api/share/route.ts` — POST generate share token
- `src/app/api/shared-food/[token]/route.ts` — GET shared food data
- `src/app/api/edit-chat/route.ts` — POST edit analysis SSE stream
- `src/app/api/edit-food/route.ts` — POST save edited food
- `src/app/app/log-shared/[token]/` — Page + loading + content component
- `src/app/app/edit/[id]/` — Page + loading
- `src/app/api/auth/google/route.ts` — returnTo query param in OAuth state
- `src/app/api/auth/google/callback/route.ts` — returnTo extraction from OAuth state
- `middleware.ts` — /app/log-shared public route allowlist
- `src/app/page.tsx` — Share feature mention in landing page

### Linear Updates
- FOO-703 through FOO-719: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 7 bugs (3 HIGH, 4 MEDIUM), all fixed before commit
  - Favorites pagination cursor (fixed: separate favorites from paginated non-favorites)
  - Share token race condition (fixed: atomic UPDATE WHERE share_token IS NULL)
  - Edit mode time fallback (fixed: preserve original entry time)
  - Share route integer validation (fixed: Number.isInteger check)
  - Log-shared error handling (fixed: added error state and user feedback)
  - returnTo lost in Fitbit setup flow (noted for follow-up, edge case)
  - Stale time display in TimeSelector (accepted as cosmetic)
- verifier: All 2327 tests pass, zero warnings, build clean

### Work Partition
- Lead: Task 1 (schema + migration — drizzle-kit generate)
- Worker 1: Tasks 2, 3, 4 (favorites domain — API, UI, pinning)
- Worker 2: Tasks 5, 6, 7 (time/Claude domain — component, integration, tool schema)
- Worker 3: Tasks 8, 9, 10, 11 (share domain — API, page, button, OAuth)
- Worker 4: Tasks 12, 13, 14 (edit domain — analysis, save API, chat UI)

### Merge Summary
- Worker 1: fast-forward (first merge after lead's foundation)
- Worker 2: auto-merge, 1 conflict in types/index.ts (resolved)
- Worker 3: 3 conflicts in food-log.ts, food-detail.tsx, food-detail.test.tsx (resolved — combined star + share features)
- Worker 4: 3 conflicts in time-selector.tsx (add/add), food-chat.tsx (edit mode + time selector), food-chat.test.tsx (mocks — resolved)

### Continuation Status
All tasks completed.

### Review Findings

Summary: 8 issue(s) found across 3 domains (Team: security, reliability, quality reviewers)
- FIX: 5 issue(s) — Linear issues created in Todo
- DISCARDED: 3 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [HIGH] BUG: `updateFoodLogEntry()` creates new custom_food without copying `fitbitFoodId`, `isFavorite`, `shareToken` from old record — food disappears from Quick Select, favorite status lost, shared links break (`src/lib/food-log.ts:624-646`) — [FOO-720](https://linear.app/lw-claude/issue/FOO-720)
- [MEDIUM] BUG: Pagination cursor null when favorites fill all slots — non-favorites permanently inaccessible when user has ≥10 favorites (`src/lib/food-log.ts:331-344`) — [FOO-721](https://linear.app/lw-claude/issue/FOO-721)
- [MEDIUM] ERROR: `handleShare` silently swallows API errors and clipboard exceptions — no user feedback on failure (`src/components/food-detail.tsx:55-80`) — [FOO-722](https://linear.app/lw-claude/issue/FOO-722)
- [MEDIUM] SECURITY: Share token logged in API routes violating CLAUDE.md "never log access tokens" policy (`src/app/api/share/route.ts:37`, `src/app/api/shared-food/[token]/route.ts:20,24`) — [FOO-723](https://linear.app/lw-claude/issue/FOO-723)
- [MEDIUM] BUG: UTC date used instead of local date in log-shared page — wrong date for users near midnight in non-UTC timezones (`src/app/app/log-shared/[token]/log-shared-content.tsx:101`) — [FOO-724](https://linear.app/lw-claude/issue/FOO-724)

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Missing userId guard on UPDATE in `updateFoodLogEntry` transaction — not exploitable; preceding SELECT within same `db.transaction()` already verifies ownership. Code is correct.
- [DISCARDED] TYPE: Double cast `as unknown as FoodAnalysis` in `edit-food/route.ts:109` — defensible pattern; `isValidFoodAnalysis()` runtime validation occurs immediately before the cast.
- [DISCARDED] TYPE: Confidence type assertion in `log-shared-content.tsx:122` — DB only stores valid confidence values from validated Claude analysis. Invalid values impossible in practice.

### Linear Updates
- FOO-703 through FOO-719: Review → Merge (original tasks completed)
- FOO-720: Created in Todo (Fix: updateFoodLogEntry loses metadata)
- FOO-721: Created in Todo (Fix: pagination when favorites ≥ limit)
- FOO-722: Created in Todo (Fix: handleShare error swallowing)
- FOO-723: Created in Todo (Fix: share token logging)
- FOO-724: Created in Todo (Fix: UTC date in log-shared)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-720](https://linear.app/lw-claude/issue/FOO-720), [FOO-721](https://linear.app/lw-claude/issue/FOO-721), [FOO-722](https://linear.app/lw-claude/issue/FOO-722), [FOO-723](https://linear.app/lw-claude/issue/FOO-723), [FOO-724](https://linear.app/lw-claude/issue/FOO-724)

### Fix 1: updateFoodLogEntry loses fitbitFoodId, isFavorite, shareToken
**Linear Issue:** [FOO-720](https://linear.app/lw-claude/issue/FOO-720)

1. Write test in `src/lib/__tests__/food-log.test.ts` verifying that after `updateFoodLogEntry`, the new custom food preserves `fitbitFoodId`, `isFavorite`, and `shareToken` from the old record
2. In `updateFoodLogEntry()` (`src/lib/food-log.ts:610-670`), fetch the old custom food's `fitbitFoodId`, `isFavorite`, `shareToken` before creating the new row
3. Include those values in the `.insert(customFoods).values({...})` call at line 624

### Fix 2: Pagination inaccessible when favorites fill all slots
**Linear Issue:** [FOO-721](https://linear.app/lw-claude/issue/FOO-721)

1. Write test in `src/lib/__tests__/food-log.test.ts` for `getCommonFoods` when `favorites.length >= limit` — verify `nextCursor` is non-null when non-favorites exist
2. In `getCommonFoods()` (`src/lib/food-log.ts:331-344`), when `remainingSlots === 0` and `hasMore`, use the first non-favorite as the cursor anchor instead of returning `null`

### Fix 3: handleShare silent error swallowing
**Linear Issue:** [FOO-722](https://linear.app/lw-claude/issue/FOO-722)

1. Write test in `src/components/__tests__/food-detail.test.tsx` for share API failure — verify error feedback is shown
2. In `handleShare()` (`src/components/food-detail.tsx:55-80`): add error state + user feedback for `!response.ok`, wrap clipboard in try/catch with fallback

### Fix 4: Share token logged in API routes
**Linear Issue:** [FOO-723](https://linear.app/lw-claude/issue/FOO-723)

1. Write test in `src/app/api/share/__tests__/route.test.ts` verifying log output does NOT contain the token value
2. Remove `token` from log objects in `src/app/api/share/route.ts:37` and `src/app/api/shared-food/[token]/route.ts:20,24`

### Fix 5: UTC date in log-shared page
**Linear Issue:** [FOO-724](https://linear.app/lw-claude/issue/FOO-724)

1. Write test in `src/app/app/log-shared/[token]/__tests__/log-shared-content.test.tsx` verifying local date is used
2. In `log-shared-content.tsx:100-102`, replace `new Date().toISOString().slice(0, 10)` with `getLocalDateTime()` from `@/lib/meal-type`

---

## Iteration 2

**Implemented:** 2026-02-28
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Fix 1: updateFoodLogEntry preserves fitbitFoodId, isFavorite, shareToken from old custom food (FOO-720)
- Fix 2: Pagination cursor non-null when favorites fill all slots (FOO-721)
- Fix 3: handleShare shows error feedback on API failure and clipboard errors (FOO-722)
- Fix 4: Share token removed from all API route log objects (FOO-723)
- Fix 5: log-shared page uses getLocalDateTime() instead of UTC date (FOO-724)

### Files Modified
- `src/lib/food-log.ts` — Fetch old custom food metadata before insert in updateFoodLogEntry; fix pagination cursor when favorites fill all slots
- `src/lib/__tests__/food-log.test.ts` — Tests for metadata preservation and pagination fix
- `src/components/food-detail.tsx` — Share error state, error feedback for API/clipboard/navigator.share failures
- `src/components/__tests__/food-detail.test.tsx` — Tests for share error scenarios
- `src/app/api/share/route.ts` — Remove token from log objects
- `src/app/api/share/__tests__/route.test.ts` — Test verifying token not logged
- `src/app/api/shared-food/[token]/route.ts` — Remove token from log objects
- `src/app/api/shared-food/[token]/__tests__/route.test.ts` — Test verifying token not logged
- `src/app/app/log-shared/[token]/log-shared-content.tsx` — Use getLocalDateTime() instead of toISOString()
- `src/app/app/log-shared/[token]/__tests__/log-shared-content.test.tsx` — New test file for date handling

### Linear Updates
- FOO-720 through FOO-724: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (2 MEDIUM, 1 LOW), all fixed before commit
  - Non-AbortError from navigator.share silently swallowed (fixed: added setShareError)
  - Cursor sentinel invariant undocumented (fixed: added comment documenting score range invariant)
  - Token-logging tests missing error-level log coverage (fixed: added mockLogger.error to assertions)
- verifier: All 2334 tests pass, zero warnings, build clean

### Continuation Status
All tasks completed.
