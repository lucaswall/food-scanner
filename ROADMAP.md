# Food Scanner - Ideas

## Contents

| Feature | Summary |
|---------|---------|
| [Smart Multi-Item Splitting](#multi-item-splitting) | Split complex meals into reusable food library entries |
| [Conversational Food Editing](#conversational-food-editing) | Edit logged entries via chat — adjust portions, split shared meals, fix mistakes |
| [Offline Queue with Background Sync](#offline-queue) | Queue meals offline, analyze and log when back online |
| [Web Search for Nutrition Info](#web-search-for-nutrition-info) | Let Claude search the web and read pages to look up restaurant menus, brand products, etc. |

---

## Smart Multi-Item Splitting

### Problem

Complex meals are logged as a single monolithic food entry ("grilled chicken with rice, salad, and flan" → one custom food with combined nutrition). This makes the food library less reusable — tomorrow the user has the same chicken with rice but no flan, and they can't quick-select just the chicken.

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

- Reuse existing `search_food_log` tool — already queries the `custom_foods` table for name/keyword matches.
- Multi-item log: the `/api/log-food` endpoint (or a new batch variant) must support logging multiple entries atomically.
- Each split item becomes its own `food_log_entry` + `custom_food` pair.

### Edge Cases

- User declines splitting → log as a single entry (current behavior).
- Matched food has different portion size → Claude notes the difference: "Last time this was 350g, this looks similar — same amount?"
- No matches in library → all items created as new custom foods.

### Implementation Order

1. Multi-item splitting logic in Claude prompt/tool schema (reuse existing `search_food_log` for library lookups)
2. Batch logging support (multiple entries from one analysis)
3. Library match display in chat responses
4. User confirmation flow for splits

---

## Conversational Food Editing

### Problem

Once a food entry is logged, the only way to fix it is to delete and re-scan from scratch. Users frequently need small adjustments after the fact: "I actually only ate half", "we split this between three people", "I forgot I added an extra potato". These corrections are natural to express in conversation but impossible in the current UI.

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

## Web Search for Nutrition Info

### Problem

When users ask about restaurant dishes, brand-name products, or unfamiliar foods, Claude can only estimate from its training data. It has no access to actual menus, product labels, or nutritional databases. Estimates for specific restaurant items (e.g., "the chicken burrito from Chipotle") can be significantly off because portion sizes and recipes vary by chain.

### Goal

Let Claude search the web and read page content to look up real nutrition information — restaurant menus, brand product pages, nutritional databases — before estimating.

### Design

#### Two New Tools

1. **`search_web`** — Takes a query string, returns a list of results (title, URL, snippet). Claude decides what to search for based on the conversation.
2. **`read_page`** — Takes a URL, returns the page content as clean text/markdown. Claude picks the most relevant result from the search and reads it.

#### Behavior Rules

- **Claude decides when to search.** If the user asks about a specific restaurant, brand, or product, Claude searches. For generic foods ("an apple", "grilled chicken"), it estimates from training data as today.
- **Search → Read → Analyze.** Claude searches, picks the best result, reads the page, extracts nutrition info, and reports it via `report_nutrition`.
- **Cite the source.** When nutrition comes from a web page, Claude mentions where it came from: *"Based on Chipotle's online nutrition calculator, a chicken burrito is..."*
- **Fallback gracefully.** If search returns nothing useful or the page is unreadable, Claude falls back to estimation and says so.

#### Example Flow

User: *"I had a Big Mac"*
1. Claude calls `search_web("Big Mac nutrition information")`
2. Gets results including McDonald's nutrition page
3. Claude calls `read_page("https://www.mcdonalds.com/us/en-us/product/big-mac.html")`
4. Extracts: 590 cal, 34g protein, 46g carbs, 33g fat
5. Reports via `report_nutrition` with a note citing McDonald's website

### Architecture

- **Search API:** Jina Search or Brave Search. Both have free tiers sufficient for single-user volume. Accessed server-side from `executeTool` in `src/lib/chat-tools.ts`.
- **Page reading:** Jina Reader (`https://r.jina.ai/{url}`) — returns any page as markdown with a single HTTP call. No parsing libraries needed.
- **Tool definitions:** Added to `src/lib/chat-tools.ts` alongside the existing data tools. Same `strict: true` schema pattern.
- **System prompt update:** Add guidance in `CHAT_SYSTEM_PROMPT` for when to search vs. estimate, and to always cite sources.
- **Rate limiting:** Web search and page reads count toward the existing per-user rate limit. Optionally add a separate sub-limit for web calls (e.g., 5 searches per conversation) to control external API usage.
- **No new env vars needed** if using Jina (free, no API key). If using Brave or another paid API, add the API key to env vars.

### Edge Cases

- Page is behind a paywall or login wall → Jina Reader returns partial/empty content → Claude falls back to estimation.
- Search returns irrelevant results → Claude reads the top result, determines it's not useful, and estimates instead.
- Very long page (full restaurant menu with 200+ items) → Jina Reader returns full content, but Claude can extract the relevant item from context. May need to truncate page content to stay within token limits.
- User asks about a local restaurant with no web presence → search returns nothing → Claude estimates and mentions the source is unavailable.
- Multiple tool loop iterations → search + read adds 2 extra iterations to the tool loop. Current MAX_ITERATIONS=5 should be sufficient but may need bumping.

### Implementation Order

1. `search_web` tool definition and Jina Search integration in `executeTool`
2. `read_page` tool definition and Jina Reader integration in `executeTool`
3. System prompt guidance for when to search vs. estimate
4. Source citation in Claude responses
5. Optional: sub-limit for web API calls per conversation

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
- When removing a feature, update the Contents table and fix any cross-references in remaining features. Use the plain feature name in prerequisite references — no Linear issue IDs, links, or "moved to" annotations. The backlog is always fully processed before pulling more features from this file.

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
