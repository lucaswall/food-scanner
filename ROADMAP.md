# Food Scanner - Roadmap

## Contents

| # | Feature | Prerequisites |
|---|---------|---------------|
| 1 | [Conversational Analysis](#feature-1-conversational-analysis) | — |
| 2 | [Fasting Window & Date Navigation](#feature-2-fasting-window--date-navigation) | Daily Dashboard (FOO-302–306) |
| 3 | [Weekly Nutrition View](#feature-3-weekly-nutrition-view) | Feature 2 |
| 4 | [Smart Multi-Item Splitting](#feature-4-smart-multi-item-splitting) | Feature 1 |
| 5 | [Contextual Memory from Food History](#feature-5-contextual-memory-from-food-history) | Feature 1 |
| 6 | [Offline Queue with Background Sync](#feature-6-offline-queue-with-background-sync) | — |

---

## Feature 1: Conversational Analysis

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

## Feature 2: Fasting Window & Date Navigation

### Problem

The daily dashboard shows today's nutrition totals but there's no way to navigate between days or see fasting patterns. Users who practice intermittent fasting have no visibility into their eating windows.

### Prerequisites

Daily dashboard must be implemented first (FOO-302 through FOO-306).

### Goal

Add date navigation to the daily dashboard and a fasting window card that shows overnight fasting duration based on existing meal timestamps.

### Design

#### Fasting Window Card

- **Calculation:** Time from last logged meal of the previous day to the first logged meal of the current day.
- **Display:** Card showing fasting duration (e.g., "14h 30m fast") and time range (e.g., "9:15 PM → 11:45 AM").
- **Placement:** Below the macro bars, above the meal breakdown on the daily dashboard.

#### Date Navigation

- **Controls:** Left/right arrows or swipe to navigate between days.
- **Today indicator:** Clear visual distinction when viewing today vs. a past date. "Today" label or highlight.
- **Bounds:** No future dates. Earliest date is the first food log entry.
- **URL/state:** Date stored in query parameter or client state. Default is today.

### Edge Cases

- No meals logged for previous or current day → show "No data" for fasting window.
- Only one meal logged for a day → use it as both first and last meal (fasting window shows time from previous day's last meal to this single meal).
- User navigates to a date with no food logged → dashboard shows empty state with "No food logged" message.

### Implementation Order

1. Fasting window calculation logic and card component
2. Date navigation UI (arrows/swipe between days)
3. Wire fasting card into daily dashboard
4. Update nutrition summary API to accept any date (if not already flexible)

---

## Feature 3: Weekly Nutrition View

### Problem

Daily totals show a snapshot but not trends. Users can't see if they're consistently hitting calorie goals, whether protein is trending up, or how fasting patterns look across the week.

### Prerequisites

Daily dashboard (FOO-302 through FOO-306) and Feature 2 (Fasting Window & Date Navigation).

### Goal

A weekly view showing 7-day nutrition trends with simple charts, macro averages, and fasting durations per day. Accessible from the daily dashboard.

### Design

#### Navigation

- **Access:** Toggle within the dashboard on the Home page — "Daily" / "Weekly" tabs or segmented control above the dashboard content.
- **Week selection:** Left/right arrows to navigate between weeks. Default is the current week (Mon–Sun).

#### Weekly Summary

- **Calorie bar chart:** One bar per day, colored by whether goal was met. Horizontal goal line overlay.
- **Macro averages:** Average daily protein/carbs/fat over the 7 days.
- **Fasting durations:** Per-day fasting window shown alongside or below the calorie chart.
- **Nutrient highlights:** Flag days where sodium or sugar exceeded recommended values (if thresholds can be determined).

#### Extended Nutrients Table (conditional)

Depends on FOO-298 through FOO-301. Only shown when extended nutrient data exists:
- Fiber, sodium, saturated fat, trans fat, sugars with daily totals and weekly averages.

#### Micronutrient Report (conditional)

Depends on FOO-298 through FOO-301. Only shown when data exists:
- Table of non-null micronutrients with daily totals and % of daily recommended intake.

#### Charting Approach

- Start with pure CSS/SVG: `<div>` widths for bars, positioned elements for the goal line.
- If pure CSS proves limiting (responsive sizing, accessibility, interaction), graduate to a lightweight library (e.g., Recharts).
- Decision point: evaluate after the basic CSS version is working.

### Edge Cases

- Fewer than 7 days of data → show only available days, don't pad with empty bars.
- No data at all → "Log food for a few days to see weekly trends" with CTA to scan food.
- User has data for some days but not others → show bars for days with data, gaps for days without.

### Architecture

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nutrition-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily totals per day across a date range |

Aggregates from `food_log_entries` joined with `custom_foods`, same data source as the daily summary API (FOO-302). Returns an array of daily totals, one entry per day.

### Implementation Order

1. API endpoint for date range nutrition summary
2. Daily/Weekly toggle on dashboard
3. Weekly calorie bar chart with CSS/SVG
4. Macro averages display
5. Fasting durations per day
6. Extended nutrients table (depends on FOO-298 through FOO-301)
7. Micronutrient report (depends on FOO-298 through FOO-301)

---

## Feature 4: Smart Multi-Item Splitting

### Problem

Complex meals are logged as a single monolithic food entry ("grilled chicken with rice, salad, and flan" → one custom food with combined nutrition). This makes the food library less reusable — tomorrow the user has the same chicken with rice but no flan, and they can't quick-select just the chicken.

### Prerequisites

Feature 1 (Conversational Analysis) — splitting happens during the chat refinement flow.

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

## Feature 5: Contextual Memory from Food History

### Problem

Every food analysis is treated in isolation. Claude has no knowledge of what the user has eaten before. Users can't say "same as yesterday's lunch" or ask "how much protein have I had today?" without leaving the app.

### Prerequisites

Feature 1 (Conversational Analysis) — memory queries happen during the chat flow.

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

## Feature 6: Offline Queue with Background Sync

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

## Roadmap Conventions

Rules for agents creating, updating, or managing features in this roadmap.

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

### Numbering

- Features are numbered sequentially starting from 1.
- When a feature is fully moved to Linear (all issues created), **remove it** from the roadmap. Do not leave stubs.
- When removing a feature, **renumber** all remaining features to keep numbering contiguous (no gaps). Update the Contents table and any cross-references (Prerequisites).
- New features get the next available number (highest existing + 1).

### When to Move to Linear

A feature moves from roadmap to Linear Backlog when:
1. The design is detailed enough for `plan-backlog` to create implementation plans.
2. Prerequisites are done or in progress.
3. The feature is approved for implementation.

Move the **entire feature or a self-contained phase** — don't create Linear issues for half a feature while the other half stays in the roadmap. When a feature is too large, split it into separate roadmap features first (each with their own number), then move them independently.

### Splitting Features

If a feature grows beyond ~60 lines or contains clearly independent phases:
1. Extract each phase into its own feature with a new number.
2. Set prerequisites between them as needed.
3. Update the Contents table.

### Contents Table

The table at the top must stay in sync. When adding, removing, or renumbering features, update the table. Each row has: number, linked feature name, and prerequisites.
