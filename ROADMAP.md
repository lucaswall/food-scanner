# Food Scanner - Roadmap

## Feature 1: Conversational Analysis (Chat Refinement)

### Problem

Food analysis is currently a one-shot transaction: snap a photo, get results, log to Fitbit. There's no way to correct mistakes ("that's two apples, not one"), add more items to the same meal, ask questions about the food, or refine the analysis before logging. The user either accepts what the AI says or starts over.

The main issue is that users can't validate nutritional numbers — nobody looks at "23g protein" and knows whether that's right. What users *can* validate is the text description: "one apple" when it should be two, "white rice" when it's actually quinoa. The conversation itself is the validation mechanism, not a confirmation table full of numbers.

### Goal

After the initial analysis, the user can optionally open an inline chat to refine the result before logging. The chat is ephemeral — it exists only to produce a better food log entry. Once logged, the conversation is gone.

### UX Flow

1. **Initial analysis** works exactly as today: snap photo and/or write description → AI analyzes → analysis card appears with results.
2. Below the analysis card, a **collapsed input hint** appears: *"Add details or correct something..."* — single line, subtle, not a full text area.
3. If the user taps **Log**, the food is logged immediately (current flow, unchanged).
4. If the user taps the **input hint**, the screen transforms into a chat:
   - The analysis card reflows into a chat bubble (first assistant message).
   - The input expands with a text field and an inline camera button.
   - A **Log** button stays pinned and always accessible.
   - A **Close** button (or X) is also available to abandon without logging.
5. The user can send text messages, attach new photos, or both.
6. Claude responds conversationally — short, focused replies. When the food list or quantities change, Claude confirms the updated analysis naturally in the conversation.
7. When the user taps **Log**, the latest agreed-upon food analysis is logged (same flow as current: nutrition dialog if needed, then the standard `FoodLogConfirmation` screen with "Done" → Home and "Log Another" to reset).
8. When the user taps **Close**, everything is discarded, back to Home.

### Chat Behavior Rules

1. **Claude always confirms what will be logged** — after any change to the food items or quantities, Claude's response should naturally include the updated summary. Not as a formal table, but conversationally: *"Got it — updated to 2 apples with peanut butter (~340 cal)."*
2. **Don't repeat unchanged information** — if the user asks a question and nothing about the food changed, Claude answers the question without re-listing the entire analysis.
3. **New photos add to the meal** — sending another photo mid-chat adds those items to the current meal, it doesn't replace the previous analysis.
4. **Text-only input works** — the user can describe food without photos: *"I also had a coffee with oat milk."* Claude incorporates it.
5. **Corrections override** — *"That's not rice, it's quinoa"* → Claude updates the analysis, confirms the change.
6. **Portion adjustments** — *"I only ate half"* → Claude halves the quantities, confirms.

### UI Details

