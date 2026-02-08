# Food Scanner - Roadmap

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

#### Types (`src/types/index.ts`)

Add optional extended nutrient fields to `FoodAnalysis`:

```typescript
export interface FoodAnalysis {
  // ... existing required fields ...

  // Tier 1 extensions (always attempted)
  saturated_fat_g?: number | null;
  trans_fat_g?: number | null;
  sugars_g?: number | null;
  calories_from_fat?: number | null;

  // Tier 2 (label only)
  cholesterol_mg?: number | null;
  potassium_mg?: number | null;
  calcium_g?: number | null;
  iron_mg?: number | null;
  vitamin_a_iu?: number | null;
  vitamin_c_mg?: number | null;
  vitamin_d_iu?: number | null;

  // Tier 3 (label only, rare)
  vitamin_b6_mg?: number | null;
  vitamin_b12_mcg?: number | null;
  vitamin_e_iu?: number | null;
  magnesium_mg?: number | null;
  zinc_mg?: number | null;
  phosphorus_g?: number | null;
  copper_g?: number | null;
  thiamin_mg?: number | null;
  riboflavin_mg?: number | null;
  niacin_mg?: number | null;
  folic_acid_mg?: number | null;
  biotin_mg?: number | null;
  pantothenic_acid_mg?: number | null;
  iodine_mcg?: number | null;
}
```

All extended fields are optional and nullable. Existing code that only reads the 6 core fields continues to work without changes.

#### Claude Tool Schema (`src/lib/claude.ts`)

Expand `REPORT_NUTRITION_TOOL` input_schema to include extended nutrient properties. Update the system prompt to instruct Claude:
- When a nutrition label is visible, extract all printed nutrients
- When no label, only estimate Tier 1
- Use `null` for unknown, `0` for confirmed-zero

#### Fitbit API (`src/lib/fitbit.ts`)

Expand `createFood()` to pass extended nutrients when available. Only include non-null values in the URLSearchParams.

#### Database (`src/db/schema.ts`)

Add nullable columns to `custom_foods` for each extended nutrient. This allows food matching to reuse the full nutrient profile.

#### UI — Nutrition Facts Card (`src/components/nutrition-facts-card.tsx`)

Show extended nutrients when available. Group into sections:
- **Core:** Calories, Fat (Saturated, Trans), Carbs (Fiber, Sugars), Protein, Sodium
- **Vitamins & Minerals:** Only shown when at least one has a value

#### Food Matching (`src/lib/food-matching.ts`)

Extend nutrient tolerance matching to include Tier 1 extensions (saturated fat, trans fat, sugars). Tier 2+ nutrients are not used for matching.

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

Pull from Fitbit's time series API (`/1/user/-/foods/log/caloriesIn.json`, etc.) and from our own `food_log_entries` + `custom_foods` tables. Fitbit time series gives us the official daily totals (including foods logged outside our app). Our DB gives us per-entry detail and the extended nutrients Fitbit doesn't expose in its time series.

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

#### Micronutrient Report (conditional)

Only shown when the user has logged foods with extended nutrient data (from Feature 1):

- Table of all non-null micronutrients with daily totals
- Percentage of daily recommended intake where applicable
- Only renders when there's data — no empty states for nutrients we don't have

### Navigation

Add a dashboard icon to the bottom navigation bar. The current bottom nav has:
- Home (quick select)
- Camera (analyze)
- History
- Settings

New layout:
- Home (quick select)
- Camera (analyze)
- Dashboard (new)
- History
- Settings

### API Endpoints

**New endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/nutrition-summary?date=YYYY-MM-DD` | Daily totals from our DB (includes extended nutrients) |
| GET | `/api/nutrition-summary?from=YYYY-MM-DD&to=YYYY-MM-DD` | Range totals for weekly view |

These aggregate from our `food_log_entries` joined with `custom_foods`. We use our own DB rather than Fitbit's time series because:
1. We store extended nutrients that Fitbit doesn't expose in time series
2. Faster than making multiple Fitbit API calls
3. Works even if Fitbit is temporarily down

Fitbit daily goals are fetched separately via the existing MCP/API for the calorie ring target.

### Design Notes

- **Mobile-first:** Cards stack vertically, charts are touch-friendly
- **Dark mode:** All charts must work in both light and dark themes
- **No charting library initially:** Use simple CSS-based bars and rings (avoid bundle bloat). Graduate to a library (e.g., Recharts) only if the simple approach becomes limiting.
- **Loading states:** Skeleton cards while fetching data
- **Empty state:** Friendly message when no food logged for the day, with a CTA to scan food

### Implementation Order

1. API endpoint for daily nutrition summary (aggregate from DB)
2. Daily summary page with calorie ring + macro bars
3. Bottom nav update (add dashboard tab)
4. Extended nutrients section (depends on Feature 1)
5. Date navigation (swipe/tap)
6. API endpoint for date range
7. Weekly view with simple charts
8. Micronutrient report (depends on Feature 1 Tier 2+)

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

**Service Worker:** Register a service worker for:
1. Caching the app shell (HTML, JS, CSS, icons) for offline access
2. Intercepting failed `/api/analyze-food` and `/api/log-food` requests
3. Background sync when connectivity returns

**Local Storage:** Use IndexedDB (via `idb` or similar lightweight wrapper) to store:
- Queued photos as blobs
- Text descriptions
- Timestamps and meal type selections
- Sync status (pending, analyzing, logging, done, failed)

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
2. Processes queue in order:
   - Upload photo → analyze → show result as notification or in-app queue
   - **Decision point:** Auto-log with AI results, or hold for user confirmation?
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

The service worker should cache:
- App shell (all routes under `/app`)
- Static assets (JS bundles, CSS, icons, fonts)
- NOT API responses (food data is always dynamic)

Use a **stale-while-revalidate** strategy for the shell — serve from cache, update in background.

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

---

## Implementation Priority

**Phase 1 — Extended Nutrition, Tier 1:**
Feature 1 steps 1-5 (Tier 1 nutrients end-to-end)

**Phase 2 — Dashboard, Core:**
Feature 2 steps 1-5 (daily view with current + Tier 1 nutrients)

**Phase 3 — Offline Support:**
Feature 3 steps 1-7 (service worker, queue, background sync)

**Phase 4 — Extended Nutrition, Tier 2+:**
Feature 1 steps 6-7 (full label extraction)

**Phase 5 — Dashboard, Weekly + Micro:**
Feature 2 steps 6-8 (weekly trends, micronutrient report)
