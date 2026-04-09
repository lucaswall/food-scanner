# Quick Capture Session

**Source:** Inline request: Build Quick Capture Session feature from ROADMAP.md spec — client-side IndexedDB capture storage, quick capture UI with camera auto-trigger, Claude triage tool for multi-item analysis, triage API endpoints, triage chat UI with approval flow, and bulk save to Saved Analyses.

---

## Context Gathered

### Codebase Analysis

**IndexedDB patterns (existing):**
- `src/lib/analysis-session.ts` (231 lines): Uses `idb` v8.0.3 library. DB name `food-scanner`, store `session-photos`. Singleton `getDB()`. Photo blobs stored separately from metadata (metadata in sessionStorage). 24-hour TTL with `isSessionExpired()` + `cleanupExpiredSession()` on mount. Session IDs via `crypto.randomUUID()`.
- `src/hooks/use-analysis-session.ts` (295 lines): React wrapper. Photo saves are immediate (not debounced). Metadata saves debounced 300ms. `clearPersistedSession()` clears both IDB and sessionStorage.

**Image processing pipeline:**
- `src/lib/image.ts`: `compressImage(file: File | Blob): Promise<Blob>` — HEIC detection → conversion via `heic-to` → canvas resize (MAX_DIMENSION=1024px) → JPEG 80% quality. `isHeicFile(file)`, `convertHeicToJpeg(file)`.
- `src/lib/image-validation.ts`: MAX_IMAGES=9, MAX_IMAGE_SIZE=10MB, ALLOWED_TYPES=[jpeg,png,gif,webp].

**Photo capture UI:**
- `src/components/photo-capture.tsx` (432 lines): Props: `onPhotosChange`, `maxPhotos?`, `autoCapture?`, `restoredBlobs?`. Uses `<input type="file" capture="environment">`. `autoCapture` triggers camera click on mount via useEffect. Manages previews with `URL.createObjectURL()` and cleanup on unmount. Separate state for restored blobs vs new photos.

**Claude tool system:**
- `src/lib/claude.ts` (~1980 lines): Model `claude-sonnet-4-6`. `REPORT_NUTRITION_TOOL` (lines 102-232) with strict schema. `analyzeFood()` yields `StreamEvent` via `runToolLoop()`. `conversationalRefine()` handles chat continuation. `validateFoodAnalysis()` (lines 416-619) validates and normalizes tool output. Tools: report_nutrition + data tools (search_food_log, get_nutrition_summary, etc.) + web_search.
- System prompt enforces "ONE food log entry per session" — this constraint must be lifted for triage mode.

**SSE streaming:**
- `src/lib/sse.ts`: `StreamEvent` union type (text_delta, tool_start, analysis, needs_chat, usage, error, done). `createSSEResponse(generator)` wraps async generator. `parseSSEEvents()` for client-side parsing.

**Saved Analyses:**
- `src/lib/saved-analyses.ts`: `saveAnalysis(userId, foodAnalysis)` → `{id, createdAt}`. `getSavedAnalyses(userId)` → list. `getSavedAnalysis(userId, id)` → detail with full FoodAnalysis. `deleteSavedAnalysis(userId, id)`.
- `POST /api/saved-analyses`: Validates required fields (food_name, calories, amount, protein_g, carbs_g, fat_g). Returns 201.
- Saved analyses display on dashboard via `SavedForLaterSection` — renders null if empty, shows count badge + item list.

**Dashboard structure:**
- `src/components/daily-dashboard.tsx`: Renders in order: DateNavigator, CalorieRing, MacroBars, LumenBanner, FastingCard, MealBreakdown, SavedForLaterSection (only if today + has items), settings/history links. Uses `space-y-6` gaps.
- `src/components/saved-for-later-section.tsx`: Pattern to follow — shows count badge, item list with truncated names + calories + relative time, renders null when empty.

**SWR cache:**
- `src/lib/swr.ts`: `apiFetcher()`, `invalidateFoodCaches()`, `invalidateLabelCaches()`, `invalidateSavedAnalysesCaches()`. All use prefix-based mutation.

**Toast pattern:**
- App uses inline `aria-live="polite"` banners, not a toast library. Success: green bg. Error: destructive bg.

**UI components available:**
- shadcn/ui: alert, alert-dialog, button, card, dialog, skeleton, input, label, select, dropdown-menu, tooltip, popover, collapsible.
- Bottom nav: 5 items (Home, Labels, Analyze, Quick Select, Chat). Fixed bottom with safe-area insets.

**Key types:**
- `FoodAnalysis` (src/types/index.ts:55-82): food_name, amount, unit_id, calories, macros, confidence, notes, description, keywords, sourceCustomFoodId?, editingEntryId?, date?, time?, mealTypeId?.
- `ConversationMessage` (src/types/index.ts:465-471): role, content, images?, analysis?, isThinking?.
- `SavedAnalysisListItem` (src/types/index.ts:503-508): id, description, calories, createdAt.
- `SavedAnalysisDetail` (src/types/index.ts:528-530): extends ListItem with foodAnalysis.

### MCP Context

- **Linear:** Team "Food Scanner" (FOO-xxx). No existing Quick Capture issues.
- **Railway:** Not checked (not relevant for planning).

---

## Tasks

### Task 1: Capture Storage Layer — Types, IndexedDB Module & React Hook

