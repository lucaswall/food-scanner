# Fix Plan: Chat edit loses original date, time, and meal type

**Issue:** FOO-769
**Date:** 2026-03-02
**Status:** Planning
**Branch:** fix/FOO-769-chat-edit-date-preservation

## Investigation

### Bug Report
When editing a past-date entry via the regular chat screen, the entry moves to today's date with the wrong meal type and time showing "Now". User reported: "I edited a Feb 20 yogurt from the chat screen on March 1. The entry appeared under today instead of Feb 20, meal type showed Dinner, and time showed Now."

### Classification
- **Type:** Frontend Bug + Integration (prompt + UI interaction)
- **Severity:** High
- **Affected Area:** Chat-initiated edit flow (`editingEntryId` path in FoodChat + Claude system prompt)

### Root Cause Analysis

Three interacting bugs prevent the chat edit flow from preserving original entry metadata:

**Bug 1: No `date` field in `FoodAnalysis` — Claude cannot report a date**
The `report_nutrition` tool has `time` and `meal_type_id` fields but no `date` field. Claude knows the entry's date from `search_food_log` results (e.g., "Food log for 2026-02-20") but has no way to pass it back. The user also cannot say "move this to the 21st" because there's no field to carry that instruction.

**Bug 2: System prompt forbids setting time/mealType for edits**
Lines 72-73 of `src/lib/claude.ts` say:
- "Only set meal_type_id when the user explicitly mentions the meal context. Otherwise leave it null"
- "Only set the time field when the user explicitly mentions a time. Do NOT guess or infer. Leave it null"

These rules are correct for **new entries** (let the user pick from the UI). But for **edits**, Claude has the original values from `search_food_log` (e.g., "Afternoon Snack" at "16:58") and should preserve them.

**Bug 3: `handleSaveExisting` defaults to today**
`src/components/food-chat.tsx:681` uses `getLocalDateTime()` for both date and time. Unlike `handleSaveEdit` (line 610, which uses `editEntry.date`), `handleSaveExisting` has no access to the original entry object — it only has `latestAnalysis`. Since the analysis lacks date/time/mealType (Bugs 1 & 2), everything defaults to "now".

#### Evidence
- **File:** `src/types/index.ts:55-80` — `FoodAnalysis` has `time?`, `mealTypeId?`, `editingEntryId?` but no `date` field
- **File:** `src/lib/claude.ts:72` — System prompt: "Never ask which meal type... leave it null" — no edit exception
- **File:** `src/lib/claude.ts:73` — System prompt: "Only set the time field when... leave it null" — no edit exception
- **File:** `src/lib/claude.ts:91-163` — `REPORT_NUTRITION_TOOL` definition: has `time` and `meal_type_id` params but no `date` param
- **File:** `src/lib/claude.ts:338-512` — `validateFoodAnalysis`: validates `time` (line 438-456) and `meal_type_id` (line 458-473) but no `date` validation
- **File:** `src/components/food-chat.tsx:681,687` — `handleSaveExisting` uses `getLocalDateTime()` for date
- **File:** `src/components/food-chat.tsx:610` — `handleSaveEdit` correctly uses `editEntry.date` (the edit page path works)
- **File:** `src/components/food-chat.tsx:519-532` — `handleLog` always uses `localDateTime.date` for new entries — should use analysis date when provided
- **File:** `src/lib/chat-tools.ts:175` — `search_food_log` output includes the date in the header: `"Food log for ${date}:"`
- **File:** `src/lib/claude.ts:1337-1338` — `convertMessages` already appends `meal_type_id` and `time` to `[Current values]` when set — needs `date` too

**Staging log evidence (2026-03-01T23:43):**
- Claude's first `report_nutrition` for the edit omitted `meal_type_id` and `time` (per system prompt rules)
- `[Current values]` annotation showed no `meal_type_id` or `time`
- UI showed "Dinner" (from `getDefaultMealType()`) and "Now" (from `selectedTime === null`)
- After user complained, Claude re-issued `report_nutrition` with `meal_type_id: 4` and `time: "16:58"` — but `handleSaveExisting` still used today's date via `getLocalDateTime()`

### Impact
- Every chat-initiated edit of a past-date entry moves it to today
- Meal type and time are wrong until user manually corrects them
- The edit page (`/app/edit/[id]`) is NOT affected (uses `editEntry.date`)
- Users cannot tell Claude to log food on a specific past date ("log this for yesterday")

## Fix Plan (TDD Approach)

### Step 1: Add `date` field to `FoodAnalysis` type
**File:** `src/types/index.ts` (modify)

**Behavior:**
- Add optional `date?: string | null` field to `FoodAnalysis` interface (YYYY-MM-DD format)
- Place it near the existing `time` field for logical grouping
- Same optionality pattern as `time` and `mealTypeId`: undefined = not set, null = explicitly cleared, string = value

### Step 2: Add `date` parameter to `report_nutrition` tool and validate in `validateFoodAnalysis`
**File:** `src/lib/claude.ts` (modify)
**Test:** `src/lib/__tests__/claude.test.ts` (modify)

