# Food Scanner - Roadmap

## Feature 0: Conversational Analysis (Chat Refinement)

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
7. When the user taps **Log**, the latest agreed-upon food analysis is logged (same flow as current: nutrition dialog if needed, then logged and back to Home).
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
- **Success feedback**: After logging, a brief toast with the food names (not numbers): *"Logged: 2 apples, peanut butter"*.

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
8. Success toast with food names

---

## Feature 1: Extended Nutrition Tracking

### Problem

We currently track only 6 nutrients (calories, protein, carbs, fat, fiber, sodium). Fitbit's API accepts 30+ nutritional fields. When a user photographs a packaged food with its nutrition label, we throw away most of the printed information. Argentine labels (Mercosur Res. GMC 46/03) already mandate saturated fat, trans fat, and energy in kJ — data we currently ignore.

### Goal

Extract and log all visible nutrients from food photos, especially from nutrition labels on packaged products. For non-label photos (a plate of food), continue estimating the core nutrients without inventing micronutrient values.

### Nutrient Tiers

Nutrients are grouped by how reliably they can be extracted.

**Tier 1 — Always extracted (current + Argentine label mandatory fields):**

| Nutrient | Fitbit API param | Unit | Currently tracked |
|----------|-----------------|------|-------------------|
| Calories | `calories` | kcal | Yes |
| Protein | `protein` | g | Yes |
| Total Carbs | `totalCarbohydrate` | g | Yes |
| Total Fat | `totalFat` | g | Yes |
| Dietary Fiber | `dietaryFiber` | g | Yes |
| Sodium | `sodium` | mg | Yes |
| Saturated Fat | `saturatedFat` | g | **No** |
| Trans Fat | `transFat` | g | **No** |
| Sugars | `sugars` | g | **No** |
| Calories from Fat | `caloriesFromFat` | kcal | **No** |

Tier 1 nutrients map to the mandatory fields on Argentine nutrition labels (Información Nutricional per Mercosur). Claude should always attempt to return these, falling back to estimation for non-label photos. `sugars` and `caloriesFromFat` are not mandatory on Argentine labels but are common enough on imported products and trivially derivable.

**Tier 2 — Extract when visible on label:**

| Nutrient | Fitbit API param | Unit |
|----------|-----------------|------|
| Cholesterol | `cholesterol` | mg |
| Potassium | `potassium` | mg |
| Calcium | `calcium` | g |
| Iron | `iron` | mg |
| Vitamin A | `vitaminA` | IU |
| Vitamin C | `vitaminC` | mg |
| Vitamin D | `vitaminD` | IU |

These appear on many labels (especially US-style imports and supplements) but are not mandatory on Argentine labels. Claude should only include them if clearly visible — never estimate micronutrients from a photo of a plate.

**Tier 3 — Extract when visible on label (rare):**

| Nutrient | Fitbit API param | Unit |
|----------|-----------------|------|
| Vitamin B6 | `vitaminB6` | mg |
| Vitamin B12 | `vitaminB12` | mcg |
| Vitamin E | `vitaminE` | IU |
| Magnesium | `magnesium` | mg |
| Zinc | `zinc` | mg |
| Phosphorus | `phosphorus` | g |
| Copper | `copper` | g |
| Thiamin | `thiamin` | mg |
| Riboflavin | `riboflavin` | mg |
| Niacin | `niacin` | mg |
| Folic Acid | `folicAcid` | mg |
| Biotin | `biotin` | mg |
| Pantothenic Acid | `pantothenicAcid` | mg |
| Iodine | `iodine` | mcg |

These are uncommon on everyday products. Only extracted when explicitly printed on the label.

### Behavior Rules

1. **Label photos:** Extract every nutrient visible on the label. Confidence should be `high` for clearly readable values. Argentine labels show values per 100g and per serving — use the **per serving** values, or let the user pick.
2. **Non-label photos (plate of food):** Return Tier 1 nutrients only. Never guess micronutrients from visual estimation.
3. **Mixed photos (food + label visible):** Prefer label data over visual estimation.
4. **Null means unknown:** Extended nutrients use `null` when not available, not `0`. Zero means "this food contains none of this nutrient." Null means "we don't know."

### Changes Required

- Add optional extended nutrient fields (nullable) to `FoodAnalysis` type. All extended fields are optional so existing code continues to work.
- Expand the Claude tool schema to include extended nutrient properties and instruct Claude on tier-based extraction rules.
- Expand `createFood()` in the Fitbit client to pass extended nutrients when available (only non-null values).
- Add nullable columns to `custom_foods` DB table for each extended nutrient to support food matching with full nutrient profiles.
- Update the Nutrition Facts Card UI to show extended nutrients grouped into Core and Vitamins & Minerals sections.
- Extend food matching nutrient tolerance to include Tier 1 extensions (saturated fat, trans fat, sugars). Tier 2+ nutrients are not used for matching.

