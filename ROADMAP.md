# Food Scanner - Ideas

## Contents

| Feature | Summary |
|---------|---------|
| [Smart Multi-Item Splitting](#smart-multi-item-splitting) | Split complex meals into reusable food library entries |
| [Offline Queue with Background Sync](#offline-queue-with-background-sync) | Queue meals offline, analyze and log when back online |
| [Food Log Push Notifications](#food-log-push-notifications) | Push nutrition data directly to Health Connect via a thin Android wrapper |
| [Automated Lumen RQ Ingestion](#automated-lumen-rq-ingestion) | Pull daily RQ readings from Lumen's private API as an independent trend metric |
| [Calorie Target Formula Review](#calorie-target-formula-review) | Reassess deficit/surplus model — currently flat ±20% / +10%, ignores Fitbit's target weight |

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

## Automated Lumen RQ Ingestion

### Problem

The Lumen device measures RQ (respiratory quotient), a useful fuel-oxidation biomarker. Lumen has no public API, and its Apple Health / Google Fit bridge writes only derived calories — not RQ. The user wants RQ tracked passively alongside (not driving) macro goals, without manual entry.

### Prerequisites

- Self-Calculated Macro Goals (Lumen screenshot flow removed, macro engine replaces it — RQ must be fully decoupled from goal computation)

### Goal

Pull daily RQ readings from Lumen's private API into Food Scanner as an independent trend metric. RQ never influences macro targets — it's a read-only biomarker surfaced for the user's own interpretation.

### Design

#### Token Capture

Lumen's app authenticates to `api.lumen.me` with a long-lived bearer token. A one-time manual capture via mitmproxy (phone paired with the Lumen app) produces the token, which is pasted into a settings field and stored encrypted server-side. A short operator doc walks through the capture steps. No in-app capture flow — this is accepted manual overhead.

#### Daily Sync

A scheduled job runs once daily (07:00 local) and fetches the user's recent readings from the Lumen history endpoint. New readings are inserted into `rq_readings`. Idempotent on `(userId, timestamp)`.

#### Dashboard Surface

A small RQ trend card on the dashboard shows the last 7 and 30 days as a sparkline. Tap reveals individual readings with the derived level (1–5). No coupling to macro bars, no "nudges", no influence on targets.

#### Failure Modes

- Token expired or rotated → sync job fails; dashboard card shows "RQ sync broken — recapture token" with a link to settings. Macro engine unaffected.
- Lumen app update breaks the endpoint → same visible failure mode.
- No reading on a given day → gap in the chart, no fill-in.

### Architecture

- **New table**: `external_tokens` — `userId`, `provider` (`'lumen'`), `tokenEncrypted`, `createdAt`, `updatedAt`. Extensible to other private-API integrations later.
- **New table**: `rq_readings` — `userId`, `timestamp` (UTC), `rq` (numeric), `level` (1–5 int), `createdAt`. Unique `(userId, timestamp)`.
- **New lib module**: `src/lib/lumen-rq.ts` — bearer-auth client for Lumen history endpoint with runtime validation of response shape.
- **Cron**: Railway scheduled task invoking a new `/api/cron/sync-lumen-rq` route (API-key-protected). Logs failures to Sentry; does not retry aggressively.
- **Settings**: token input field (write-only; masked once saved) + last-sync timestamp + "Resync now" button.

### Edge Cases

- Token encryption key rotation → re-encrypt on next cron run; failures logged, not surfaced unless sync fails.
- Multiple devices per account → not expected (single user, single Lumen); ignore for now.
- Lumen data includes future/backfilled readings → accept all; idempotent insert handles duplicates.
- User never captures a token → dashboard card is hidden; no warning, fully opt-in.

### Implementation Order

1. `external_tokens` and `rq_readings` schemas + Drizzle migration
2. Token encryption helpers (reuse existing app encryption patterns or introduce a minimal one)
3. `src/lib/lumen-rq.ts` client with fixture-based unit tests
4. `/api/cron/sync-lumen-rq` route + Railway cron wiring
5. Settings UI: token input, last-sync, resync button
6. Dashboard: RQ trend sparkline card (hidden when no token)
7. Operator doc for mitmproxy token capture

---

## Calorie Target Formula Review

### Problem

The calorie target is computed as `TDEE × {0.80 LOSE / 1.00 MAINTAIN / 1.10 GAIN}`. The multiplier depends only on Fitbit's `goalType` *direction* — the user's actual target weight (`goal.weight`), starting weight (`goal.startWeight`), and any timeline are ignored. A user with 2 kg to lose gets the same 20% deficit as a user with 50 kg to lose. The flat coefficients are not derived from any per-user input beyond direction, and there is no surfacing of how aggressive the deficit/surplus is.

### Goal

A calorie target whose deficit or surplus is *informed by* the user's target weight and a sensible weekly rate, with the model and assumptions visible in the audit so the user can sanity-check the math.

### Design

To be fleshed out. Open questions to resolve:

- Should deficit derive from `(currentWeight − targetWeight)` over a default weekly rate (e.g., 0.5 kg/week ≈ 500 kcal/day deficit), capped at sane bounds (e.g., never below RMR × 1.0)?
- Should the user be able to override the deficit aggressiveness (conservative / moderate / aggressive) per macro profile, or globally?
- For GAIN, what's the analogous rate (e.g., +0.25 kg/week)?
- How does the model handle "MAINTAIN at a target weight different from current weight" (Fitbit allows this)?
- How are floors enforced (never below RMR, never below sex-specific minimums)?
- What does the audit display so the user understands the chosen deficit?

### Architecture

- Engine module: `src/lib/macro-engine.ts` — replace `GOAL_MULTIPLIERS` with a richer derivation that takes target weight + timeline into account.
- Engine inputs: `MacroEngineInputs` extended with `targetWeightKg` and possibly `weeklyRateKg`.
- Fitbit weight-goal client: `src/lib/fitbit.ts:703-747` already fetches the goal but extracts only `goalType`. Extend `FitbitWeightGoal` to include `weight` and `startWeight` (already returned by the API; just unused).
- Audit: include the chosen deficit/surplus delta and rate so the formula is transparent.

### Edge Cases

- User has no target weight set in Fitbit → fall back to current direction-only model.
- Target weight equals current weight + LOSE direction → contradictory; treat as MAINTAIN.
- Implausible rate (>1 kg/week sustained) → clamp and surface a warning in the audit.
- Goal type mid-day changes → next compute picks up the new model; existing row's audit may need a `model_version` field to avoid mixing old/new logic.

### Implementation Order

1. Extend `FitbitWeightGoal` and `getFitbitWeightGoal` to read `weight` and `startWeight`.
2. Define the deficit/surplus model (likely 500 kcal default per 0.5 kg/week, with clamps).
3. Update `computeMacroTargets` and `MacroEngineInputs`; remove or deprecate `GOAL_MULTIPLIERS` constants.
4. Surface the chosen deficit and rate in the audit response and TargetsCard expanded view.
5. Decide on user-facing override (likely a simple "rate: gentle / standard / aggressive" toggle) — design before building.

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