- **Chat bubbles**: Standard message bubble layout (assistant left, user right). Assistant messages use the app's accent color.
- **Camera button**: Inline in the chat input bar, like messaging apps. Opens the same camera/gallery picker as the main analysis flow.
- **Log button**: Pinned at the bottom or top of the chat. Always visible. Just says "Log" — no calorie preview on the button (numbers the user can't validate add no value).
- **Close button**: Top-left X or alongside Log. Discards everything, returns to Home. No "are you sure?" confirmation.
- **Success feedback**: After logging, the standard `FoodLogConfirmation` screen is shown — same as the analyze and quick-select flows. "Done" navigates to Home, "Log Another" resets for a new entry.

### Architecture

- **Ephemeral chat state**: Conversation lives in client-side React state only. No persistence to DB. When the user logs or closes, it's gone.
- **Multi-turn Anthropic API**: The existing Claude `tool_use` flow extends from 1 turn to N turns. Each user message sends the full conversation history to the API.
- **Final log uses latest analysis**: When the user taps Log, the app uses the most recent `FoodAnalysis` result from the conversation (the last tool_use response that included food data).
- **No thread persistence**: No `chat_threads` table. The value is in the logging outcome, not the conversation history.
- **Auto-expire on navigation**: If the user leaves the screen (back button, app switch, etc.), the chat state is discarded. No resume.

### What This Enables

- **Corrections**: "That's quinoa, not rice" → re-analysis with correction.
- **Additions**: "I also had this" + new photo → adds to the same meal.
- **Partial logging**: "I only ate half" → adjusted portions.
- **Questions**: "How much protein is in this?" / "Is this a good post-workout meal?"
- **Multi-course meals**: Snap appetizer, then main, then dessert — all in one thread, logged as one meal.
- **Text-only logging**: "I had a turkey sandwich on whole wheat, about 6 inches" — no photo needed.

### Implementation Order

1. Refactor analysis result into a chat-compatible message format
2. Collapsed input hint UI below analysis card
3. Chat screen transition (analysis card → first chat bubble)
4. Multi-turn API integration (extend existing Claude flow)
5. Inline camera button in chat input
6. Log button reads latest analysis from conversation
7. Close/discard behavior
8. Post-log flow (reuse existing FoodLogConfirmation screen)

### Future Evolution: Smart Multi-Item Splitting & Library Reuse

Once the chat is stable, the model can suggest splitting a meal into multiple separate food log entries. Instead of logging "grilled chicken with rice, salad, and flan" as one monolithic food, Claude suggests: *"I'd log this as 2 items: (1) Grilled chicken with rice — matches one you've logged before (520 cal), (2) Flan — new (~280 cal). Sound good?"*

**Multi-item splitting:**
- Claude suggests splitting by courses/distinct items, not by ingredients. "Chicken with rice" stays together — it's one dish. But "chicken with rice AND a flan" is two.
- Claude suggests, user decides. Never auto-split. The user can say "keep it as one" or "actually split the chicken and rice too."
- Cap at ~4-5 entries per analysis. No micro-entries.
- The user can adjust splits during the chat: "combine those into one" or "separate the salad."

**Food library reuse:**
- Before creating a new food, Claude checks the existing custom foods library for matches.
- If "Grilled chicken with rice" already exists from a previous log, Claude reuses it instead of creating a duplicate.
- Claude tells the user which items are reused ("matches one you've logged before") vs. new estimates. Builds trust.
- This keeps the food library clean — no duplicates piling up — and makes quick-add more useful over time.

**Combined benefit:** After a few weeks the user has a curated library of actual foods they eat, at the right granularity. Quick-add becomes powerful: tomorrow you had the same lunch but no dessert — just quick-add the chicken with rice, skip the flan.

### Future Evolution: Contextual Memory from Food History

Claude can query the user's food log database during the chat to give contextual, personalized responses. Instead of treating every analysis in isolation, the model has access to what the user has eaten recently and can reference it naturally.

**Examples:**
- User says *"I had the same breakfast as Monday."* → Claude looks up Monday's breakfast log and pre-fills the analysis.
- User says *"This is like the chicken I had yesterday but without salt."* → Claude fetches yesterday's chicken entry, adjusts the sodium, confirms the change.
- User asks *"How much protein have I had today?"* → Claude sums today's logged entries and answers.

**How it works:**
- New Claude tools (e.g., `search_food_history`, `get_recent_logs`) let the model query `food_log_entries` and `custom_foods` during the conversation.
- These tools are **only triggered by user messages** in the chat — never during the initial analysis. The model doesn't preload history; it queries on demand when the user's message warrants a lookup.
- Results are injected into the conversation as tool responses, same as the analysis tools.

**What this enables:**
- Smarter portion estimates: "Last time you logged this plate it was 350g — does this look about the same?"
- Detecting patterns: "You've had this 3 times this week — want to save it to quick-select?"
- Answering nutrition questions grounded in real data, not generic estimates.

---

## Feature 2: Fasting Window & Date Navigation

### Problem

The daily dashboard (FOO-302 through FOO-306) shows today's nutrition totals, but there's no way to navigate between days or see fasting patterns. Users who practice intermittent fasting have no visibility into their eating windows.

### Goal

Add date navigation to the daily dashboard and a fasting window card that shows overnight fasting duration based on existing meal timestamps.

### Prerequisite

Daily dashboard must be implemented first (FOO-302 through FOO-306).

### Fasting Window

Projects overnight fasting duration based on meal timestamps already stored in `food_log_entries`:

- **Calculation:** Time from the last logged meal of the previous day to the first logged meal of the current day
- **Display:** Show as a card with fasting duration (e.g., "14h 30m fast") and the time range (e.g., "9:15 PM → 11:45 AM")
- **Edge cases:** If no meals logged for the previous or current day, show "No data" instead of guessing. If only one meal exists for a day, use it as both first and last.
- **No goal or threshold initially** — just display the data. A fasting goal feature can be added later if useful.

### Date Navigation

- **Date picker:** Swipe left/right or tap arrows to navigate between days
- **Today indicator:** Clear visual that shows when viewing today vs. a past date
- **Bounds:** Don't allow navigating to future dates. Earliest date is the first food log entry.

### Implementation Order

1. Fasting window card component (compute from existing meal timestamps)
2. Date navigation UI (swipe/tap between days)
3. Wire fasting card into daily dashboard
4. Update nutrition summary API to accept date parameter (if not already flexible enough)

---

## Feature 3: Weekly Nutrition View

### Problem

Daily totals show a snapshot but not trends. Users can't see if they're consistently hitting their calorie goals, whether protein is trending up, or how their fasting patterns look across the week.

### Goal

A weekly view showing 7-day nutrition trends with simple charts, macro averages, and fasting durations per day.

### Prerequisite

Daily dashboard (FOO-302 through FOO-306) and Feature 2 (Fasting Window & Date Navigation) should be implemented first.

### Views

#### Weekly Summary

- **Bar chart:** Calories per day with goal line overlay
- **Macro averages:** Average daily protein/carbs/fat over the week
- **Fasting durations:** Per-day fasting window alongside the calorie chart
- **Nutrient highlights:** Days where sodium or sugar exceeded recommended values (if we can determine thresholds)

#### Extended Nutrients Table (conditional)

Only shown when the user has logged foods with extended nutrient data (depends on FOO-298 through FOO-301):

- Fiber, sodium, saturated fat, trans fat, sugars — shown when data is available
- Daily totals with weekly averages

#### Micronutrient Report (conditional)

Only shown when the user has logged foods with extended nutrient data (depends on FOO-298 through FOO-301):

- Table of all non-null micronutrients with daily totals
- Percentage of daily recommended intake where applicable
- Only renders when there's data — no empty states for nutrients we don't have

### API Endpoint

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nutrition-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Range totals for weekly view |

### Design Notes

- **Mobile-first:** Charts are touch-friendly, cards stack vertically
- **Dark mode:** All charts must work in both light and dark themes
- **No charting library initially:** Use simple CSS-based bars (avoid bundle bloat). Graduate to a library only if the simple approach becomes limiting.
- **Loading states:** Skeleton cards while fetching data

### Implementation Order

1. API endpoint for date range nutrition summary
2. Weekly bar chart with CSS/SVG
3. Macro averages display
4. Fasting durations per day in weekly view
5. Extended nutrients table (depends on FOO-298 through FOO-301)
6. Micronutrient report (depends on FOO-298 through FOO-301)

---

## Feature 4: Offline Queue with Background Sync

### Problem

The app is a PWA but has no service worker. Without connectivity (subway, traveling, spotty rural signal), the app is completely unusable. Food logging happens at meal time, not when you're conveniently on Wi-Fi.

### Goal

Queue food photos and descriptions locally when offline, then analyze and log them when connectivity returns. The user should never lose a meal entry because they didn't have signal.

### Architecture

- **Service Worker:** Cache the app shell (HTML, JS, CSS, icons) for offline access, intercept failed API requests, and trigger background sync when connectivity returns.
- **Local Storage:** Use IndexedDB to store queued photos as blobs, text descriptions, timestamps, meal type selections, and sync status (pending, analyzing, logging, done, failed).

### User Flow

#### Online (no change)
Normal flow — photo → analyze → confirm → log.

#### Offline — New Entry
1. User opens app (served from cache)
2. Takes photo, adds description, picks meal type
3. Taps "Analyze" — app detects offline
4. Entry saved to IndexedDB with status `pending`
5. UI shows "Saved — will analyze when online" with a queued badge
6. User can continue adding more entries

#### Coming Back Online
1. Service worker detects connectivity (`online` event or periodic check)
2. Processes queue in order: upload photo → analyze → present result
3. Queue items update status as they progress

### Confirmation Strategy

Two options — user picks in Settings:

- **Auto-log (default for high confidence):** If Claude returns `confidence: high`, log automatically. Show a notification with the result and an "Undo" button (delete from Fitbit within 30 seconds).
- **Hold for review:** All queued items wait in a "Pending Review" screen. User confirms each one. Safer but requires user action.

### Queue UI

- **Badge on bottom nav:** Shows count of pending items
- **Queue screen:** Accessible from the badge or a dedicated section. Shows each queued entry with photo thumbnail, description, status, and timestamp.
- **Swipe to delete:** Remove queued items before they sync

### Cached Assets

The service worker should cache the app shell (all routes under `/app`) and static assets (JS bundles, CSS, icons, fonts), but NOT API responses (food data is always dynamic). Use a **stale-while-revalidate** strategy for the shell.

### Implementation Order

1. Service worker registration + app shell caching
2. IndexedDB queue for photos and descriptions
3. Offline detection in the analyze flow
4. Queue UI (badge + pending screen)
5. Background sync on reconnection
6. Auto-log vs hold-for-review setting
7. Notification for auto-logged items

### Limitations

- Claude analysis requires network — cannot run on-device. Queued items show as "waiting to analyze," not with nutrition data.
- Fitbit logging requires network — entries are queued, not logged.
- Photos stored as blobs in IndexedDB may use significant storage. Cap at ~20 queued entries and warn the user.
- Service worker updates need a reload to take effect — standard PWA behavior.
