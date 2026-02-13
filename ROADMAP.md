# Food Scanner - Ideas

## Contents

| Feature | Summary |
|---------|---------|
| [Conversational Analysis](#conversational-analysis) | Multi-turn chat to refine food analysis before logging |
| [Smart Multi-Item Splitting](#multi-item-splitting) | Split complex meals into reusable food library entries |
| [Contextual Memory from Food History](#contextual-memory) | Claude queries past food logs during chat |
| [Conversational Food Editing](#conversational-food-editing) | Edit logged entries via chat — adjust portions, split shared meals, fix mistakes |
| [Offline Queue with Background Sync](#offline-queue) | Queue meals offline, analyze and log when back online |

---

## Conversational Analysis

### Problem

The app supports a single correction after analysis (type a correction → Claude re-analyzes), but there's no multi-turn conversation. Users can't iteratively refine ("that's two apples" → "also add peanut butter" → "I only ate half"), add more photos mid-conversation, or ask questions about the food before logging.

Users can't validate nutritional numbers — nobody looks at "23g protein" and knows whether that's right. What users *can* validate is the text description. The conversation itself is the validation mechanism, but the current single-correction flow limits this to one round.

### Goal

Extend the existing correction flow into a full inline chat. The chat is ephemeral — it exists only to produce a better food log entry through iterative refinement. Once logged, the conversation is gone.

### Design

#### UX Flow

1. **Initial analysis** works as today: photo/description → AI analyzes → analysis card appears.
2. Below the analysis card, a **collapsed input hint** appears: *"Add details or correct something..."*
3. Tapping **Log** logs immediately (current flow, unchanged).
4. Tapping the **input hint** transforms the screen into a chat:
   - Analysis card reflows into a chat bubble (first assistant message).
   - Input expands with a text field and an inline camera button.
   - **Log** button stays pinned and always accessible.
   - **Close** button (X) available to abandon without logging.
5. User can send text messages, attach new photos, or both.
6. Claude responds conversationally. When food items or quantities change, Claude confirms the updated analysis naturally.
7. Tapping **Log** logs the latest agreed-upon analysis (same post-log flow: `FoodLogConfirmation` with "Done" and "Log Another").
8. Tapping **Close** discards everything, returns to Home.

#### Chat Behavior Rules

1. **Always confirm what will be logged** — after any change, Claude's response includes the updated summary conversationally: *"Got it — updated to 2 apples with peanut butter (~340 cal)."*
2. **Don't repeat unchanged information** — if the user asks a question and nothing changed, Claude answers without re-listing the analysis.
3. **New photos add to the meal** — sending another photo adds items, doesn't replace.
4. **Text-only input works** — *"I also had a coffee with oat milk."*
5. **Corrections override** — *"That's not rice, it's quinoa"* → Claude updates and confirms.
6. **Portion adjustments** — *"I only ate half"* → Claude halves quantities and confirms.

#### UI Details

- **Chat bubbles:** Standard layout (assistant left, user right). Assistant messages use the accent color.
- **Camera button:** Inline in chat input bar. Opens the same camera/gallery picker as the analyze flow.
- **Log button:** Pinned, always visible. No calorie preview on the button.
- **Close button:** Top-left X or alongside Log. No "are you sure?" confirmation.

### Architecture

- **Existing foundation:** `refineAnalysis()` in `src/lib/claude.ts` and `/api/refine-food` already handle a single correction round. This feature extends that into multi-turn by accumulating conversation history client-side.
- **Ephemeral chat state:** Conversation history lives in client-side React state only. No DB persistence. Discarded on log, close, or navigation.
- **Multi-turn Anthropic API:** Each user message sends the full conversation history to the API via `tool_use`. Extends the existing single-correction pattern to N turns.
- **Final log uses latest analysis:** The most recent `FoodAnalysis` from the conversation (last tool_use response with food data).
- **Auto-expire on navigation:** Leaving the screen discards the chat state. No resume.

### Edge Cases

- User navigates away mid-chat → state discarded silently, no prompt.
- User sends only questions (no food changes) → Log button still uses the original analysis.
- User sends a photo that Claude can't identify → Claude asks for clarification, doesn't discard previous items.

### Implementation Order

1. Refactor existing correction state into a chat message history format (extends current `food-analyzer.tsx` correction flow)
2. Replace single-correction input with collapsed input hint UI
3. Chat screen transition (analysis card → first chat bubble)
4. Multi-turn API integration (extend `refineAnalysis()` to accept full conversation history)
5. Inline camera button in chat input
6. Log button reads latest analysis from conversation history
7. Close/discard behavior
8. Post-log flow (reuse existing `FoodLogConfirmation` screen)

---

## Smart Multi-Item Splitting

### Problem

Complex meals are logged as a single monolithic food entry ("grilled chicken with rice, salad, and flan" → one custom food with combined nutrition). This makes the food library less reusable — tomorrow the user has the same chicken with rice but no flan, and they can't quick-select just the chicken.

### Prerequisites

[Conversational Analysis](#conversational-analysis) — splitting happens during the chat refinement flow.

### Goal

During the chat, Claude suggests splitting a meal into separate food log entries by course/dish, and reuses existing custom foods from the library when a match exists.

### Design

#### Splitting Behavior

- Claude suggests splitting by **courses or distinct items**, not ingredients. "Chicken with rice" stays together. "Chicken with rice AND flan" is two items.
- **Claude suggests, user decides.** Never auto-split. User can say "keep it as one" or "actually split the chicken and rice too."
- **Cap at ~4–5 entries** per analysis. No micro-entries.
- User can adjust splits during the chat: "combine those into one" or "separate the salad."

#### Food Library Reuse

- Before creating a new custom food, Claude checks the existing library for matches.
- If "Grilled chicken with rice" already exists, Claude reuses it instead of creating a duplicate.
- Claude tells the user which items are reused ("matches one you've logged before") vs. new estimates.
- Keeps the food library clean — no duplicates piling up.

#### UI

- Claude's suggestion is conversational: *"I'd log this as 2 items: (1) Grilled chicken with rice — matches one you've logged before (520 cal), (2) Flan — new (~280 cal). Sound good?"*
- User confirms, adjusts, or declines in the chat.
- When confirmed, the Log button logs all items as separate entries in one action.

### Architecture

- New Claude tool: `search_custom_foods` — queries the user's custom_foods table for name/keyword matches.
- Multi-item log: the `/api/log-food` endpoint (or a new batch variant) must support logging multiple entries atomically.
- Each split item becomes its own `food_log_entry` + `custom_food` pair.

### Edge Cases

- User declines splitting → log as a single entry (current behavior).
- Matched food has different portion size → Claude notes the difference: "Last time this was 350g, this looks similar — same amount?"
- No matches in library → all items created as new custom foods.

### Implementation Order

1. `search_custom_foods` Claude tool (query existing library)
2. Multi-item splitting logic in Claude prompt/tool schema
3. Batch logging support (multiple entries from one analysis)
4. Library match display in chat responses
5. User confirmation flow for splits

---

## Contextual Memory from Food History

### Problem

Every food analysis is treated in isolation. Claude has no knowledge of what the user has eaten before. Users can't say "same as yesterday's lunch" or ask "how much protein have I had today?" without leaving the app.

### Prerequisites

[Conversational Analysis](#conversational-analysis) — memory queries happen during the chat flow.

### Goal

Claude can query the user's food log database during the chat to give contextual, personalized responses grounded in real data.

### Design

#### User Interactions

- *"I had the same breakfast as Monday."* → Claude looks up Monday's breakfast and pre-fills the analysis.
- *"This is like the chicken I had yesterday but without salt."* → Claude fetches yesterday's entry, adjusts sodium, confirms.
- *"How much protein have I had today?"* → Claude sums today's logged entries and answers.
- *"You've had this 3 times this week — want to save it to quick-select?"* → Claude detects patterns.

#### When Tools Are Used

- Tools are **only triggered by user messages** during the chat — never during the initial one-shot analysis.
- Claude doesn't preload history. It queries on demand when the user's message warrants a lookup.

### Architecture

- New Claude tools:
  - `search_food_history` — search `food_log_entries` + `custom_foods` by date, food name, or keyword.
  - `get_daily_totals` — sum nutrition for a given date (reuses the nutrition summary API logic).
- Results injected as tool responses in the conversation, same pattern as `report_nutrition`.
- Read-only — these tools never create or modify data.

### Edge Cases

- User references a date with no logs → Claude responds "I don't see any entries for Monday."
- Ambiguous reference ("the chicken") with multiple matches → Claude asks for clarification or shows options.
- User asks about nutrition totals for today while mid-analysis → Claude sums logged entries only, doesn't include the current unlogged analysis.

### Implementation Order

1. `search_food_history` Claude tool (query logs by date/name/keyword)
2. `get_daily_totals` Claude tool (nutrition sums for a date)
3. Prompt engineering for contextual responses
4. Pattern detection ("you've had this X times this week")

---

## Conversational Food Editing

### Problem

Once a food entry is logged, the only way to fix it is to delete and re-scan from scratch. Users frequently need small adjustments after the fact: "I actually only ate half", "we split this between three people", "I forgot I added an extra potato". These corrections are natural to express in conversation but impossible in the current UI.

### Prerequisites

[Conversational Analysis](#conversational-analysis) — editing reuses the same multi-turn chat infrastructure.

### Goal

Let users open a chat on any logged food entry to conversationally edit it. Claude understands the original entry, processes corrections, and replaces the Fitbit log + local DB entry with the updated version.

### Design

#### Entry Points

- **Today screen:** Each food entry card gets an "Edit" action (e.g., tap → action sheet or swipe).
- **History screen:** Same "Edit" action on any past entry.
- Both open the same chat view, pre-loaded with the entry's context.

#### Chat Flow

1. **Context message:** Claude's first message summarizes the existing entry conversationally: *"This is your lunch from today — Milanesa con puré (520 cal, 28g protein). What would you like to change?"*
2. **User describes corrections** in natural language:
   - Portion adjustments: *"I only ate half"* → Claude halves all nutrition values.
   - Sharing: *"We were three people"* → Claude divides by three.
   - Additions: *"I also had a side of fries"* → Claude adds to the entry or suggests splitting.
   - Replacements: *"It was quinoa, not rice"* → Claude recalculates.
   - Removals: *"I didn't eat the bread"* → Claude subtracts.
3. **Claude confirms** each change with an updated summary: *"Got it — updated to half portion: Milanesa con puré (260 cal, 14g protein). Save?"*
4. **Save button** (pinned, always visible) replaces the old entry. **Cancel** discards changes.
5. **Post-save:** Returns to the screen the user came from. No "log another" flow.

#### Chat Behavior Rules

1. **Always show the delta** — after any change, Claude mentions what changed and the new totals.
2. **Cumulative corrections** — multiple messages accumulate: "half portion" then "add fries" results in half the original plus fries.
3. **No new photos** — editing is text-only. For a completely different meal, delete and re-scan.
4. **Respect the original analysis context** — Claude sees the original food name, nutrition, notes, and description to make informed adjustments.

#### UI Details

- **Chat view:** Same layout as the conversational analysis chat (assistant left, user right).
- **Save button:** Pinned at bottom, labeled "Save Changes". Disabled until Claude has produced at least one updated analysis.
- **Cancel button:** Top-left X. No confirmation dialog — changes aren't saved until explicitly saved.
- **Entry context header:** Shows the food name and date at the top of the chat for orientation.

### Architecture

- **Edit API route:** New `POST /api/edit-food` endpoint. Accepts the `foodLogEntryId`, conversation history, and the final updated `FoodAnalysis`. Orchestrates the replace operation:
  1. Delete the old Fitbit food log via `deleteFoodLog(fitbitLogId)`.
  2. Create a new `custom_food` row with the updated nutrition (never mutate the existing one — see below).
  3. Create a new Fitbit food via `findOrCreateFood()` and log it via `logFood()`.
  4. Update the `food_log_entry` row to point to the new `custom_food` and new `fitbitLogId`.
  5. Orphan-clean the old `custom_food` if no other entries reference it.
- **Custom food immutability:** A `custom_food` may be referenced by multiple `food_log_entries` (reuse/quick-select). Editing an entry must **never mutate** a shared custom food — always create a new one. After relinking the entry, delete the old custom food only if its reference count drops to zero. This preserves historical accuracy for all other entries.
- **Claude integration:** New function `editAnalysis(originalEntry, conversationHistory, userId)` in `src/lib/claude.ts`. Uses the same `report_nutrition` tool as `analyzeFood()` but with a system prompt tailored for editing: Claude receives the original nutrition data and applies corrections.
- **Conversation state:** Ephemeral, client-side only (same pattern as conversational analysis). No DB persistence of the chat.
- **Fitbit replace strategy:** Delete-then-log (not update-in-place). Fitbit's food log API doesn't support editing nutrition on logged entries — the only path is delete + re-log. The entry keeps its original `date` and `mealTypeId`.
- **Compensation:** If the new Fitbit log succeeds but the DB update fails, delete the new Fitbit log to rollback. If the old Fitbit log deletion succeeds but creating the new one fails, re-log the original entry to restore it.

### Edge Cases

- Entry has no `fitbitLogId` (dry-run or Fitbit was down) → skip Fitbit delete/re-log, only update the local DB.
- User makes no actual changes and taps Save → no-op, return to previous screen.
- Original custom food has `fitbitFoodId` but the new one needs a different food → creates a new Fitbit food; the old Fitbit food persists (Fitbit foods are global and may be referenced elsewhere).
- User tries to edit an entry from weeks ago → allowed. Date stays the same; Fitbit log is replaced at the original date.
- Multiple edits to the same entry in sequence → each edit creates a new custom food and orphan-cleans the previous one if unreferenced.

### Implementation Order

1. `editAnalysis()` function in `src/lib/claude.ts` (multi-turn editing with original entry context)
2. `POST /api/edit-food` endpoint (delete old + create new Fitbit log + custom food immutability + orphan cleanup)
3. Edit chat view component (reuses conversational analysis chat UI)
4. Entry point UI on Today screen (edit action on food cards)
5. Entry point UI on History screen (edit action on past entries)
6. Compensation/rollback logic for partial failures

---

## Offline Queue with Background Sync

### Problem

The app is a PWA but has no service worker. Without connectivity, the app is completely unusable. Food logging happens at meal time, not when you're conveniently on Wi-Fi.

### Goal

Queue food photos and descriptions locally when offline, then analyze and log them when connectivity returns. No meal entry should be lost due to lack of signal.

### Design

#### Online Flow (no change)

Normal flow: photo → analyze → confirm → log.

#### Offline Flow

1. User opens app (served from cache).
2. Takes photo, adds description, picks meal type.
3. Taps "Analyze" — app detects offline.
4. Entry saved to IndexedDB with status `pending`.
5. UI shows "Saved — will analyze when online" with a queued badge.
6. User can continue adding more entries.

#### Coming Back Online

1. Service worker detects connectivity (`online` event or periodic check).
2. Processes queue in order: upload photo → analyze → present result.
3. Queue items update status as they progress.

#### Confirmation Strategy

User picks in Settings:
- **Auto-log (default for high confidence):** If Claude returns `confidence: high`, log automatically. Show notification with result and "Undo" button (30-second window).
- **Hold for review:** All queued items wait in a "Pending Review" screen. User confirms each one.

#### Queue UI

- **Badge:** Count of pending items on the bottom nav (on the Home or Analyze tab).
- **Queue screen:** Shows each entry with photo thumbnail, description, status, and timestamp.
- **Swipe to delete:** Remove queued items before they sync.

### Architecture

- **Service Worker:** Caches app shell (HTML, JS, CSS, icons). Intercepts failed API requests. Triggers background sync on reconnection. Does NOT cache API responses.
- **IndexedDB:** Stores queued photos as blobs, text descriptions, timestamps, meal type, sync status (`pending`, `analyzing`, `logging`, `done`, `failed`).
- **Cache strategy:** Stale-while-revalidate for the shell.

### Edge Cases

- Queue reaches storage limit → cap at ~20 entries, warn user.
- Sync fails for one item → mark as `failed`, continue processing others. User can retry failed items.
- App updated while offline → service worker update takes effect on next reload.
- User opens app online with pending queue → process queue immediately in background.

### Implementation Order

1. Service worker registration + app shell caching
2. IndexedDB queue for photos and descriptions
3. Offline detection in the analyze flow
4. Queue UI (badge + pending screen)
5. Background sync on reconnection
6. Auto-log vs hold-for-review setting
7. Notification for auto-logged items

---

## Conventions

Rules for agents creating, updating, or managing features in this file.

### Feature Structure

Every feature **must** have these sections in this order:

| Section | Purpose |
|---------|---------|
| **Problem** | What's wrong or missing. 2–3 sentences max. No solution language. |
| **Prerequisites** | Other features or Linear issues that must be done first. Omit if none. |
| **Goal** | What the feature achieves for the user. 1–2 sentences. |
| **Design** | The meat: UX flows, behavior rules, UI details. Sub-sections vary by feature. |
| **Architecture** | Technical decisions: storage, APIs, state management. Omit if purely UI. |
| **Edge Cases** | Non-obvious scenarios and how to handle them. |
| **Implementation Order** | Numbered list of steps, ordered by dependency. |

### Writing Rules

- **Problem-focused.** Describe what's wrong, not how to fix it. The Design section handles solutions.
- **Concise.** Each section earns its space. If a section adds nothing beyond what's obvious, cut it.
- **No implementation code.** Reference file paths and patterns, but don't write code. That's for Linear issues and plan-implement.
- **User-facing language in Problem/Goal.** Technical details belong in Architecture.
- **Edge Cases are not Limitations.** Edge cases describe specific scenarios and their handling. Limitations are fundamental constraints (e.g., "requires network") — fold these into Architecture or Edge Cases.

### Identification

- Features use **stable slug IDs** as their heading anchor (e.g., `## Date Navigation` → anchor `#date-navigation`).
- Slugs never change once a feature is added. This keeps external references (chats, notes, Linear issues) valid.
- Cross-references within this file use markdown links: `[Date Navigation](#date-navigation)`.

### Adding and Removing Features

- New features are appended before the Conventions section. Position in the contents table reflects rough priority.
- When a feature is fully moved to Linear (all issues created), **remove it** from the file. Do not leave stubs.
- When removing a feature, update the Contents table and fix any cross-references in remaining features.

### When to Move to Linear

A feature moves from this file to Linear Backlog when:
1. The design is detailed enough for `plan-backlog` to create implementation plans.
2. Prerequisites are done or in progress.
3. The feature is approved for implementation.

Move the **entire feature or a self-contained phase** — don't create Linear issues for half a feature while the other half stays here. When a feature is too large, split it into separate features first, then move them independently.

### Splitting Features

If a feature grows beyond ~60 lines or contains clearly independent phases:
1. Extract each phase into its own feature with a new heading.
2. Set prerequisites between them as needed.
3. Update the Contents table.

### Contents Table

The table at the top must stay in sync. When adding or removing features, update the table. Each row has: linked feature name and a one-sentence summary.
