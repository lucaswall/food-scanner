# Food Scanner - Ideas

## Contents

| Feature | Summary |
|---------|---------|
| [Smart Multi-Item Splitting](#smart-multi-item-splitting) | Split complex meals into reusable food library entries |
| [Offline Queue with Background Sync](#offline-queue-with-background-sync) | Queue meals offline, analyze and log when back online |
| [Nutritional Label Library](#nutritional-label-library) | Store scanned label data for instant reuse by keyword |
| [Food Log Push Notifications](#food-log-push-notifications) | Push nutrition data directly to Health Connect via a thin Android wrapper |
| [Quick Capture Session](#quick-capture-session) | Snap photos and notes quickly at meals, process everything later at home |
| [AI-Driven Staging QA](#ai-driven-staging-qa) | Automated functional QA against staging using Playwright MCP or Claude Chrome |


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

## Nutritional Label Library

### Problem

When scanning a meal that includes a packaged product, the user photographs the nutrition label to give Claude exact data. But this information is attached to the meal as a whole — it's not stored independently. Next time the same product appears in a different meal, the user has to photograph the label again. Over time, the same labels get re-scanned repeatedly.

### Goal

Store nutritional label data extracted from photos as reusable entries in the database. When a user mentions a product by name, Claude can look it up by keyword and use the exact nutritional data without needing a new photo.

### Design

#### Capture Flow

- During analysis, when Claude detects a nutrition label in the photos, it extracts the structured data (serving size, calories, macros, micronutrients) and stores it as a label entry.
- Claude confirms what it captured: *"I saved the nutrition label for 'Yogur Ser Firme Vainilla' — next time just mention it by name."*
- The user can correct the product name or keywords during the chat.

#### Reuse Flow

- When analyzing a meal, Claude searches the label library by keywords (product name, brand, type) before estimating nutrition.
- If a match is found, Claude uses the exact label data instead of guessing: *"Using the label data you scanned for 'Yogur Ser Firme Vainilla' (120 cal per 125g). How much did you have?"*
- The user can override: *"No, this is a different brand"* → Claude falls back to estimation.

#### Label Management

- Labels are browsable in a dedicated section (e.g., under Settings or as a tab in the food library).
- Each label shows: product name, brand, serving size, key macros, date scanned.
- Users can edit product names/keywords, update nutrition data (re-scan), or delete entries.
- Search/filter by product name or brand.

### Architecture

- **New DB table:** `nutrition_labels` — stores product name, brand, keywords (for search), serving size, full nutrition data (JSON or structured columns), source image reference (optional), created/updated timestamps.
- **Claude tool:** New `search_nutrition_labels` tool (similar to existing `search_food_log`) that queries the label library by keyword. Claude calls this during analysis when the user mentions a packaged product.
- **Claude tool:** New `save_nutrition_label` tool that Claude calls when it extracts label data from a photo. Stores the structured nutrition data with user-provided or auto-detected product name.
- **Portion math:** Labels define nutrition per serving. Claude handles portion scaling when the user specifies a different amount than the label's serving size.

### Edge Cases

- Multiple labels for the same product (e.g., re-scanned with updated packaging) → newest entry wins, old one is replaced or versioned.
- Label is partially readable → Claude stores what it can extract, flags incomplete data.
- User mentions a product that matches multiple labels → Claude lists matches and asks which one.
- Label data is per-100g but user ate a specific portion → Claude calculates proportionally (same as current estimation behavior, but with exact base data).

### Implementation Order

1. `nutrition_labels` DB table and Drizzle schema
2. `search_nutrition_labels` Claude tool (keyword search)
3. `save_nutrition_label` Claude tool (extract + store from photos)
4. Integration into analysis flow (search before estimating, save when label detected)
5. Label management UI (browse, edit, delete)

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

Let the user quickly snap photos and jot notes during a meal with minimal friction, then process everything into proper food log entries in a single conversation later when they have time.

### Design

#### Quick Capture Flow (at the restaurant)

1. Tap "Start Session" on the dashboard to create a new session.
2. Session view opens: a scrollable list of captures with a prominent "Add Capture" button.
3. Tap Add → camera opens → snap photo(s) → optionally type a short note (e.g., "shared appetizer, had about half") → tap Save.
4. Capture is persisted immediately. Timestamp recorded automatically.
5. Back to session view. Repeat throughout the meal.

**Each capture should take under 10 seconds.** No AI processing, no analysis, no Fitbit interaction. Just persist the raw data.

A capture consists of:
- 1–9 images (same constraints as current analyze flow)
- Optional text note (max 2000 chars, same as current description)
- Auto-recorded timestamp
- Sequential order within the session

The session view shows a compact list: thumbnail of first image, note preview (truncated), and time. User can delete accidental captures from the list.

#### Session Lifecycle

- **Active:** User explicitly taps "Start Session". If one is already active, the app navigates to it. Only one active session at a time. Captures can be added. Session persists across app close, navigation, and device restarts.
- **Processing:** User taps "Process Session" to begin. No more captures can be added. A single Claude conversation analyzes everything. User refines and logs entries.
- **Deleted:** Once processing completes ("Log All") or the user aborts the session, the session and all its captures are permanently deleted. Only the resulting food log entries persist — editable with existing tools like any other meal. No session history, no archival.

#### Active Session Banner

When a session is active, a persistent banner appears on the dashboard: *"Capture session in progress — N captures"*. Tapping the banner opens the session view to continue capturing or close the session. This is the primary way to resume an active session — no separate navigation entry needed.

#### Processing Flow (at home)

Processing treats the entire session as a **single unit**. All captures are evidence in one meal story — not independent items to analyze separately. A menu photo gives dish names to all plate photos. A note saying "shared this" informs portion estimation. Processing them as a whole lets Claude make connections a per-capture approach would miss.

1. User taps "Process Session" from the session view.
2. The session view shows all captures chronologically — full images, notes, and timestamps. User can delete unwanted captures before proceeding.
3. Tapping "Analyze All" sends **every image and note** to Claude in a single conversation, organized by capture (with timestamps).
4. Claude proposes a **complete set of food log entries** for the session:

   > *"I see 8 captures from 8:30 PM to 10:15 PM. From the menu and plate photos, here's what I'd log:*
   > 1. *Bruschetta (shared, half portion) — 180 cal — 8:45 PM — Dinner*
   > 2. *Grilled salmon with vegetables — 620 cal — 9:10 PM — Dinner*
   > 3. *Tiramisu — 340 cal — 9:50 PM — Dinner*
   >
   > *The menu helped me identify the salmon dish. Want me to adjust anything?"*

5. User refines via chat: "the bruschetta was split three ways", "we also had bread from the basket, no photo", "the salmon was actually the fish of the day, about 400g". Claude updates the proposed entries.
6. When satisfied, a **"Log All" button** creates every entry at once — each with its own timestamp and meal type (derived from capture times). The session and all its captures are then deleted. Only the food log entries remain.

#### Image Budget Management

Claude's API supports up to 20 images per message. A restaurant session could exceed this. Strategy:

- **Under 20 total images:** Send all images inline in the first message, grouped by capture with timestamps and notes as text.
- **Over 20 total images:** Prioritize plate/food photos (higher analysis value). Menu photos are summarized as text if Claude already identified all dishes from the plates. If not, the most information-dense menu images are kept. User sees which images are included in the analysis and can swap them before sending.
- **Per-capture image limit stays at 9.** Most captures will be 1–3 images. A session of 8 captures with 2 images each = 16 images, well within budget.

#### Entry Points

- **Dashboard:** "Start Session" button, distinct from existing "Analyze Food". When active, replaced by the banner.
- **Existing analyze flow:** Unchanged. Quick capture is for deferred multi-item meals; analyze is for immediate single-item logging.

### Architecture

- **New DB tables:**
  - `capture_sessions` — `id`, `userId`, `status` (active/processing), `createdAt`.
  - `session_captures` — `id`, `sessionId`, `images` (JSONB array of base64 + mime type), `note` (text, nullable), `capturedAt`, `order` (integer).
- **Image storage:** Same base64 format the analyze API already uses. Images compressed client-side before upload (reuse existing `compressImage()`). Stored in the DB as JSONB — simple, no external storage dependency. For v1, storage growth is acceptable given single-user scale.
- **API routes:**
  - `POST /api/capture-sessions` — create new session (fails if one already active).
  - `GET /api/capture-sessions/active` — get active session with all captures.
  - `POST /api/capture-sessions/:id/captures` — add a capture (images + note).
  - `DELETE /api/capture-sessions/:id/captures/:captureId` — remove a capture.
  - `PATCH /api/capture-sessions/:id` — transition status (active → processing).
  - `DELETE /api/capture-sessions/:id` — abort/delete session and all captures.
- **Processing API:** New `/api/process-session` endpoint (or adapt existing `/api/analyze-food`). Accepts a session ID, loads all captures, builds a structured prompt with all images/notes/timestamps, streams Claude's response. The conversation continues via the existing `/api/chat-food` endpoint for refinements.
- **Batch logging:** New `/api/log-session` endpoint (or extend `/api/log-food`) that accepts multiple `FoodAnalysis` entries with individual timestamps and meal types. Creates all `custom_food` + `food_log_entry` + Fitbit records atomically. On success, deletes the session and all captures. Rolls back food entries if any Fitbit call fails.
- **New Claude tool:** `report_session_nutrition` — returns an array of food entries (each with name, nutrition, time, meal type) instead of a single entry. The chat UI renders all proposed entries in a reviewable list. Replaces `report_nutrition` during session processing only.
- **No archival or cleanup needed.** Sessions are deleted after logging or abort. The only persistent data is the food log entries themselves.

### Edge Cases

- **App closed mid-capture (photo taken, save not tapped):** The photo is lost — only saved captures persist. The save action must be obvious and fast to minimize this window.
- **Session left active for days:** No auto-expiry. The dashboard banner remains visible, making it impossible to forget.
- **Processing interrupted (app closed mid-conversation):** The session stays in "processing" status with all captures intact. Reopening starts a fresh analysis conversation — the chat is not persisted, but the raw evidence (images + notes) is still in the DB. No data lost.
- **"Log All" partially fails:** If some Fitbit entries succeed and others fail, roll back everything. The session stays in processing state so the user can retry. Atomic all-or-nothing.
- **More than 20 images across all captures:** Image budget management selects the most valuable images. User can override the selection before analysis.
- **Capture while offline:** The app is online-only (no service worker). Capture fails if there's no connectivity. The [Offline Queue](#offline-queue-with-background-sync) feature would complement this if implemented later.
- **Empty session:** User starts a session but adds zero captures, then tries to process. Disable the "Process Session" button — nothing to analyze.
- **Abort confirmation:** Deleting an active session with captures requires confirmation — the images and notes are gone forever.

### Implementation Order

1. DB schema: `capture_sessions` and `session_captures` tables
2. API routes for session CRUD and capture management
3. Quick capture UI: session view, camera integration, capture list
4. Dashboard banner for active session
5. `report_session_nutrition` Claude tool and session processing API
6. Processing UI: single conversation with all captures, chat refinement
7. Batch logging (Log All → multiple entries at once, session deleted on success)
8. Image budget management for large sessions

---

## AI-Driven Staging QA

### Problem

After merging changes to main, manual testing on the staging site is required to verify that everything works end-to-end. This involves navigating screens, logging food, opening chats, editing entries, deleting — repeating the same flows every time. The existing E2E tests use mocked API responses and never hit the real AI, real Fitbit dry-run, or real data flows. The gap between "tests pass" and "the app actually works" can only be closed by a human clicking through staging.

### Goal

Automate functional QA against the live staging environment so that after merging to main, an AI-driven process navigates the real app, performs real operations, and reports what works and what doesn't.

### Design

#### Two Complementary Approaches

**Option A — Playwright MCP skill (primary).** A Claude Code skill (`staging-qa`) that uses Microsoft's Playwright MCP server to drive a headless browser against `food-test.lucaswall.me`. The skill runs a defined set of test scenarios against the real app with real AI analysis, real Fitbit dry-run logging, and real data. It produces a pass/fail report with details on any failures.

**Option B — Claude Code `/chrome` interactive QA.** Use Claude Code's Chrome integration (`--chrome` or `/chrome`) to connect to a real Chrome window with the user's authenticated session. The user triggers it, Claude navigates and tests, but the user can intervene (handle CAPTCHAs, inspect visual issues, override decisions). Better for exploratory testing and visual verification. Lower setup cost, but requires the user to be present.

**When to use which:**
- **Option A** for repeatable post-merge sanity checks — the routine "did we break anything?" verification.
- **Option B** for exploratory testing of new features — when visual correctness and UX flow matter more than pass/fail.

#### Test Scenarios

The skill maintains a checklist of core flows to verify:

1. **Dashboard loads** — nutrition summary renders, date navigation works, daily/weekly tabs switch.
2. **Analyze food** — submit a text description, receive real AI analysis via SSE, see nutrition results.
3. **Chat refinement** — open a chat from an analysis result, send a message, get a real AI response.
4. **Log to Fitbit** — log an analyzed food entry (dry-run on staging), verify it appears in history.
5. **History** — browse entries, open detail view, verify nutrition data matches what was logged.
6. **Edit entry** — open edit mode on a logged entry, refine via chat, save changes.
7. **Delete entry** — delete a test entry, verify it disappears from history.
8. **Quick select** — browse custom foods, select one, log it.
9. **Settings** — verify settings page loads, Fitbit credentials display, API key management works.

Each scenario reports: pass, fail (with error details), or skip (if a prerequisite scenario failed).

#### Execution Model

- **Triggered manually** via `/staging-qa` after merging to main.
- **Advisory, not blocking** — the report is informational. It does not gate deployments.
- **Cleans up after itself** — deletes any test entries it created during the run.
- **Authenticates via test-login** — staging has `ENABLE_TEST_AUTH=true`, so the skill uses the same test auth bypass as E2E tests.

#### Reporting

The skill outputs a markdown summary:

> **Staging QA Report — 2026-03-01**
> - Dashboard: PASS
> - Analyze food: PASS
> - Chat refinement: PASS
> - Log to Fitbit: PASS
> - History: PASS
> - Edit entry: FAIL — save returned 500, response: "..."
> - Delete entry: SKIP (edit failed)
> - Quick select: PASS
> - Settings: PASS
>
> **7/9 passed, 1 failed, 1 skipped**

### Architecture

- **Playwright MCP server:** Microsoft's `@playwright/mcp` package, configured in `.claude/settings.json` as an MCP server. Uses accessibility tree snapshots (not screenshots) — fast, token-efficient, and compatible with shadcn/ui (no Shadow DOM).
- **Skill definition:** `.claude/skills/staging-qa/SKILL.md` — a Claude Code skill that connects to the Playwright MCP, navigates staging, and runs scenarios sequentially.
- **Authentication:** `POST /api/auth/test-login` on staging (same as E2E global setup). The Playwright MCP browser session stores the iron-session cookie.
- **Chrome integration:** No additional setup — Claude Code's `--chrome` flag connects to any running Chrome instance. User authenticates manually (Google OAuth), then Claude navigates.
- **No CI integration** — this runs locally in the developer's Claude Code session, not in GitHub Actions. CI integration is a future enhancement.

### Edge Cases

- **Staging is down or deploying** — the skill detects connection failures and reports "staging unreachable" instead of running scenarios.
- **Real AI responses vary** — the skill checks for structural correctness (nutrition data present, reasonable calorie range) rather than exact values.
- **Test data accumulates** — the skill creates entries with a recognizable prefix (e.g., "[QA Test]") and deletes them at the end. If the skill crashes mid-run, leftover entries are harmless and identifiable.
- **Fitbit dry-run mode** — staging runs with `FITBIT_DRY_RUN=true`, so logging doesn't hit the real Fitbit API. The skill verifies the log-to-Fitbit flow succeeds without checking Fitbit itself.
- **SSE streaming timeouts** — real AI analysis takes 5–15 seconds. The skill waits with appropriate timeouts (30s) rather than the millisecond mocks in E2E tests.
- **Chrome session expires** — for Option B, if the session expires mid-testing, Claude pauses and asks the user to re-authenticate.

### Implementation Order

1. Add Playwright MCP server to Claude Code configuration
2. Build `staging-qa` skill with scenario runner framework
3. Implement core scenarios (dashboard, analyze, log, history)
4. Add chat refinement, edit, delete, quick-select, settings scenarios
5. Add cleanup logic (delete test entries after run)
6. Document `/chrome` workflow for interactive exploratory QA

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