### Implementation Order

1. Types + Claude tool schema (Tier 1 first)
2. Fitbit `createFood()` expansion
3. DB schema migration (nullable columns)
4. Nutrition Facts Card UI
5. Food matching updates
6. Types + Claude tool schema (Tier 2 & 3)
7. Testing with real Argentine product labels

---

## Feature 2: Daily Nutrition Dashboard

### Problem

The app currently shows food log history as a list of individual entries. There's no way to see daily totals, track nutrient intake over time, or understand patterns. Fitbit tracks daily aggregates via its time series API, but users have to open the Fitbit app to see them.

### Goal

A dashboard view showing daily and weekly nutrition summaries, with emphasis on the nutrients we now track (including the extended set from Feature 1). Mobile-first design, accessible from the bottom navigation.

### Data Source

Pull from Fitbit's time series API and from our own `food_log_entries` + `custom_foods` tables. Fitbit time series gives us the official daily totals (including foods logged outside our app). Our DB gives us per-entry detail and the extended nutrients Fitbit doesn't expose in its time series.

### Views

#### Daily Summary (default view)

Shows today's nutrition totals:

- **Calorie ring:** Visual progress toward daily goal (from Fitbit food goals API)
- **Macro bars:** Protein / Carbs / Fat as horizontal progress bars with gram amounts
- **Extended nutrients table:** Fiber, sodium, saturated fat, trans fat, sugars — shown when data is available
- **Meal breakdown:** Collapsible sections per meal type (Breakfast, Lunch, Dinner, Snacks) showing individual entries
- **Date picker:** Swipe left/right or tap to navigate between days

#### Weekly View

Shows 7-day trends:

- **Line/bar chart:** Calories per day (bar) with goal line
- **Macro averages:** Average daily protein/carbs/fat over the week
- **Nutrient highlights:** Days where sodium or sugar exceeded recommended values (if we can determine thresholds)

#### Fasting Window

Projects overnight fasting duration based on meal timestamps already stored in `food_log_entries`:

- **Calculation:** Time from the last logged meal of the previous day to the first logged meal of the current day
- **Daily Summary display:** Show as a card with fasting duration (e.g., "14h 30m fast") and the time range (e.g., "9:15 PM → 11:45 AM")
- **Weekly View display:** Show fasting durations per day alongside the calorie chart, so the user can see patterns
- **Edge cases:** If no meals logged for the previous or current day, show "No data" instead of guessing. If only one meal exists for a day, use it as both first and last.
- **No goal or threshold initially** — just display the data. A fasting goal feature can be added later if useful.

#### Micronutrient Report (conditional)

Only shown when the user has logged foods with extended nutrient data (from Feature 1):

- Table of all non-null micronutrients with daily totals
- Percentage of daily recommended intake where applicable
- Only renders when there's data — no empty states for nutrients we don't have

### Navigation

Add a dashboard icon to the bottom navigation bar. New layout:
- Home (quick select)
- Camera (analyze)
- Dashboard (new)
- History
- Settings

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nutrition-summary?date=YYYY-MM-DD` | Daily totals from our DB (includes extended nutrients) |
| GET | `/api/nutrition-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Range totals for weekly view |

These aggregate from our `food_log_entries` joined with `custom_foods`. We use our own DB rather than Fitbit's time series because we store extended nutrients that Fitbit doesn't expose, it's faster than multiple Fitbit API calls, and it works even if Fitbit is temporarily down.

### Design Notes

- **Mobile-first:** Cards stack vertically, charts are touch-friendly
- **Dark mode:** All charts must work in both light and dark themes
- **No charting library initially:** Use simple CSS-based bars and rings (avoid bundle bloat). Graduate to a library only if the simple approach becomes limiting.
- **Loading states:** Skeleton cards while fetching data
- **Empty state:** Friendly message when no food logged for the day, with a CTA to scan food

### Implementation Order

1. API endpoint for daily nutrition summary (aggregate from DB)
2. Daily summary page with calorie ring + macro bars
3. Bottom nav update (add dashboard tab)
4. Fasting window card (uses existing meal timestamps)
5. Extended nutrients section (depends on Feature 1)
6. Date navigation (swipe/tap)
7. API endpoint for date range
8. Weekly view with simple charts + fasting durations
9. Micronutrient report (depends on Feature 1 Tier 2+)

### Dependencies

- Feature 1 (Extended Nutrition Tracking) is NOT a hard blocker — the dashboard works with the current 6 nutrients. But the extended nutrients section and micronutrient report require Feature 1 to be useful.
- Fitbit food goals API integration (for calorie target in the ring).

---

## Feature 3: Offline Queue with Background Sync

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