**Linear Issue:** [FOO-914](https://linear.app/lw-claude/issue/FOO-914/quick-capture-capture-storage-layer-types-indexeddb-module-and-react)

Add types for capture sessions, create an IndexedDB storage module for multi-capture persistence with 7-day expiry, and a React hook to manage capture state.

**New types in `src/types/index.ts`:**

- `CaptureItem` interface: `id` (string, UUID), `imageCount` (number), `note` (string | null), `capturedAt` (string, ISO-8601), `order` (number).
- `CaptureSession` interface: `id` (string, UUID), `captures` (CaptureItem[]), `createdAt` (string, ISO-8601).

**New file `src/lib/capture-session.ts`:**

Follow patterns from `src/lib/analysis-session.ts`. Use the existing `food-scanner` DB (bump version to 2, add new object store in upgrade handler). New object store: `capture-blobs` with key = `{sessionId}:{captureId}` (string), value = `Blob[]`. Session metadata stored in localStorage (not sessionStorage — captures must survive tab close).

Functions:
- `getActiveCaptureSessionId(): string | null` — reads localStorage
- `createCaptureSessionId(): string` — creates UUID, stores in localStorage
- `saveCaptureMetadata(sessionId, session: CaptureSession): void` — saves to localStorage
- `loadCaptureMetadata(sessionId): CaptureSession | null` — reads + validates from localStorage
- `saveCaptureBlobs(sessionId, captureId, blobs: Blob[]): Promise<void>` — stores compressed image blobs in IndexedDB
- `loadCaptureBlobs(sessionId, captureId): Promise<Blob[]>` — retrieves blobs
- `deleteCaptureBlobs(sessionId, captureId): Promise<void>` — removes single capture's blobs
- `deleteAllCaptureBlobs(sessionId): Promise<void>` — removes all blobs for a session (iterate keys with prefix)
- `clearCaptureSession(sessionId): Promise<void>` — removes metadata from localStorage + all blobs from IndexedDB
- `isCaptureSessionExpired(session): boolean` — checks 7-day TTL (`7 * 24 * 60 * 60 * 1000`)
- `cleanupExpiredCaptures(): Promise<{ expiredCount: number }>` — on mount: checks active session, clears if expired, returns count for toast

Key behaviors:
- Metadata in localStorage (survives tab close, unlike sessionStorage used by analysis-session)
- Blobs in IndexedDB with compound key `{sessionId}:{captureId}` (allows per-capture deletion)
- 7-day TTL aligned with analysis-session pattern
- All IDB operations are best-effort (silently fail if IDB unavailable)
- LocalStorage keys: `food-scanner-capture-session-id`, `food-scanner-capture-session:{sessionId}`

**New file `src/hooks/use-capture-session.ts`:**

React hook wrapping the storage module. Returns:
- `state`: `{ sessionId: string | null, captures: CaptureItem[], isActive: boolean }`
- `actions`: `{ startSession(), addCapture(images: Blob[], note: string | null), removeCapture(captureId: string), clearSession(), getCaptureBlobs(captureId: string): Promise<Blob[]> }`
- `isRestoring: boolean` — true during initial load
- `expiredCount: number` — captures expired on mount (for toast display)

Behaviors:
- On mount: `cleanupExpiredCaptures()` → load active session metadata → set `expiredCount` if any expired
- `startSession()`: creates session ID if none active, initializes empty captures
- `addCapture()`: compresses images via `compressImage()`, saves blobs to IDB, updates metadata with new CaptureItem (imageCount, note, capturedAt = new Date().toISOString(), auto-incrementing order), saves metadata to localStorage
- `removeCapture()`: removes capture from metadata, deletes blobs from IDB
- `clearSession()`: calls `clearCaptureSession()`, resets state
- `getCaptureBlobs()`: reads blobs from IDB for a specific capture

**Tests `src/lib/__tests__/capture-session.test.ts`:**
1. `createCaptureSessionId` creates UUID and stores in localStorage
2. `getActiveCaptureSessionId` returns null when no session exists
3. `saveCaptureMetadata` + `loadCaptureMetadata` round-trips correctly
4. `loadCaptureMetadata` returns null for missing/corrupt data
5. `saveCaptureBlobs` + `loadCaptureBlobs` round-trips blob arrays
6. `deleteCaptureBlobs` removes specific capture blobs
7. `deleteAllCaptureBlobs` removes all blobs for a session
8. `clearCaptureSession` removes both metadata and blobs
9. `isCaptureSessionExpired` returns false for fresh session, true for 7+ day old session
10. `cleanupExpiredCaptures` clears expired session and returns count
11. `cleanupExpiredCaptures` returns 0 when no session exists

Use `fake-indexeddb` (already in devDependencies) for IDB tests. Use `vi.spyOn(Storage.prototype, ...)` for localStorage mocking.

**Tests `src/hooks/__tests__/use-capture-session.test.ts`:**
1. Initial state has no active session
2. `startSession` creates a new session with empty captures
3. `addCapture` adds a capture with correct metadata
4. `addCapture` compresses images before storing
5. `removeCapture` removes the capture from state and IDB
6. `clearSession` resets all state
7. `expiredCount` reflects expired captures on mount
8. Multiple `startSession` calls reuse existing session

---

### Task 2: Quick Capture UI — Capture Page, Camera Flow & Dashboard Banner

**Linear Issue:** [FOO-915](https://linear.app/lw-claude/issue/FOO-915/quick-capture-capture-page-camera-flow-and-dashboard-banner)

Build the capture flow page with camera auto-trigger and a dashboard banner showing pending captures.

**New file `src/app/app/capture/page.tsx`:**

Server component. Session validation (redirect to `/` if not authenticated). Renders `<QuickCapture />` in standard page container (`min-h-screen px-4 py-6`, `mx-auto w-full max-w-md flex flex-col gap-6`).

**New file `src/app/app/capture/loading.tsx`:**

Skeleton: header placeholder + 3 capture card placeholders (thumbnail + text line).

**New file `src/components/quick-capture.tsx`:**

Client component (`'use client'`). Uses `useCaptureSession()` hook.

States:
- **Empty (no session):** Auto-starts session on mount, immediately triggers camera
- **Capturing (session active):** Shows capture list + "Add Capture" button + "Done" button
- **Adding:** Camera/photo input open, note input visible, "Save" button

UI structure:
- Header: "Quick Capture" title + capture count badge
- Capture list: scrollable, each item shows thumbnail of first image (from blob URL), note preview (truncated 50 chars), relative timestamp. Delete icon button (min 44×44px touch target).
- "Add Capture" button: prominent, triggers `<PhotoCapture autoCapture={true} />` in a dialog or inline expansion
- Note input: `<Input>` with placeholder "Add a note (optional)" — shown after photo capture, before save
- "Save" button: calls `addCapture()` with compressed blobs + note, then auto-re-triggers camera for next capture
- "Done" button: navigates to `/app` (dashboard)
- "Process Captures" button: navigates to `/app/process-captures` (visible when captures.length > 0)

Camera flow: after each save, auto-trigger camera again via re-rendering PhotoCapture with `autoCapture={true}`. User taps "Done" when finished capturing.

Abort confirmation: if user navigates away with captures, no confirmation needed (captures persist in IndexedDB). "Clear All" button requires `<AlertDialog>` confirmation.

Memory cleanup: revoke all blob URLs on unmount.

**New file `src/components/capture-session-banner.tsx`:**

Client component. Props: `captureCount: number`, `onProcess: () => void`, `onCapture: () => void`.

Renders null if `captureCount === 0`.

Follow `SavedForLaterSection` pattern but as a single banner (not a list):
- Container: `w-full rounded-lg border p-3 min-h-[44px]` with a distinct color scheme (e.g., `border-primary/30 bg-primary/5`)
- Left: icon + text: "*N captures ready to process*"
- Two action buttons: "Add More" (navigates to capture page) + "Process" (navigates to process-captures page)
- Touch targets: 44×44px minimum

**Modify `src/components/daily-dashboard.tsx`:**

Add `CaptureSessionBanner` between LumenBanner and FastingCard (or similar prominent position). Only show on today's view. Use `useCaptureSession()` hook to get capture count. Pass `router.push('/app/capture')` as `onCapture` and `router.push('/app/process-captures')` as `onProcess`.

**Tests `src/components/__tests__/quick-capture.test.tsx`:**
1. Renders empty state and auto-starts session
2. Shows capture list with thumbnails and notes after adding captures
3. "Save" adds capture to list
4. Delete button removes capture from list with confirmation
5. "Done" navigates to dashboard
6. "Process Captures" button navigates to process page
7. "Clear All" shows AlertDialog confirmation

**Tests `src/components/__tests__/capture-session-banner.test.tsx`:**
1. Renders null when captureCount is 0
2. Shows capture count in banner text
3. "Add More" button calls onCapture
4. "Process" button calls onProcess

---

### Task 3: Claude Triage Tool, System Prompt & Functions

**Linear Issue:** [FOO-916](https://linear.app/lw-claude/issue/FOO-916/quick-capture-claude-triage-tool-system-prompt-and-functions)

Define the `report_session_items` tool, create triage-specific system prompt and Claude functions for multi-item food identification.

**Modify `src/lib/sse.ts`:**

Add new `StreamEvent` variant: `| { type: "session_items"; items: FoodAnalysis[] }`.

**Modify `src/types/index.ts`:**

Add `sessionItems?: FoodAnalysis[]` field to `ConversationMessage` interface (parallel to existing `analysis?` field). This carries the triage results in conversation history for context injection during refinement.

Add `ChatCapturesRequest` interface: `{ messages: ConversationMessage[]; initialItems?: FoodAnalysis[] }`.

**Modify `src/lib/claude.ts`:**

Add `REPORT_SESSION_ITEMS_TOOL` constant — strict schema with a single required property `items` which is an array of objects. Each object has the same fields as `REPORT_NUTRITION_TOOL` input schema (food_name, amount, unit_id, calories, all macros, confidence, notes, description, keywords) PLUS required fields: `time` (string, HH:mm — from capture timestamp, required not optional), `meal_type_id` (number), `date` (string, YYYY-MM-DD — from capture date). No `source_custom_food_id` or `editing_entry_id` (these are always new entries). Add `capture_indices` (array of numbers — which captures this item came from, for UI display).

Add `TRIAGE_SYSTEM_PROMPT` constant. Key instructions:
- You are analyzing a collection of food captures from a meal session
- Captures are organized chronologically with timestamps and optional notes
- Identify each distinct food item across all captures
- A menu photo provides context (dish names, prices) — use it to identify dishes in plate photos
- Notes provide portion/sharing context ("shared appetizer, had about half")
- Group by logical food item, not by capture (one capture may contain multiple items, multiple captures may show the same item from different angles)
- Assign time from the capture timestamp of the most relevant photo
- Assign meal_type_id based on capture times (use same logic as existing prompt)
- Always call `report_session_items` with the complete list
- When the user asks to modify the list (combine, split, remove, add, adjust), call `report_session_items` again with the updated list
- Do NOT use search_food_log or other data tools — triage is purely from visual evidence and notes

Add `validateSessionItems(input: unknown): FoodAnalysis[]` function. Iterate the `items` array, call existing `validateFoodAnalysis()` on each item (reuse validation logic). Filter out items that fail validation. Return array of validated `FoodAnalysis` objects. `capture_indices` is stripped (UI-only, not part of FoodAnalysis).

Add `triageCaptures()` async generator function. Signature: `async function* triageCaptures(images: ImageInput[], captureMetadata: { captureId: string; imageIndices: number[]; note: string | null; capturedAt: string }[], userId: string, currentDate: string, log?: Logger, signal?: AbortSignal): AsyncGenerator<StreamEvent>`. Build the initial message with all images + capture context as text (group images by capture, include timestamps and notes). Use `TRIAGE_SYSTEM_PROMPT`. Tools: `[REPORT_SESSION_ITEMS_TOOL]` only (no data tools, no web search). When `report_session_items` is called, validate via `validateSessionItems()`, yield `{ type: "session_items", items }`. Follow `analyzeFood()` patterns for streaming, error handling, usage tracking.

Add `triageRefine()` async generator function. Signature: `async function* triageRefine(messages: ConversationMessage[], initialItems?: FoodAnalysis[], signal?: AbortSignal, log?: Logger): AsyncGenerator<StreamEvent>`. Follow `conversationalRefine()` patterns. For assistant messages with `sessionItems`, append a structured summary of all items (name, calories, time for each). Use `TRIAGE_SYSTEM_PROMPT`. Tools: `[REPORT_SESSION_ITEMS_TOOL]` only. When `report_session_items` is called, validate and yield `session_items` event.

**Tests `src/lib/__tests__/claude-triage.test.ts`:**
1. `validateSessionItems` validates array of valid items
2. `validateSessionItems` filters out invalid items (missing required fields)
3. `validateSessionItems` returns empty array for non-array input
4. `validateSessionItems` reuses `validateFoodAnalysis` normalization (keyword cleanup, time format)
5. `REPORT_SESSION_ITEMS_TOOL` has correct schema structure (strict mode, items array)
6. `TRIAGE_SYSTEM_PROMPT` includes key instructions (no data tools, capture context, report_session_items)

---

### Task 4: Triage API Endpoints & Bulk Save

**Linear Issue:** [FOO-917](https://linear.app/lw-claude/issue/FOO-917/quick-capture-triage-api-endpoints-and-bulk-save)

Create the process-captures and chat-captures API routes, and add bulk save functionality to saved analyses.

**New file `src/app/api/process-captures/route.ts`:**

POST handler. Auth: `getSession()` + `validateSession()`. Rate limit: 10 requests per 15 minutes (triage is expensive — ~$0.10 per session).

Input (FormData):
- `images` (File[], multiple) — all capture images in order, compressed client-side
- `captureMetadata` (string, JSON) — array of `{ captureId: string, imageCount: number, note: string | null, capturedAt: string }`. Each entry maps to a sequential group of images in the `images` array.
- `clientDate` (string, YYYY-MM-DD)

Validation:
- At least 1 image required
- Image type whitelist: JPEG, PNG, GIF, WebP (same as analyze-food)
- Max 81 images (9 captures × 9 images — theoretical max)
- captureMetadata must be valid JSON array, sum of imageCount must equal images count
- Does NOT require Fitbit connection (triage doesn't log anything)

Processing:
- Convert images to base64 (same pattern as analyze-food)
- Build captureMetadata with imageIndices (map each capture to its image positions in the flat array)
- Call `triageCaptures()` generator
- Return `createSSEResponse(generator)`

**New file `src/app/api/chat-captures/route.ts`:**

POST handler. Auth: `getSession()` + `validateSession()`. Rate limit: 30 requests per 15 minutes (same as chat-food).

Input (JSON):
- `messages: ConversationMessage[]` — validated, max 30 messages
- `initialItems?: FoodAnalysis[]` — baseline items for context

Validation: Same message validation pattern as chat-food route. Validate `initialItems` as array of FoodAnalysis if provided.

Processing:
- Call `triageRefine(messages, initialItems, signal, log)`
- Return `createSSEResponse(generator)`

**New file `src/app/api/saved-analyses/bulk/route.ts`:**

POST handler. Auth: `getSession()` + `validateSession()`.

Input (JSON):
- `items: FoodAnalysis[]` — array of food analyses to save

Validation:
- Must be non-empty array
- Each item validated for required fields (food_name, calories, amount, protein_g, carbs_g, fat_g) — same validation as existing `POST /api/saved-analyses`
- Max 20 items per request

Processing:
- Call new `bulkSaveAnalyses(userId, items)` function
- Return `{ items: Array<{ id: number; createdAt: Date }> }` with HTTP 201

**Modify `src/lib/saved-analyses.ts`:**

Add `bulkSaveAnalyses(userId: string, items: FoodAnalysis[]): Promise<Array<{ id: number; createdAt: Date }>>`. Insert all items in a single transaction (use Drizzle's `db.insert().values([...])` for batch insert). Each item gets `description` from `food_name` and `calories` denormalized (same as existing `saveAnalysis`).

**Tests `src/app/api/__tests__/process-captures.test.ts`:**
1. Returns 401 without session
2. Returns 400 with no images
3. Returns 400 when captureMetadata imageCount doesn't match images count
4. Returns SSE stream with valid input (mock Claude response)
5. Rate limits at 10 requests per 15 minutes

**Tests `src/app/api/__tests__/chat-captures.test.ts`:**
1. Returns 401 without session
2. Returns 400 with empty messages
3. Returns SSE stream with valid messages (mock Claude response)

**Tests `src/app/api/__tests__/saved-analyses-bulk.test.ts`:**
1. Returns 401 without session
2. Returns 400 with empty array
3. Returns 400 with invalid items (missing required fields)
4. Returns 201 with valid items, creates all saved analyses
5. Returns 400 with more than 20 items

**Tests `src/lib/__tests__/saved-analyses.test.ts` (extend existing):**
1. `bulkSaveAnalyses` saves multiple items in one call
2. `bulkSaveAnalyses` returns array of IDs and dates

---

### Task 5: Triage Chat UI & Approval Flow

**Linear Issue:** [FOO-918](https://linear.app/lw-claude/issue/FOO-918/quick-capture-triage-chat-ui-and-approval-flow)

Build the triage processing page with item list display, chat refinement, and approve-to-save flow that creates Saved Analyses and clears captures.

**New file `src/app/app/process-captures/page.tsx`:**

Server component. Session validation. Renders `<CaptureTriage />` in standard page container.

**New file `src/app/app/process-captures/loading.tsx`:**

Skeleton: header + 3 item card skeletons + chat area skeleton.

**New file `src/components/capture-triage.tsx`:**

Client component (`'use client'`). Main orchestrator for the triage flow.

Uses `useCaptureSession()` hook to access captures. If no captures exist, redirect to `/app`.

States:
- **Preview:** Shows all captures chronologically (thumbnails, notes, timestamps). User can remove captures before processing. "Analyze All" button.
- **Analyzing:** Uploading images + streaming Claude response. Show loading state with narrative text.
- **Results:** Shows proposed item list + chat input for refinement. "Approve & Save" button.
- **Saving:** Saving items as Saved Analyses. Show spinner.
- **Done:** Success message + redirect to `/app`.

Analyze flow:
1. Read all capture blobs from IndexedDB via `getCaptureBlobs(captureId)` for each capture
2. Build FormData: images in capture order, captureMetadata JSON with imageCount/note/capturedAt per capture
3. POST to `/api/process-captures`
4. Consume SSE stream: accumulate `text_delta` for narrative, watch for `session_items` event
5. On `session_items`: display proposed items list, enable chat input

Chat refinement:
- Text input at bottom (same pattern as existing chat)
- User sends message → POST to `/api/chat-captures` with conversation history + current items as `initialItems`
- Consume SSE stream for updated `session_items`
- Replace displayed list on each new `session_items` event

Approval flow:
1. User taps "Approve & Save"
2. POST to `/api/saved-analyses/bulk` with current items array
3. On success: call `clearSession()` to remove captures from IndexedDB, `invalidateSavedAnalysesCaches()` to refresh dashboard
4. Show success banner: "N items saved — find them in Saved for Later on your dashboard"
5. Navigate to `/app` after brief delay (or on tap)

**New file `src/components/session-items-list.tsx`:**

Client component. Props: `items: FoodAnalysis[]`, `onRemoveItem?: (index: number) => void`.

Displays the proposed food items from triage. Each item card:
- Food name (bold)
- Calories + macros summary (compact: "620 cal · 45p · 30c · 28f")
- Time + meal type label (e.g., "9:10 PM · Dinner")
- Confidence badge (high=green, medium=yellow, low=orange)
- Remove button (X icon, 44×44px touch target) — calls `onRemoveItem` if provided

Follow `SavedForLaterSection` item styling. Cards in a `space-y-2` list.

**Tests `src/components/__tests__/capture-triage.test.tsx`:**
1. Redirects to `/app` when no captures exist
2. Preview state shows all captures with thumbnails and notes
3. "Analyze All" sends images to process-captures API
4. Shows loading state during analysis
5. Displays proposed items list on session_items event
6. Chat input sends message to chat-captures API
7. Updated session_items replaces displayed list
8. "Approve & Save" calls bulk save endpoint
9. On save success: clears captures, invalidates caches, redirects to dashboard
10. Shows error banner on API failure

**Tests `src/components/__tests__/session-items-list.test.tsx`:**
1. Renders all items with food name, calories, time
2. Shows confidence badge with correct color
3. Remove button calls onRemoveItem with correct index
4. Renders empty state message when items array is empty

---

## Post-Implementation Checklist

- [ ] All new pages have `loading.tsx` with Skeleton placeholders
- [ ] All API routes use `getSession()` + `validateSession()` auth pattern
- [ ] All API routes use `src/lib/api-response.ts` format with ErrorCode
- [ ] All client data fetching uses SSE streaming pattern (no raw useState + fetch for reads)
- [ ] All touch targets minimum 44×44px
- [ ] `@/` path alias used for all imports
- [ ] `interface` used over `type` for object shapes
- [ ] No `console.log` in server code (use pino logger)
- [ ] `console.error`/`console.warn` acceptable in client components
- [ ] IndexedDB operations are best-effort (silently fail if unavailable)
- [ ] Camera flow works on mobile (test with `<input capture="environment">`)
- [ ] Capture session survives page refresh and app restart (localStorage + IndexedDB)
- [ ] 7-day expiry cleanup runs on mount with toast notification
- [ ] Blob URLs revoked on unmount (no memory leaks)
- [ ] Rate limiting on triage endpoints (10/15min for process-captures, 30/15min for chat-captures)
- [ ] Zero lint warnings, zero TypeScript errors
- [ ] Update CLAUDE.md: add `capture_sessions` reference to relevant sections if needed

---

## Plan Summary

| # | Task | Files | Depends On |
|---|------|-------|------------|
| 1 | Capture Storage Layer | `src/types/index.ts`, `src/lib/capture-session.ts`, `src/hooks/use-capture-session.ts` + tests | — |
| 2 | Quick Capture UI | `src/app/app/capture/`, `src/components/quick-capture.tsx`, `src/components/capture-session-banner.tsx`, `src/components/daily-dashboard.tsx` + tests | Task 1 |
| 3 | Claude Triage Tool & Functions | `src/lib/sse.ts`, `src/lib/claude.ts`, `src/types/index.ts` + tests | — |
| 4 | Triage API Endpoints & Bulk Save | `src/app/api/process-captures/`, `src/app/api/chat-captures/`, `src/app/api/saved-analyses/bulk/`, `src/lib/saved-analyses.ts` + tests | Task 3 |
| 5 | Triage Chat UI & Approval | `src/app/app/process-captures/`, `src/components/capture-triage.tsx`, `src/components/session-items-list.tsx` + tests | Tasks 1, 4 |

**Parallelizable:** Tasks 1 and 3 have no dependencies and can run in parallel. Task 2 depends on 1. Task 4 depends on 3. Task 5 depends on 1 and 4.

---

## Iteration 1

**Implemented:** 2026-04-09
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Capture Storage Layer — CaptureItem/CaptureSession types, IndexedDB module with 7-day TTL, useCaptureSession hook (worker-1)
- Task 2: Quick Capture UI — Capture page with camera auto-trigger, QuickCapture component, CaptureSessionBanner, dashboard integration (worker-1)
- Task 3: Claude Triage Tool & Functions — REPORT_SESSION_ITEMS_TOOL, TRIAGE_SYSTEM_PROMPT, validateSessionItems, triageCaptures, triageRefine (worker-2)
- Task 4: Triage API Endpoints & Bulk Save — process-captures, chat-captures, saved-analyses/bulk routes, bulkSaveAnalyses (worker-2)
- Task 5: Triage Chat UI & Approval — CaptureTriage orchestrator (preview→analyzing→results→saving→done), SessionItemsList, approval flow (worker-3)

### Files Modified
- `src/types/index.ts` — CaptureItem, CaptureSession, ChatCapturesRequest types; sessionItems on ConversationMessage
- `src/lib/analysis-session.ts` — Bumped DB to v2 with capture-blobs store, exported getDB
- `src/lib/capture-session.ts` — New IndexedDB storage module for multi-capture persistence
- `src/hooks/use-capture-session.ts` — React hook wrapping capture storage
- `src/app/app/capture/page.tsx` + `loading.tsx` — Capture page with skeleton
- `src/components/quick-capture.tsx` — Camera flow with auto-re-trigger
- `src/components/capture-session-banner.tsx` — Dashboard banner for pending captures
- `src/components/daily-dashboard.tsx` — Added CaptureSessionBanner
- `src/lib/sse.ts` — Added session_items StreamEvent variant
- `src/lib/claude.ts` — REPORT_SESSION_ITEMS_TOOL, TRIAGE_SYSTEM_PROMPT, validateSessionItems, triageCaptures, triageRefine
- `src/lib/saved-analyses.ts` — bulkSaveAnalyses function
- `src/app/api/process-captures/route.ts` — Triage SSE endpoint (FormData, 10/15min rate limit)
- `src/app/api/chat-captures/route.ts` — Triage refinement endpoint (JSON, 30/15min rate limit)
- `src/app/api/saved-analyses/bulk/route.ts` — Bulk save endpoint (max 20 items)
- `src/app/app/process-captures/page.tsx` + `loading.tsx` — Triage page with skeleton
- `src/components/capture-triage.tsx` — Triage orchestrator with SSE streaming
- `src/components/session-items-list.tsx` — Proposed items display with confidence badges

### Linear Updates
- FOO-914: Todo → In Progress → Review
- FOO-915: Todo → In Progress → Review
- FOO-916: Todo → In Progress → Review
- FOO-917: Todo → In Progress → Review
- FOO-918: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (0 critical, 2 medium, 1 low), all fixed before proceeding
  - Stale closure in narrative accumulation (capture-triage.tsx) — fixed with useRef
  - Weak validation in bulk save endpoint — replaced with validateFoodAnalysis
  - Duplicate order values after capture removal — fixed with Math.max-based ordering
- verifier: All 3092 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 2 (capture storage + quick capture UI)
- Worker 2: Tasks 3, 4 (Claude triage tool + API endpoints)
- Worker 3: Task 5 (triage chat UI + approval flow)

### Merge Summary
- Worker 1: fast-forward (first merge, no conflicts)
- Worker 2: auto-merge, no conflicts (types/index.ts merged cleanly)
- Worker 3: 1 conflict in src/hooks/use-capture-session.ts (worker-3's stub vs worker-1's real impl — kept worker-1's), duplicate types/events removed from types/index.ts and sse.ts

### Review Findings

Summary: 9 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 9 issue(s) — Linear issues created
- DISCARDED: 7 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: captureMetadata unsafe cast + missing captureId (`src/app/api/process-captures/route.ts:77`, `src/components/capture-triage.tsx:137-141`) — FOO-919
- [MEDIUM] BUG: Image index corruption when images fail processing (`src/app/api/process-captures/route.ts:104-136`) — FOO-920
- [MEDIUM] BUG: Missing stop_reason handling in triageCaptures/triageRefine (`src/lib/claude.ts:2259-2270, 2400-2410`) — FOO-921
- [MEDIUM] BUG: capture.imageCount vs blobs.length mismatch (`src/components/capture-triage.tsx:138`) — FOO-922
- [MEDIUM] BUG: handleSave missing error handling (`src/components/quick-capture.tsx:137-145`) — FOO-923
- [MEDIUM] SECURITY: No rate limiting on bulk save endpoint (`src/app/api/saved-analyses/bulk/route.ts`) — FOO-924
- [LOW] RESOURCE: Object URL leak in thumbnail loading (`src/components/capture-triage.tsx:44-68`) — FOO-925
- [LOW] CONVENTION: Double-logging on bulk save success (`src/lib/saved-analyses.ts:94`) — FOO-926
- [LOW] BUG: triageRefine missing recordUsage call (`src/lib/claude.ts:~2385`) — FOO-927

**Discarded findings (not bugs):**
- [DISCARDED] ASYNC: SSE batch event ordering in consumeSSEStream — accepted tradeoff, standard SSE behavior
- [DISCARDED] ASYNC: clearSession fire-and-forget without await — IDB operations are best-effort per design
- [DISCARDED] ASYNC: removeCapture orphaned blobs — cleaned by 7-day TTL expiry
- [DISCARDED] ASYNC: Race condition in addCapture concurrent calls — impossible in practice (sequential mobile UX)
- [DISCARDED] EDGE CASE: bulkSaveAnalyses no transaction wrapper — PostgreSQL multi-row INSERT is atomic
- [DISCARDED] TYPE: Weak localStorage validation in isValidCaptureSession — same-origin data written by same code, corruption near-impossible
- [DISCARDED] CONVENTION: eslint-disable for img tag in capture-triage — blob URLs can't use Next.js Image optimization
- [DISCARDED] TEST: No test files added — false positive, all test files exist (capture-session, use-capture-session, claude-triage, capture-triage, session-items-list, quick-capture, capture-session-banner)

### Linear Updates
- FOO-914: Review → Merge
- FOO-915: Review → Merge
- FOO-916: Review → Merge
- FOO-917: Review → Merge
- FOO-918: Review → Merge
- FOO-919: Created in Todo (Fix: captureMetadata unsafe cast + missing captureId)
- FOO-920: Created in Todo (Fix: image index corruption)
- FOO-921: Created in Todo (Fix: missing stop_reason handling)
- FOO-922: Created in Todo (Fix: imageCount vs blobs.length mismatch)
- FOO-923: Created in Todo (Fix: handleSave missing error handling)
- FOO-924: Created in Todo (Fix: no rate limiting on bulk save)
- FOO-925: Created in Todo (Fix: object URL leak in thumbnails)
- FOO-926: Created in Todo (Fix: double-logging on bulk save)
- FOO-927: Created in Todo (Fix: triageRefine missing recordUsage)

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-919](https://linear.app/lw-claude/issue/FOO-919), [FOO-920](https://linear.app/lw-claude/issue/FOO-920), [FOO-921](https://linear.app/lw-claude/issue/FOO-921), [FOO-922](https://linear.app/lw-claude/issue/FOO-922), [FOO-923](https://linear.app/lw-claude/issue/FOO-923), [FOO-924](https://linear.app/lw-claude/issue/FOO-924), [FOO-925](https://linear.app/lw-claude/issue/FOO-925), [FOO-926](https://linear.app/lw-claude/issue/FOO-926), [FOO-927](https://linear.app/lw-claude/issue/FOO-927)

### Fix 1: captureMetadata unsafe cast + missing captureId
**Linear Issue:** [FOO-919](https://linear.app/lw-claude/issue/FOO-919)

1. Write test in `src/app/api/__tests__/process-captures.test.ts` for field-level validation (invalid captureId, non-integer imageCount, missing fields)
2. Client (`src/components/capture-triage.tsx`): include `capture.id` as `captureId` in captureMetadataArray
3. Server (`src/app/api/process-captures/route.ts`): add per-entry validation — captureId must be string, imageCount must be positive integer, capturedAt must be ISO string (max 30 chars), note must be string|null (max 500 chars)

### Fix 2: Image index corruption when images fail processing
**Linear Issue:** [FOO-920](https://linear.app/lw-claude/issue/FOO-920)

1. Write test in `src/app/api/__tests__/process-captures.test.ts` for scenario where one image fails allSettled — verify remaining images map to correct captures
2. In `src/app/api/process-captures/route.ts`: build a success index map from allSettled results, then remap captureMetadata imageIndices using only successful positions

### Fix 3: Missing stop_reason handling in triageCaptures and triageRefine
**Linear Issue:** [FOO-921](https://linear.app/lw-claude/issue/FOO-921)

1. Write tests in `src/lib/__tests__/claude-triage.test.ts` for refusal, max_tokens, and context_window_exceeded stop reasons
2. In `src/lib/claude.ts` triageCaptures: add stop_reason checks after response (same pattern as analyzeFood), yield error events for refusal/max_tokens/context_window_exceeded
3. In `src/lib/claude.ts` triageRefine: same stop_reason checks

### Fix 4: capture.imageCount vs blobs.length mismatch
**Linear Issue:** [FOO-922](https://linear.app/lw-claude/issue/FOO-922)

1. Write test in `src/components/__tests__/capture-triage.test.tsx` for scenario where getCaptureBlobs returns fewer blobs than capture.imageCount
2. In `src/components/capture-triage.tsx:138`: change `capture.imageCount` to `blobs.length`

### Fix 5: handleSave missing error handling
**Linear Issue:** [FOO-923](https://linear.app/lw-claude/issue/FOO-923)

1. Write test in `src/components/__tests__/quick-capture.test.tsx` for addCapture failure — verify error state shown and isAdding reset
2. In `src/components/quick-capture.tsx`: wrap handleSave body in try/catch, add error state, reset isAdding on failure

### Fix 6: No rate limiting on bulk save endpoint
**Linear Issue:** [FOO-924](https://linear.app/lw-claude/issue/FOO-924)

1. Write test in `src/app/api/__tests__/saved-analyses-bulk.test.ts` for rate limiting (returns 429)
2. In `src/app/api/saved-analyses/bulk/route.ts`: add `checkRateLimit` call with 30 req/15min limit

### Fix 7: Object URL leak in capture-triage thumbnail loading
**Linear Issue:** [FOO-925](https://linear.app/lw-claude/issue/FOO-925)

1. Write test in `src/components/__tests__/capture-triage.test.tsx` verifying URL.revokeObjectURL called on cleanup
2. In `src/components/capture-triage.tsx`: in the loadThumbnails cleanup function, revoke any URLs created in newThumbnails before cancellation

### Fix 8: Double-logging on bulk save success
**Linear Issue:** [FOO-926](https://linear.app/lw-claude/issue/FOO-926)

1. In `src/lib/saved-analyses.ts:94`: remove the `logger.info` call (route handler already logs success)

### Fix 9: triageRefine missing recordUsage call
**Linear Issue:** [FOO-927](https://linear.app/lw-claude/issue/FOO-927)

1. Write test in `src/lib/__tests__/claude-triage.test.ts` verifying recordUsage is called in triageRefine
2. In `src/lib/claude.ts` triageRefine: add `recordUsage` call after yielding usage event, same pattern as triageCaptures (lines 2241-2252)

---

## Iteration 2

**Implemented:** 2026-04-09
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Fix 1 (FOO-919): captureMetadata field-level validation + captureId in client (worker-1)
- Fix 2 (FOO-920): Image index remapping for failed allSettled results (worker-1)
- Fix 3 (FOO-921): stop_reason handling in triageCaptures and triageRefine (worker-2)
- Fix 4 (FOO-922): Changed capture.imageCount to blobs.length in triage client (worker-3)
- Fix 5 (FOO-923): handleSave try/catch with error state in quick-capture (worker-3)
- Fix 6 (FOO-924): Rate limiting (30/15min) on bulk save endpoint (worker-1)
- Fix 7 (FOO-925): Object URL leak fix in thumbnail loading cleanup (worker-3)
- Fix 8 (FOO-926): Removed double-logging in bulkSaveAnalyses (worker-1)
- Fix 9 (FOO-927): Added recordUsage call + userId param to triageRefine (worker-2)

### Files Modified
- `src/app/api/process-captures/route.ts` — Field-level validation, image index remapping
- `src/app/api/process-captures/__tests__/route.test.ts` — 8 new tests
- `src/app/api/chat-captures/route.ts` — Updated triageRefine call with userId
- `src/app/api/chat-captures/__tests__/route.test.ts` — Updated assertion for new triageRefine signature
- `src/app/api/saved-analyses/bulk/route.ts` — Added checkRateLimit
- `src/app/api/saved-analyses/bulk/__tests__/route.test.ts` — Rate limit test
- `src/lib/claude.ts` — stop_reason handling in triageCaptures/triageRefine, recordUsage in triageRefine, userId param
- `src/lib/__tests__/claude-triage.test.ts` — 7 new tests (stop_reason + recordUsage)
- `src/lib/saved-analyses.ts` — Removed redundant logger.info
- `src/components/capture-triage.tsx` — captureId in metadata, blobs.length fix, 0-blob skip, URL leak fix, text-only reply handling, isChatSending guard
- `src/components/quick-capture.tsx` — handleSave try/catch with error banner
- `src/components/__tests__/capture-triage.test.tsx` — 2 new tests
- `src/components/__tests__/quick-capture.test.tsx` — 1 new test

### Linear Updates
- FOO-919: Todo → In Progress → Review
- FOO-920: Todo → In Progress → Review (via FOO-919 batch)
- FOO-921: Todo → In Progress → Review
- FOO-922: Todo → In Progress → Review
- FOO-923: Todo → In Progress → Review
- FOO-924: Todo → In Progress → Review (via FOO-919 batch)
- FOO-925: Todo → In Progress → Review
- FOO-926: Todo → In Progress → Review (via FOO-919 batch)
- FOO-927: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (0 critical, 1 high, 2 medium), all fixed before proceeding
  - Text-only assistant replies dropped in handleChatSend — fixed with assistantText accumulator
  - 0-blob captures causing 400 error — fixed with skip + console.warn
  - Concurrent chat send race condition — fixed with isChatSending guard
- verifier: All 3110 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Fixes 1, 2, 6, 8 (API route domain — process-captures validation, image index mapping, bulk save rate limit, double-logging)
- Worker 2: Fixes 3, 9 (Claude function domain — stop_reason handling, recordUsage)
- Worker 3: Fixes 4, 5, 7 (UI component domain — blobs.length, handleSave error, URL leak)

### Merge Summary
- Worker 2: fast-forward (first merge, no conflicts)
- Worker 1: auto-merge, no conflicts
- Worker 3: 1 conflict in capture-triage.tsx (worker-1's captureId + worker-3's blobs.length — kept both)

### Continuation Status
All fix plan tasks completed.
