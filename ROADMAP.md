# Food Scanner - Ideas

## Contents

| Feature | Summary |
|---------|---------|
| [Smart Multi-Item Splitting](#smart-multi-item-splitting) | Split complex meals into reusable food library entries |
| [Offline Queue with Background Sync](#offline-queue-with-background-sync) | Queue meals offline, analyze and log when back online |
| [Food Log Push Notifications](#food-log-push-notifications) | Push nutrition data directly to Health Connect via a thin Android wrapper |
| [Quick Capture Session](#quick-capture-session) | Snap photos quickly at meals, triage with AI later, log individually from Saved for Later |

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

## Food Log Push Notifications

### Problem

The HealthHelper Android app syncs food log data from Food Scanner via periodic WorkManager polling (15–120 minute interval). After logging a meal in Food Scanner, the data doesn't reach Health Connect until the next scheduled sync — up to two hours later. There's no real-time feedback that the log was picked up.

### Prerequisites

- HealthHelper Android app (already built — Kotlin, Jetpack Compose, Health Connect SDK, WorkManager periodic sync via `GET /api/v1/food-log`)

### Goal

Send a push notification to HealthHelper the moment food is logged in Food Scanner, triggering an immediate Health Connect sync so nutrition data appears within seconds.

### Design

#### Notification Flow

1. User logs food in Food Scanner (PWA or API).
2. `POST /api/log-food` completes successfully (Fitbit + DB).
3. Food Scanner sends an FCM push to the registered device token.
4. HealthHelper receives the push — either in foreground or background.
5. HealthHelper enqueues a one-shot `SyncWorker` that calls `SyncNutritionUseCase` immediately.
6. Health Connect gets the new `NutritionRecord` within seconds.

#### Notification Content

The push is a **data-only message** (no visible notification) — the goal is to trigger a sync, not to show a banner. HealthHelper already handles the sync and can optionally show a local notification after a successful write.

Payload:

```json
{
  "data": {
    "type": "food_logged",
    "date": "2026-02-28",
    "entryId": "123"
  }
}
```

The `date` field lets HealthHelper sync only the affected day instead of the full backfill window.

#### Fallback

The periodic WorkManager sync remains as a fallback. Push notifications are best-effort — if FCM delivery fails (device offline, token expired), the next scheduled sync picks up the entry. No data is lost.

#### Device Registration

1. HealthHelper requests `POST_NOTIFICATIONS` permission (Android 13+) and registers with FCM.
2. `FirebaseMessagingService.onNewToken()` fires with a device token.
3. HealthHelper sends the token to Food Scanner via a new `POST /api/v1/devices` endpoint (Bearer API key auth).
4. Food Scanner stores the token in a new `device_tokens` table.
5. On token rotation (app update, FCM refresh), HealthHelper re-registers automatically.

### Architecture

#### Food Scanner (Server Side)

- **`firebase-admin` SDK:** Initialize once in `src/lib/firebase.ts` with service account credentials from env vars (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`).
- **New DB table:** `device_tokens` — `id`, `userId`, `token` (text, unique), `platform` (text, default `'android'`), `createdAt`, `updatedAt`. One user can have multiple device tokens (phone + tablet).
- **New API route:** `POST /api/v1/devices` — registers or updates a device token. Bearer API key auth (same as other v1 routes). Upserts on token value.
- **New API route:** `DELETE /api/v1/devices/:token` — removes a token (device unregistered or user logs out of HealthHelper).
- **Notification dispatch:** New `sendFoodLoggedNotification(userId, entryId, date)` in `src/lib/notifications.ts`. Fetches all device tokens for the user, sends FCM data messages. Handles `messaging/registration-token-not-registered` errors by deleting stale tokens.
- **Trigger point:** Called at the end of `POST /api/log-food` after successful Fitbit log + DB write. Fire-and-forget — notification failure never blocks the API response.

#### HealthHelper (Android Side)

- **Firebase SDK:** Add `com.google.firebase:firebase-messaging` dependency. Register `FoodScannerMessagingService` in manifest.
- **Token management:** `onNewToken()` → POST to `POST /api/v1/devices` with the stored API key.
- **Message handling:** `onMessageReceived()` → extract `type`, `date`, `entryId` from data payload → enqueue a one-shot `SyncWorker` constrained to `NetworkType.CONNECTED`, targeting only the specified date.
- **Permissions:** Add `POST_NOTIFICATIONS` (API 33+) to manifest. Request at runtime during onboarding or settings.

### Edge Cases

- Device token expires or rotates → `onNewToken()` re-registers automatically. Server-side, `NotRegistered` errors trigger token cleanup.
- Multiple devices registered → FCM message sent to all tokens. Each device syncs independently; Health Connect `clientRecordId` deduplication prevents duplicate records.
- App force-stopped or device rebooted → FCM high-priority data messages wake the app. If delivery still fails, periodic sync is the safety net.
- `firebase-admin` and Next.js Edge Runtime are incompatible → all API routes in `src/app/api/` use the Node.js runtime by default, so no issue.
- Food Scanner deployed without Firebase credentials → notification dispatch silently skips (log a warning). All other functionality unaffected.
- HealthHelper not installed or no token registered → no tokens in DB, nothing to send. No error.
- Dry-run mode (`FITBIT_DRY_RUN=true`) → still send notifications so staging can test the full flow.

### Implementation Order

1. Firebase project setup + service account credentials in env vars
2. `device_tokens` DB table (Drizzle schema + migration)
3. `POST /api/v1/devices` and `DELETE /api/v1/devices/:token` endpoints
4. `src/lib/notifications.ts` — FCM dispatch with stale token cleanup
5. Integrate notification dispatch into `POST /api/log-food` (fire-and-forget)
6. HealthHelper: Firebase SDK + `FoodScannerMessagingService` + token registration
7. HealthHelper: one-shot `SyncWorker` triggered by push data message

---

## Quick Capture Session

### Problem

Logging food at a restaurant requires the full analyze→refine→confirm→log cycle for each item. A multi-course meal means pulling out the phone, waiting for AI analysis, reviewing results, and confirming — multiple times, while people are talking and food is getting cold. The current flow demands attention at precisely the moment you don't want to give it.

### Goal

Let the user quickly snap photos and jot notes during a meal with minimal friction, then process everything into proper food log entries later when they have time.

### Design

#### Quick Capture Flow (at the restaurant)

1. Tap "Quick Capture" on the dashboard.
2. Camera opens immediately — snap photo(s) → optionally type a short note (e.g., "shared appetizer, had about half") → tap Save.
3. Capture is compressed (existing `compressImage()` + HEIC conversion) and persisted to IndexedDB immediately. Timestamp recorded automatically from the device clock.
4. Camera auto-re-triggers for the next capture. Repeat throughout the meal.
5. Tap "Done" to return to the dashboard.

**Each capture should take under 5 seconds.** No server interaction, no AI processing, no uploads. Just persist locally.

A capture consists of:
- 1–9 images (same constraints as current analyze flow, compressed before storage)
- Optional text note (max 2000 chars)
- Auto-recorded timestamp
- Sequential order within the session

Only one capture session at a time. Starting a new session while captures exist navigates to the existing one.

#### Capture Expiry

Captures expire after **7 days**, matching the existing `useAnalysisSession` expiry. Cleanup runs on app mount. A toast notification informs the user when captures are removed ("2 captures expired").

#### Dashboard Integration

When captures exist, a banner appears on the dashboard: *"N captures ready to process"*. Tapping it opens the capture list. The "Quick Capture" button changes to "Add Capture" to continue the session.

#### Processing Flow (at home)

Processing happens in two stages: **triage** (what items exist) and **per-item logging** (exact nutrition and Fitbit sync).

**Stage 1 — Triage Chat:**

1. User taps "Process Captures" from the capture list.
2. All images and notes are uploaded and sent to Claude in a single conversation, organized by capture with timestamps.
3. Claude proposes a list of identified food items:

   > *"I see 5 captures from 8:30 PM to 10:15 PM. From the menu and plate photos, here's what I'd log:*
   > 1. *Bruschetta (shared, half portion) — ~180 cal — 8:45 PM — Dinner*
   > 2. *Grilled salmon with vegetables — ~620 cal — 9:10 PM — Dinner*
   > 3. *Tiramisu — ~340 cal — 9:50 PM — Dinner*
   >
   > *The menu helped me identify the salmon dish. Want me to adjust anything?"*

4. User refines via chat — structural changes only:
   - *"Combine the chicken and rice into one entry"*
   - *"Remove the bread, I didn't eat it"*
   - *"You missed dessert — we shared a flan, I had about a third"*
   - *"The tiramisu was actually taken home, I ate it the next day for lunch"*
5. Claude updates the proposed list. Each item includes full nutrition estimation (name, calories, macros, confidence) and a time derived from the capture timestamp.
6. When the user approves the list, each item becomes a **Saved Analysis** via the existing `saved_analyses` infrastructure.
7. Captures are cleared from IndexedDB.

**Stage 2 — Per-Item Logging:**

Each item appears in the Saved for Later section on the dashboard. From there, the existing flow handles everything:
- View full nutrition details
- Refine via chat ("it was about 400g, not 300g")
- Choose meal type and time (pre-filled from triage, adjustable)
- Log to Fitbit
- Or discard

Items are fully independent — log some now, others tomorrow, discard any you don't want.

#### Time Assignment

Each food item inherits the timestamp of the capture it's most associated with. Unlike the normal analyze flow (where time is only set when the user mentions it), Quick Capture defaults to the capture timestamp — the phone already knows when each photo was taken. The user can override during triage or when logging.

Special cases:
- **One capture, multiple items** (e.g., a table photo with three plates): all items get the same capture timestamp.
- **Context-only captures** (e.g., menu photos): no time assigned — these inform analysis but don't represent a food item.
- **Time overrides** (e.g., "I ate the tiramisu the next day"): adjusted during triage chat, carried into the Saved Analysis.

#### Image Budget

Claude's API supports up to 100 images per message. A typical restaurant session of 5 captures × 2 images = 10 images — well within limits. At the per-capture limit of 9 images, even a maxed-out session of 9 captures × 9 images = 81 images stays under the API ceiling. No image selection or prioritization logic needed.

### Architecture

- **Capture storage:** IndexedDB on the client. Images stored as compressed blobs (JPEG, post-`compressImage()`), notes and timestamps as structured data. Reuse the `idb-keyval` pattern from `useAnalysisSession`. Expiry: 7 days, checked on mount. IndexedDB quotas are a non-issue — minimum ~500MB (Safari), typical ~60% of disk (Chrome). A maxed session (9 captures × 9 images × ~200KB) is ~16MB.
- **No new DB tables.** Capture state is client-only. Triage results flow into the existing `saved_analyses` table.
- **Triage API:** New `/api/process-captures` endpoint. Accepts all images and notes, builds a structured prompt with captures organized chronologically, streams Claude's response. The conversation continues via existing `/api/chat-food` for refinements.
- **New Claude tool:** `report_session_items` — returns an array of food items (each with name, full nutrition, time, meal type, confidence). Replaces `report_nutrition` during triage only. On user approval, each item is saved as a Saved Analysis via `POST /api/saved-analyses`.
- **No batch logging.** Each Saved Analysis is logged individually through the existing flow. No atomic multi-entry creation, no Fitbit rollback complexity.
- **Image upload:** Blobs read from IndexedDB, sent as FormData to the triage endpoint. No server-side image persistence — once Claude processes them, they're not stored.

### Edge Cases

- **App closed mid-capture (photo taken, save not tapped):** The photo is lost — only saved captures persist. The save action must be obvious and instant.
- **Processing interrupted (app closed mid-triage):** Captures remain in IndexedDB. User re-processes from scratch — the triage chat is not persisted, but the raw captures are safe.
- **Captures expire:** Toast notification on next app open. No silent deletion.
- **Empty captures:** User starts capturing but adds zero items, then tries to process. Disable the "Process Captures" button.
- **Single capture:** Works fine — triage with one capture is just a normal analysis that outputs a Saved Analysis instead of logging directly. Slightly longer path than the regular flow, but consistent.
- **Capture while offline:** Captures save to IndexedDB without network. Processing requires connectivity (Claude API). The capture phase works offline by nature.
- **Abort confirmation:** Clearing all captures requires confirmation — the images and notes are gone forever.

### Implementation Order

1. IndexedDB capture storage (compressed blobs, notes, timestamps, 7-day expiry cleanup)
2. Quick Capture UI: camera auto-trigger, capture list, dashboard banner
3. `report_session_items` Claude tool and triage system prompt
4. `/api/process-captures` endpoint with streaming response
5. Triage chat UI: proposed item list, chat refinement, approve-to-save flow
6. Integration with existing Saved Analyses (bulk save from triage results)

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