**Behavior:**
- Add `date` property to `REPORT_NUTRITION_TOOL.input_schema.properties` with type `["string", "null"]` and description explaining YYYY-MM-DD format. Follow the pattern of the existing `time` field (line 156-158). Place near `time` for grouping.
- In `validateFoodAnalysis` (line 338-512): add date validation block after the existing time validation (line 438-456). Pattern: undefined → undefined, null → null, string → validate YYYY-MM-DD format (regex + range check for month/day). Use the same `isValidDateFormat` function from `@/lib/date-utils` that `/api/edit-food` already uses (line 136).
- Store validated date in the result object: `if (validatedDate !== undefined) result.date = validatedDate;` — same pattern as `time` (line 503-505).
- In `convertMessages` (line 1328-1341): add `if (a.date != null) summary += ', date=${a.date}';` after the existing `time` line (1338). This ensures Claude sees the date in subsequent conversation turns.

**Tests:**
1. `validateFoodAnalysis` accepts valid YYYY-MM-DD date string and includes it in result
2. `validateFoodAnalysis` accepts null date and includes null in result
3. `validateFoodAnalysis` accepts undefined/missing date and omits it from result
4. `validateFoodAnalysis` rejects invalid date formats (e.g., "02-20", "2026/02/20", "not-a-date")
5. `validateFoodAnalysis` rejects dates with invalid month/day values (e.g., "2026-13-01", "2026-02-30")
6. `REPORT_NUTRITION_TOOL` schema includes `date` property with type `["string", "null"]`
7. `convertMessages` includes `date=YYYY-MM-DD` in `[Current values]` when analysis has date set

### Step 3: Update system prompt for edit-aware date/time/mealType behavior
**File:** `src/lib/claude.ts` (modify)
**Test:** `src/lib/__tests__/claude.test.ts` (modify)

**Behavior:**
- Update the `meal_type_id` rule (line 72) to add an edit exception: when `editing_entry_id` is set, Claude should preserve the original `meal_type_id` from the search results unless the user explicitly asks to change it.
- Update the `time` rule (line 73) to add the same edit exception: preserve the original time from search results when editing.
- Add a new rule for `date`: "Only set the date field when the user explicitly mentions a date (e.g., 'log this for yesterday', 'move this to the 21st'). When editing an existing entry (`editing_entry_id` is set), always set date to the original entry's date from the search results unless the user asks to change it. Leave null for new entries — the app uses today's date by default."
- Update the `report_nutrition` tool's `date` property description to match this behavior.

**Tests:**
1. `CHAT_SYSTEM_PROMPT` contains edit exception for `meal_type_id` (mentions `editing_entry_id`)
2. `CHAT_SYSTEM_PROMPT` contains edit exception for `time` (mentions `editing_entry_id`)
3. `CHAT_SYSTEM_PROMPT` contains `date` field rules (mentions editing preservation and explicit user date)

### Step 4: Use analysis date/time in `handleSaveExisting` and `handleLog`
**File:** `src/components/food-chat.tsx` (modify)
**Test:** `src/components/__tests__/food-chat.test.tsx` (modify)

**Behavior:**

For `handleSaveExisting` (line 664-735):
- Replace `const { date, time } = getLocalDateTime()` with logic that prefers analysis values: `const fallback = getLocalDateTime(); const date = analysis.date ?? fallback.date; const time = selectedTime ?? analysis.time ?? fallback.time;`
- This means: if Claude provided a date (from the original entry or user instruction), use it. Otherwise fall back to today.
- Similarly for time: if user selected a time in the UI, use that. Else if Claude provided the original time, use that. Else use current time.
- The `mealTypeId` state variable already gets updated via the SSE event handler (line 430-431) when Claude provides `mealTypeId` — so no change needed there. The fix is in Step 3 (making Claude actually provide it for edits).

For `handleLog` (line 507-586):
- Change `date: localDateTime.date` (lines 525, 531) to `date: analysis.date ?? localDateTime.date`. This enables the user to say "log this for yesterday" in the regular analyze flow too.
- The FITBIT_TOKEN_INVALID pending submission (line 557) should also use the resolved date.

For both the `handleSaveEdit` path (line 596-662):
- No change needed — it correctly uses `editEntry.date` from the fetched entry object.

**Tests:**
1. `handleSaveExisting` sends the analysis `date` (not today) when analysis includes a date
2. `handleSaveExisting` falls back to today's date when analysis has no date
3. `handleSaveExisting` sends analysis `time` when selectedTime is null and analysis has time
4. `handleSaveExisting` prefers selectedTime over analysis time when both exist
5. `handleLog` sends analysis `date` when analysis includes a date
6. `handleLog` falls back to today's date when analysis has no date

### Step 5: Verify
- [ ] All new tests pass
- [ ] All existing tests pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds

## Notes
- The edit page path (`handleSaveEdit`) is NOT affected — it correctly uses `editEntry.date` and `editEntry.time`.
- The `EDIT_SYSTEM_PROMPT` (line 1583) doesn't need the same prompt changes because the edit page flow always has the entry context injected into the system prompt (line 1638-1647), and the `handleSaveEdit` function uses `editEntry.date` directly.
- No DB migration needed — this is a prompt/UI-only change.
- The `date` field in `FoodAnalysis` enables a secondary use case: users can say "log this for yesterday" or "move this to the 21st" in the regular chat, which was previously impossible.
- The `search_food_log` output already includes the date (e.g., "Food log for 2026-02-20:" at line 179 and entry dates at line 200), so Claude has the information — it just needs the prompt permission and tool field to report it back.
